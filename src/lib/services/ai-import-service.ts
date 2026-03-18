// ============================================================================
// RecallForge — AI Batch Import Service
// ============================================================================
// Imports AIImportItem[] into the database with duplicate detection,
// batch processing, note type matching, and ActivityEvent emission.
// ============================================================================

import { db, queueSync } from '@/lib/db';
import { buildCanonicalSourceMetadata, buildImportTags } from '@/lib/import/canonical';
import { createNote, updateNote, findDuplicates } from '@/lib/services/note-service';
import { resolveOrCreateCurriculumNodes, createLink } from '@/lib/services/curriculum-service';
import { EventEmitters } from '@/lib/events';
import { validateClozeFields } from '@/lib/validation/ai-import-schema';
import { hashString, chunk, generateId, now } from '@/lib/utils';
import type { AIImportItem, AIImportOptions } from '@/lib/validation/ai-import-schema';
import type { AIImportSummary, NoteType, Note, Deck, JSONObject } from '@/types';

// ─── Resolve deck by name (case-insensitive) ──────────────────────────────

async function resolveDeckId(
  userId: string,
  deckName: string,
  deckCache: Map<string, string>
): Promise<string | null> {
  const key = deckName.toLowerCase();
  if (deckCache.has(key)) return deckCache.get(key)!;

  const decks = await db.decks
    .where('userId')
    .equals(userId)
    .toArray();

  const match = decks.find(d => d.name.toLowerCase() === key);
  if (match) {
    deckCache.set(key, match.id);
    return match.id;
  }
  return null;
}

// ─── Auto-create deck hierarchy (e.g. "Medicina/Cardiología/Cap4") ────────

async function resolveDeckOrCreate(
  userId: string,
  deckPath: string,
  deckCache: Map<string, string>,
  academicMeta?: Partial<Record<string, unknown>>
): Promise<string> {
  // Try existing first
  const existing = await resolveDeckId(userId, deckPath, deckCache);
  if (existing) return existing;

  // Split path into segments (e.g. "Medicina/Cardiología/Cap4")
  const segments = deckPath.split('/').map(s => s.trim()).filter(Boolean);
  let parentId: string | null = null;

  for (let i = 0; i < segments.length; i++) {
    const segmentName = segments[i];
    const fullPath = segments.slice(0, i + 1).join('/');
    const cacheKey = fullPath.toLowerCase();

    if (deckCache.has(cacheKey)) {
      parentId = deckCache.get(cacheKey)!;
      continue;
    }

    // Check DB for existing deck with this name under this parent
    const allDecks = await db.decks.where('userId').equals(userId).toArray();
    const match = allDecks.find(d =>
      d.name.toLowerCase() === segmentName.toLowerCase() &&
      d.parentDeckId === parentId
    );

    if (match) {
      deckCache.set(cacheKey, match.id);
      parentId = match.id;
      continue;
    }

    // Create the deck
    const isLeaf = i === segments.length - 1;
    const metadata: Record<string, unknown> = {};

    // Apply academic metadata to the leaf deck
    if (isLeaf && academicMeta) {
      Object.assign(metadata, academicMeta);
    }

    // Infer subject/chapter from path position
    if (i === 0 && !metadata.subject) metadata.subject = segmentName;
    if (i === 1 && !metadata.module) metadata.module = segmentName;
    if (i === 2 && !metadata.chapter) metadata.chapter = segmentName;

    const newDeck: Deck = {
      id: generateId(),
      userId,
      name: segmentName,
      description: '',
      parentDeckId: parentId,
      sortOrder: 0,
      archived: false,
      presetId: null,
      metadata: metadata as JSONObject,
      createdAt: now(),
      updatedAt: now(),
    };

    await db.decks.add(newDeck);
    await queueSync('decks', newDeck.id, 'create', newDeck as unknown as Record<string, unknown>);
    deckCache.set(cacheKey, newDeck.id);
    // Also cache by just the name for simple lookups
    deckCache.set(segmentName.toLowerCase(), newDeck.id);
    parentId = newDeck.id;
  }

  // Also cache the full path
  deckCache.set(deckPath.toLowerCase(), parentId!);
  return parentId!;
}

// ─── Resolve note type by name (case-insensitive) ─────────────────────────

// Common aliases for note type names (Spanish ↔ English, etc.)
const NOTE_TYPE_ALIASES: Record<string, string[]> = {
  'basic': ['básica', 'basica', 'básico', 'basico'],
  'basic (and reversed card)': ['básica (y tarjeta invertida)', 'basica (y tarjeta invertida)', 'básica invertida', 'basica invertida'],
  'cloze': ['cloze', 'rellenar', 'completar'],
  'type answer': ['escribir respuesta', 'respuesta escrita', 'type answer'],
};

function resolveNoteTypeAlias(name: string): string {
  const lower = name.toLowerCase();
  for (const [canonical, aliases] of Object.entries(NOTE_TYPE_ALIASES)) {
    if (aliases.includes(lower)) return canonical;
  }
  return lower;
}

async function resolveNoteType(
  userId: string,
  noteTypeName: string,
  noteTypeCache: Map<string, NoteType>
): Promise<NoteType | null> {
  const key = noteTypeName.toLowerCase();
  if (noteTypeCache.has(key)) return noteTypeCache.get(key)!;

  const noteTypes = await db.noteTypes
    .where('userId')
    .equals(userId)
    .toArray();

  // Try exact match first
  let match = noteTypes.find(nt => nt.name.toLowerCase() === key);

  // Try alias resolution if no exact match
  if (!match) {
    const aliasKey = resolveNoteTypeAlias(noteTypeName);
    match = noteTypes.find(nt => nt.name.toLowerCase() === aliasKey);
  }

  if (match) {
    noteTypeCache.set(key, match);
    return match;
  }
  return null;
}

// ─── Check duplicates by externalId / duplicateKey / hash ─────────────────

async function findExistingNote(
  userId: string,
  item: AIImportItem
): Promise<Note | null> {
  // 1. By externalId in sourceMetadata
  if (item.externalId) {
    const notes = await db.notes
      .where('userId')
      .equals(userId)
      .filter(n =>
        n.sourceMetadata != null &&
        (n.sourceMetadata as Record<string, unknown>).externalId === item.externalId
      )
      .toArray();
    if (notes.length > 0) return notes[0];
  }

  // 2. By duplicateKey in sourceMetadata
  if (item.duplicateKey) {
    const notes = await db.notes
      .where('userId')
      .equals(userId)
      .filter(n =>
        n.sourceMetadata != null &&
        (n.sourceMetadata as Record<string, unknown>).duplicateKey === item.duplicateKey
      )
      .toArray();
    if (notes.length > 0) return notes[0];
  }

  // 3. By content hash
  const dupes = await findDuplicates(userId, item.fields);
  if (dupes.length > 0) return dupes[0];

  return null;
}

// ─── Validate fields against note type ────────────────────────────────────

function validateFieldsForNoteType(
  noteType: NoteType,
  fields: Record<string, string>
): string | null {
  const requiredFields = noteType.fields.filter(f => f.required);
  for (const rf of requiredFields) {
    const value = fields[rf.name];
    if (!value || value.trim().length === 0) {
      return `Campo requerido "${rf.name}" está vacío`;
    }
  }
  return null;
}

// ─── Process a single item ────────────────────────────────────────────────

interface ProcessResult {
  action: 'created' | 'updated' | 'skipped' | 'failed';
  error?: string;
}

async function processItem(
  userId: string,
  item: AIImportItem,
  index: number,
  options: AIImportOptions,
  deckCache: Map<string, string>,
  noteTypeCache: Map<string, NoteType>
): Promise<ProcessResult> {
  // Resolve deck
  const deckName = item.deck || options.defaultDeck;
  if (!deckName) {
    return { action: 'failed', error: `[${index}] No se especificó mazo` };
  }

  // Build academic metadata for this item
  const acadMeta: Record<string, unknown> = {};
  if (item.subject || options.defaultSubject) acadMeta.subject = item.subject || options.defaultSubject;
  if (item.module || options.defaultModule) acadMeta.module = item.module || options.defaultModule;
  if (item.chapter || options.defaultChapter) acadMeta.chapter = item.chapter || options.defaultChapter;
  if (item.topic) acadMeta.topic = item.topic;
  if (item.subtopic) acadMeta.subtopic = item.subtopic;
  if (item.examScope) acadMeta.examScope = item.examScope;
  if (item.professor) acadMeta.professor = item.professor;
  if (item.book) acadMeta.book = item.book;
  if (item.sourcePage) acadMeta.sourcePage = item.sourcePage;
  if (item.className) acadMeta.className = item.className;
  if (item.lectureDate) acadMeta.lectureDate = item.lectureDate;
  if (item.aiGenerated != null) acadMeta.aiGenerated = item.aiGenerated;
  if (item.aiReviewStatus) acadMeta.aiReviewStatus = item.aiReviewStatus;
  // Phase 2: Priority and conceptual difficulty
  if (item.priority || options.defaultPriority) acadMeta.priority = item.priority || options.defaultPriority;
  if (item.conceptualDifficulty || options.defaultConceptualDifficulty) {
    acadMeta.conceptualDifficulty = item.conceptualDifficulty || options.defaultConceptualDifficulty;
  }

  let deckId: string | null;

  if (options.autoCreateDecks) {
    // Auto-create deck hierarchy from path (e.g. "Medicina/Cardiología/Cap4")
    deckId = await resolveDeckOrCreate(userId, deckName, deckCache, acadMeta);
  } else {
    deckId = await resolveDeckId(userId, deckName, deckCache);
  }

  if (!deckId) {
    return { action: 'failed', error: `[${index}] Mazo "${deckName}" no encontrado` };
  }

  // Resolve note type
  const noteTypeName = item.noteType || options.defaultNoteType;
  if (!noteTypeName) {
    return { action: 'failed', error: `[${index}] No se especificó tipo de nota` };
  }

  const noteType = await resolveNoteType(userId, noteTypeName, noteTypeCache);
  if (!noteType) {
    return { action: 'failed', error: `[${index}] Tipo de nota "${noteTypeName}" no encontrado` };
  }

  // Validate fields against note type
  const fieldError = validateFieldsForNoteType(noteType, item.fields);
  if (fieldError) {
    return { action: 'failed', error: `[${index}] ${fieldError}` };
  }

  // Validate cloze
  const clozeError = validateClozeFields(noteType.kind, item.fields);
  if (clozeError) {
    return { action: 'failed', error: `[${index}] ${clozeError}` };
  }

  // Build tags
  const tags = buildImportTags(item.tags || [], options.tagPrefix);

  const sourceMetadata = buildCanonicalSourceMetadata({
    source: item.source,
    sourceMetadata: item.sourceMetadata,
    importSource: 'ai-batch-import',
    externalId: item.externalId,
    duplicateKey: item.duplicateKey,
    subject: acadMeta.subject as string | undefined,
    module: acadMeta.module as string | undefined,
    chapter: acadMeta.chapter as string | undefined,
    topic: acadMeta.topic as string | undefined,
    subtopic: acadMeta.subtopic as string | undefined,
    lectureDate: acadMeta.lectureDate as string | undefined,
    professor: acadMeta.professor as string | undefined,
    sourcePage: acadMeta.sourcePage as string | undefined,
    book: acadMeta.book as string | undefined,
    className: acadMeta.className as string | undefined,
    examScope: acadMeta.examScope as string | undefined,
    aiGenerated: acadMeta.aiGenerated as boolean | undefined,
    aiReviewStatus: acadMeta.aiReviewStatus as 'pending-review' | 'reviewed' | 'corrected' | undefined,
    priority: acadMeta.priority as 'low' | 'medium' | 'high' | 'critical' | undefined,
    conceptualDifficulty: acadMeta.conceptualDifficulty as 'easy' | 'medium' | 'hard' | 'very_hard' | undefined,
  });

  // Duplicate check
  const existing = await findExistingNote(userId, item);

  if (existing) {
    switch (options.duplicateStrategy) {
      case 'skip':
        return { action: 'skipped' };

      case 'update': {
        if (options.dryRun) return { action: 'updated' };
        await updateNote(userId, existing.id, {
          fieldValues: item.fields,
          tags,
        });
        return { action: 'updated' };
      }

      case 'merge_tags': {
        if (options.dryRun) return { action: 'updated' };
        const mergedTags = Array.from(new Set([...existing.tags, ...tags]));
        await updateNote(userId, existing.id, {
          fieldValues: item.fields,
          tags: mergedTags,
        });
        return { action: 'updated' };
      }

      case 'create_always':
        // Fall through to create even if duplicate exists
        break;
    }
  }

  // Create new note
  if (options.dryRun) return { action: 'created' };

  const { note: newNote } = await createNote(userId, {
    deckId,
    noteTypeId: noteType.id,
    fieldValues: item.fields,
    tags,
    source: item.source || 'ai-import',
    sourceMetadata: sourceMetadata as JSONObject,
  });

  // Auto-link to curriculum if enabled
  if (options.autoCreateCurriculum && acadMeta && Object.keys(acadMeta).length > 0) {
    const resolved = await resolveOrCreateCurriculumNodes(userId, acadMeta);
    if (resolved.topicId || resolved.chapterId || resolved.moduleId || resolved.subjectId) {
      await createLink(userId, {
        noteId: newNote.id,
        deckId,
        subjectId: resolved.subjectId,
        moduleId: resolved.moduleId,
        chapterId: resolved.chapterId,
        topicId: resolved.topicId,
      });
    }
  }

  return { action: 'created' };
}

// ─── Main batch import function ───────────────────────────────────────────

export async function importAIBatch(
  userId: string,
  items: AIImportItem[],
  options: AIImportOptions,
  onProgress?: (processed: number, total: number) => void
): Promise<AIImportSummary> {
  const startTime = Date.now();
  const summary: AIImportSummary = {
    totalItems: items.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    durationMs: 0,
    dryRun: options.dryRun,
  };

  // Caches for lookups
  const deckCache = new Map<string, string>();
  const noteTypeCache = new Map<string, NoteType>();

  // Emit start event
  if (!options.dryRun) {
    await EventEmitters.aiImportStarted(userId, {
      totalItems: items.length,
      duplicateStrategy: options.duplicateStrategy,
    });
  }

  // Process in batches
  const batches = chunk(items, options.batchSize);
  let processed = 0;

  for (const batch of batches) {
    for (const item of batch) {
      const index = processed;
      try {
        const result = await processItem(
          userId, item, index, options, deckCache, noteTypeCache
        );

        switch (result.action) {
          case 'created': summary.created++; break;
          case 'updated': summary.updated++; break;
          case 'skipped': summary.skipped++; break;
          case 'failed':
            summary.failed++;
            summary.errors.push({ index, message: result.error || 'Error desconocido' });
            break;
        }
      } catch (err) {
        summary.failed++;
        summary.errors.push({
          index,
          message: err instanceof Error ? err.message : 'Error desconocido',
        });
      }

      processed++;
      onProgress?.(processed, items.length);
    }

    // Yield between batches to keep UI responsive
    if (typeof window !== 'undefined') {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  summary.durationMs = Date.now() - startTime;

  // Emit completed event
  if (!options.dryRun) {
    await EventEmitters.aiImportCompleted(userId, {
      totalItems: summary.totalItems,
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped,
      failed: summary.failed,
      durationMs: summary.durationMs,
    });
  }

  return summary;
}
