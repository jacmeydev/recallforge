// ============================================================================
// RecallForge — Server-Side Agent Service
// ============================================================================
// Provides server-side logic for agent import, recommendations, study plans,
// and academic summaries. Works directly with the server SQLite DB.
// ============================================================================

import { sqlite } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';
import crypto from 'crypto';
import { buildCanonicalSourceMetadata, buildImportTags, getTemplateDescriptors, serializeNoteFields } from '@/lib/import/canonical';
import type { AIImportItem as ValidatedAIImportItem } from '@/lib/validation/ai-import-schema';

let migrated = false;
function ensureMigrated() { if (!migrated) { runMigrations(); migrated = true; } }

// ─── Types ─────────────────────────────────────────────────────────────────

export type AgentImportItem = Omit<ValidatedAIImportItem, 'tags'> & { tags?: string[] };

const SUPPORTED_DUPLICATE_STRATEGIES = ['skip', 'update', 'create_always', 'merge_tags'] as const;
type DuplicateStrategy = (typeof SUPPORTED_DUPLICATE_STRATEGIES)[number];

export interface AgentImportOptions {
  duplicateStrategy?: string;
  dryRun?: boolean;
  defaultDeck?: string;
  defaultNoteType?: string;
  tagPrefix?: string;
  agentId?: string;
}

export interface AgentImportResult {
  totalItems: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ index: number; message: string }>;
  itemResults: Array<{
    index: number;
    status: 'created' | 'updated' | 'skipped' | 'failed';
    noteId?: string;
    deckId?: string;
    message?: string;
  }>;
  dryRun: boolean;
  durationMs: number;
}

export interface Recommendation {
  type: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  data: Record<string, unknown>;
}

export interface StudyPlanEntry {
  order: number;
  action: string;
  deckId?: string;
  deckName?: string;
  subjectId?: string;
  subjectName?: string;
  moduleId?: string;
  moduleName?: string;
  chapterId?: string;
  chapterName?: string;
  topicId?: string;
  topicName?: string;
  cardCount: number;
  reason: string;
  estimatedMinutes: number;
}

export interface AcademicCoverageBreakdownItem {
  id: string;
  name: string;
  subjectName?: string;
  moduleName?: string;
  chapterName?: string;
  totalCards: number;
  newCards: number;
  matureCards: number;
  overdueCards: number;
  masteryPercent: number;
  riskLevel: 'low' | 'medium' | 'high';
  coveragePercent: number;
  overdueRatioPercent: number;
}

export interface AcademicCoverageSnapshot {
  timestamp: string;
  userId: string;
  overall: {
    totalCards: number;
    newCards: number;
    matureCards: number;
    overdueCards: number;
    highRiskCards: number;
    pendingAiReviewCards: number;
    studiedCoveragePercent: number;
    overdueRatioPercent: number;
    curriculumLinkedCards: number;
    curriculumLinkedPercent: number;
    unlinkedCards: number;
  };
  atRisk: {
    subjects: AcademicCoverageBreakdownItem[];
    topics: AcademicCoverageBreakdownItem[];
  };
  subjects: AcademicCoverageBreakdownItem[];
  modules: AcademicCoverageBreakdownItem[];
  chapters: AcademicCoverageBreakdownItem[];
  topics: AcademicCoverageBreakdownItem[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function genId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

function getRiskLevel(overdue: number, total: number): 'low' | 'medium' | 'high' {
  if (total <= 0) return 'low';
  const ratio = overdue / total;
  if (ratio > 0.5) return 'high';
  if (ratio > 0.2) return 'medium';
  return 'low';
}

function getCoveragePercent(newCount: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((((total - newCount) / total) * 100) * 10) / 10;
}

function getOverdueRatioPercent(overdue: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round(((overdue / total) * 100) * 10) / 10;
}

export function countPendingAiReviewCards(userId: string): number {
  ensureMigrated();
  return (sqlite.prepare(`
    SELECT COUNT(DISTINCT c.id) as count
    FROM cards c
    JOIN notes n ON c.note_id = n.id
    WHERE c.user_id = ?
      AND json_extract(n.source_metadata, '$.academic.aiReviewStatus') = 'pending-review'
      AND c.suspended = 0
      AND c.deleted_at IS NULL
      AND n.deleted_at IS NULL
  `).get(userId) as { count: number }).count;
}

function hashFields(fields: Record<string, string>): string {
  const content = serializeNoteFields(fields);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ─── Audit Trail ───────────────────────────────────────────────────────────

export function emitAgentEvent(
  userId: string,
  type: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown> = {},
  source = 'agent'
) {
  ensureMigrated();
  const userExists = sqlite.prepare(`SELECT 1 as ok FROM users WHERE id = ? LIMIT 1`).get(userId) as { ok: number } | undefined;
  if (!userExists) return;

  try {
    sqlite.prepare(`
      INSERT OR IGNORE INTO activity_events (id, user_id, ts, type, entity_type, entity_id, source, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(genId(), userId, nowIso(), type, entityType, entityId, source, JSON.stringify(payload));
  } catch {
    // Audit trail is best-effort; it should never break core study or import flows.
  }
}

// ─── Import: Resolve or Create Deck ────────────────────────────────────────

function resolveOrCreateDeck(userId: string, deckPath: string): string {
  ensureMigrated();
  // Try find existing
  const existing = sqlite.prepare(
    `SELECT id FROM decks WHERE user_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL LIMIT 1`
  ).get(userId, deckPath) as { id: string } | undefined;
  if (existing) return existing.id;

  // Create
  const id = genId();
  const ts = nowIso();
  sqlite.prepare(`
    INSERT INTO decks (id, user_id, name, description, sort_order, archived, metadata, created_at, updated_at)
    VALUES (?, ?, ?, '', 0, 0, '{}', ?, ?)
  `).run(id, userId, deckPath, ts, ts);
  return id;
}

// ─── Import: Resolve Note Type ─────────────────────────────────────────────

const NOTE_TYPE_ALIASES: Record<string, string[]> = {
  basic: ['básica', 'basica', 'simple', 'front-back'],
  basic_reversed: ['basic (and reversed)', 'basic and reversed', 'reversed', 'invertida', 'básica invertida', 'basica invertida'],
  cloze: ['cloze deletion', 'rellenar', 'completar'],
  type_answer: ['type answer', 'escribir respuesta', 'respuesta escrita'],
  image_occlusion: ['image-occlusion', 'image occlusion', 'io', 'oclusión', 'oclusion'],
};

interface ResolvedNoteType { id: string; kind: string; fields: string; templates: string }

const DEFAULT_NOTE_TYPE_CSS = `.card {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 1.1rem;
  text-align: center;
  color: var(--foreground);
  padding: 2rem;
  line-height: 1.6;
}
.front { font-size: 1.3rem; }
.answer { margin-top: 1rem; }
.extra { margin-top: 1rem; font-size: 0.9rem; opacity: 0.7; }
hr#answer { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }
img { max-width: 100%; height: auto; border-radius: 8px; }`;

function buildServerDefaultNoteType(userId: string, canonical: string): ResolvedNoteType | null {
  const id = genId();
  const ts = nowIso();

  const persist = (name: string, kind: string, fields: unknown[], templates: unknown[]) => {
    sqlite.prepare(`
      INSERT INTO note_types (id, user_id, name, description, kind, css, version, fields, templates, created_at, updated_at)
      VALUES (?, ?, ?, '', ?, ?, 1, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      name,
      kind,
      DEFAULT_NOTE_TYPE_CSS,
      JSON.stringify(fields),
      JSON.stringify(templates),
      ts,
      ts
    );
    return {
      id,
      kind,
      fields: JSON.stringify(fields),
      templates: JSON.stringify(templates),
    };
  };

  if (canonical === 'basic') {
    const fields = [
      { id: genId(), noteTypeId: id, name: 'Front', ordinal: 0, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: genId(), noteTypeId: id, name: 'Back', ordinal: 1, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: genId(), noteTypeId: id, name: 'Extra', ordinal: 2, required: false, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
    ];
    const templates = [
      { id: genId(), noteTypeId: id, name: 'Card 1', frontTemplate: '<div class="front">{{Front}}</div>', backTemplate: '<div class="back">{{FrontSide}}<hr id="answer"><div class="answer">{{Back}}</div><div class="extra">{{Extra}}</div></div>', ordinal: 0, active: true, generationRules: {} },
    ];
    return persist('basic', 'basic', fields, templates);
  }

  if (canonical === 'basic_reversed') {
    const fields = [
      { id: genId(), noteTypeId: id, name: 'Front', ordinal: 0, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: genId(), noteTypeId: id, name: 'Back', ordinal: 1, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: genId(), noteTypeId: id, name: 'Extra', ordinal: 2, required: false, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
    ];
    const templates = [
      { id: genId(), noteTypeId: id, name: 'Card 1', frontTemplate: '<div class="front">{{Front}}</div>', backTemplate: '<div class="back">{{FrontSide}}<hr id="answer"><div class="answer">{{Back}}</div><div class="extra">{{Extra}}</div></div>', ordinal: 0, active: true, generationRules: {} },
      { id: genId(), noteTypeId: id, name: 'Card 2 (Reversed)', frontTemplate: '<div class="front">{{Back}}</div>', backTemplate: '<div class="back">{{FrontSide}}<hr id="answer"><div class="answer">{{Front}}</div></div>', ordinal: 1, active: true, generationRules: {} },
    ];
    return persist('basic (and reversed)', 'basic_reversed', fields, templates);
  }

  if (canonical === 'cloze') {
    const fields = [
      { id: genId(), noteTypeId: id, name: 'Text', ordinal: 0, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: genId(), noteTypeId: id, name: 'Extra', ordinal: 1, required: false, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
    ];
    const templates = [
      { id: genId(), noteTypeId: id, name: 'Cloze', frontTemplate: '<div class="cloze-front">{{cloze:Text}}</div>', backTemplate: '<div class="cloze-back">{{cloze:Text}}<br><div class="extra">{{Extra}}</div></div>', ordinal: 0, active: true, generationRules: {} },
    ];
    return persist('cloze', 'cloze', fields, templates);
  }

  if (canonical === 'type_answer') {
    const fields = [
      { id: genId(), noteTypeId: id, name: 'Question', ordinal: 0, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: genId(), noteTypeId: id, name: 'Answer', ordinal: 1, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'text' },
      { id: genId(), noteTypeId: id, name: 'Extra', ordinal: 2, required: false, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
    ];
    const templates = [
      { id: genId(), noteTypeId: id, name: 'Type Answer', frontTemplate: '<div class="front">{{Question}}<br><br>{{type:Answer}}</div>', backTemplate: '<div class="back">{{Question}}<hr id="answer"><div class="answer">{{Answer}}</div><div class="extra">{{Extra}}</div></div>', ordinal: 0, active: true, generationRules: {} },
    ];
    return persist('type answer', 'type_answer', fields, templates);
  }

  if (canonical === 'image_occlusion') {
    const fields = [
      { id: genId(), noteTypeId: id, name: 'Image', ordinal: 0, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'image' },
      { id: genId(), noteTypeId: id, name: 'Masks', ordinal: 1, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'text' },
      { id: genId(), noteTypeId: id, name: 'Header', ordinal: 2, required: false, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: genId(), noteTypeId: id, name: 'Extra', ordinal: 3, required: false, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
    ];
    const templates = [
      { id: genId(), noteTypeId: id, name: 'Image Occlusion', frontTemplate: '<div class="io-front">{{Header}}<div class="io-container">{{Image}}{{io-masks}}</div></div>', backTemplate: '<div class="io-back">{{Header}}<div class="io-container">{{Image}}{{io-masks-revealed}}</div><div class="extra">{{Extra}}</div></div>', ordinal: 0, active: true, generationRules: {} },
    ];
    return persist('image-occlusion', 'image_occlusion', fields, templates);
  }

  return null;
}

function resolveNoteType(userId: string, name: string): ResolvedNoteType | null {
  ensureMigrated();
  const key = name.toLowerCase().trim();

  // Direct match
  const direct = sqlite.prepare(
    `SELECT id, kind, fields, templates FROM note_types WHERE user_id = ? AND LOWER(name) = ? AND deleted_at IS NULL LIMIT 1`
  ).get(userId, key) as ResolvedNoteType | undefined;
  if (direct) return direct;

  // Alias match
  let canonicalMatch: string | null = null;
  for (const [canonical, aliases] of Object.entries(NOTE_TYPE_ALIASES)) {
    if (key === canonical || aliases.includes(key)) {
      canonicalMatch = canonical;
      const match = sqlite.prepare(
        `SELECT id, kind, fields, templates FROM note_types WHERE user_id = ? AND LOWER(name) = ? AND deleted_at IS NULL LIMIT 1`
      ).get(userId, canonical) as ResolvedNoteType | undefined;
      if (match) return match;
    }
  }

  if (canonicalMatch) {
    return buildServerDefaultNoteType(userId, canonicalMatch);
  }

  return null;
}

function getRequiredFieldError(noteType: ResolvedNoteType, fields: Record<string, string>): string | null {
  try {
    const definitions = JSON.parse(noteType.fields || '[]') as Array<{ name?: string; required?: boolean }>;
    for (const field of definitions) {
      if (!field.required || !field.name) continue;
      if (!fields[field.name] || fields[field.name].trim().length === 0) {
        return `Required field "${field.name}" is empty`;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function findExistingNote(
  userId: string,
  item: AgentImportItem,
  hash: string
): { id: string; tags: string; source_metadata: string | null } | undefined {
  if (item.externalId) {
    const byExternalId = sqlite.prepare(`
      SELECT id, tags, source_metadata
      FROM notes
      WHERE user_id = ?
        AND deleted_at IS NULL
        AND json_extract(source_metadata, '$.externalId') = ?
      LIMIT 1
    `).get(userId, item.externalId) as { id: string; tags: string; source_metadata: string | null } | undefined;
    if (byExternalId) return byExternalId;
  }

  if (item.duplicateKey) {
    const byDuplicateKey = sqlite.prepare(`
      SELECT id, tags, source_metadata
      FROM notes
      WHERE user_id = ?
        AND deleted_at IS NULL
        AND json_extract(source_metadata, '$.duplicateKey') = ?
      LIMIT 1
    `).get(userId, item.duplicateKey) as { id: string; tags: string; source_metadata: string | null } | undefined;
    if (byDuplicateKey) return byDuplicateKey;
  }

  return sqlite.prepare(`
    SELECT id, tags, source_metadata
    FROM notes
    WHERE user_id = ? AND hash = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(userId, hash) as { id: string; tags: string; source_metadata: string | null } | undefined;
}

function getCanonicalMetadata(item: AgentImportItem, agentId: string): Record<string, unknown> {
  return buildCanonicalSourceMetadata({
    source: item.source,
    sourceMetadata: item.sourceMetadata,
    importSource: item.source || 'agent-import',
    externalId: item.externalId,
    duplicateKey: item.duplicateKey,
    agentId,
    subject: item.subject,
    module: item.module,
    chapter: item.chapter,
    topic: item.topic,
    subtopic: item.subtopic,
    lectureDate: item.lectureDate,
    professor: item.professor,
    sourcePage: item.sourcePage,
    book: item.book,
    className: item.className,
    examScope: item.examScope,
    aiGenerated: item.aiGenerated ?? true,
    aiReviewStatus: item.aiReviewStatus ?? 'pending-review',
    priority: item.priority,
    conceptualDifficulty: item.conceptualDifficulty,
  });
}

function mergeUniqueTags(existingTagsRaw: string, incomingTags: string[]): string[] {
  const existingTags = (() => {
    try {
      const parsed = JSON.parse(existingTagsRaw);
      return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
      return [];
    }
  })();

  return [...new Set([...existingTags, ...incomingTags])];
}

function createCardsForImportedNote(
  userId: string,
  noteId: string,
  noteType: ResolvedNoteType,
  deckId: string,
  fieldValues: Record<string, string>,
  createdAt: string
) {
  const rawTemplates = (() => {
    try {
      return JSON.parse(noteType.templates || '[]');
    } catch {
      return [];
    }
  })();

  const descriptors = getTemplateDescriptors({
    noteTypeId: noteType.id,
    kind: noteType.kind,
    templates: rawTemplates,
    fieldValues,
  });

  for (const descriptor of descriptors) {
    sqlite.prepare(`
      INSERT INTO cards (
        id, user_id, note_id, template_id, deck_id, due_at, state, queue_position,
        stability, difficulty, elapsed_days, scheduled_days, reps, lapses,
        learning_steps, custom_data, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'new', 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, ?)
    `).run(
      genId(),
      userId,
      noteId,
      descriptor.templateId,
      deckId,
      createdAt,
      JSON.stringify(descriptor.customData),
      createdAt,
      createdAt
    );
  }
}

// ─── Agent Import (Server-Side) ────────────────────────────────────────────

export function agentImport(
  userId: string,
  items: AgentImportItem[],
  options: AgentImportOptions = {}
): AgentImportResult {
  ensureMigrated();
  const startTime = Date.now();
  const dryRun = options.dryRun ?? false;
  const rawStrategy = options.duplicateStrategy ?? 'skip';
  const agentId = options.agentId ?? 'unknown';

  // P1-1: Reject unsupported duplicate strategies explicitly
  if (!SUPPORTED_DUPLICATE_STRATEGIES.includes(rawStrategy as DuplicateStrategy)) {
    return {
      totalItems: items.length,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: items.length,
      errors: [{ index: -1, message: `Unsupported duplicateStrategy "${rawStrategy}". Supported: ${SUPPORTED_DUPLICATE_STRATEGIES.join(', ')}` }],
      itemResults: items.map((_, index) => ({
        index,
        status: 'failed',
        message: `Unsupported duplicateStrategy "${rawStrategy}". Supported: ${SUPPORTED_DUPLICATE_STRATEGIES.join(', ')}`,
      })),
      dryRun,
      durationMs: 0,
    };
  }
  const strategy: DuplicateStrategy = rawStrategy as DuplicateStrategy;

  const result: AgentImportResult = {
    totalItems: items.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    itemResults: [],
    dryRun,
    durationMs: 0,
  };

  // Emit start event (only for real imports, not previews)
  if (!dryRun) {
    emitAgentEvent(userId, 'agent_import_started', 'batch', genId(), {
      agentId,
      totalItems: items.length,
      duplicateStrategy: strategy,
    });
  }

  const deckCache = new Map<string, string>();
  const ntCache = new Map<string, ResolvedNoteType | null>();

  // ── Dry-run path: read-only, no writes, no audit events ──
  if (dryRun) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.fields || Object.keys(item.fields).length === 0) {
        result.failed++;
        const message = 'fields is required and must not be empty';
        result.errors.push({ index: i, message });
        result.itemResults.push({ index: i, status: 'failed', message });
        continue;
      }
      const ntName = item.noteType || options.defaultNoteType;
      if (!ntName) {
        const message = 'noteType is required';
        result.failed++;
        result.errors.push({ index: i, message });
        result.itemResults.push({ index: i, status: 'failed', message });
        continue;
      }
      const deckName = item.deck || options.defaultDeck;
      if (!deckName) {
        const message = 'deck is required';
        result.failed++;
        result.errors.push({ index: i, message });
        result.itemResults.push({ index: i, status: 'failed', message });
        continue;
      }
      const ntKey = ntName.toLowerCase();
      if (!ntCache.has(ntKey)) ntCache.set(ntKey, resolveNoteType(userId, ntName));
      const noteType = ntCache.get(ntKey);
      if (!noteType) {
        const message = `Note type "${ntName}" not found`;
        result.failed++;
        result.errors.push({ index: i, message });
        result.itemResults.push({ index: i, status: 'failed', message });
        continue;
      }
      const fieldError = getRequiredFieldError(noteType, item.fields);
      if (fieldError) {
        result.failed++;
        result.errors.push({ index: i, message: fieldError });
        result.itemResults.push({ index: i, status: 'failed', message: fieldError });
        continue;
      }
      const hash = hashFields(item.fields);
      const existing = findExistingNote(userId, item, hash);
      if (existing) {
        if (strategy === 'skip') {
          result.skipped++;
          result.itemResults.push({ index: i, status: 'skipped', noteId: existing.id });
          continue;
        }
        if (strategy === 'update' || strategy === 'merge_tags') {
          result.updated++;
          result.itemResults.push({ index: i, status: 'updated', noteId: existing.id });
          continue;
        }
      }
      result.created++;
      result.itemResults.push({ index: i, status: 'created' });
    }
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // ── Real import: wrapped in a single SQLite transaction ──
  // P0-1: Entire loop runs inside sqlite.transaction() for atomicity.
  // Scope: all note INSERTs, card INSERTs, curriculum links, and deck auto-creation.
  // Outside transaction: audit events (emitted before/after), migration check.
  const runImport = sqlite.transaction(() => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        // Validate required fields
        if (!item.fields || Object.keys(item.fields).length === 0) {
          result.failed++;
          const message = 'fields is required and must not be empty';
          result.errors.push({ index: i, message });
          result.itemResults.push({ index: i, status: 'failed', message });
          continue;
        }

        const deckName = item.deck || options.defaultDeck;
        if (!deckName) {
          result.failed++;
          const message = 'deck is required';
          result.errors.push({ index: i, message });
          result.itemResults.push({ index: i, status: 'failed', message });
          continue;
        }

        const ntName = item.noteType || options.defaultNoteType;
        if (!ntName) {
          result.failed++;
          const message = 'noteType is required';
          result.errors.push({ index: i, message });
          result.itemResults.push({ index: i, status: 'failed', message });
          continue;
        }

        // Resolve note type
        const ntKey = ntName.toLowerCase();
        if (!ntCache.has(ntKey)) {
          ntCache.set(ntKey, resolveNoteType(userId, ntName));
        }
        const noteType = ntCache.get(ntKey)!;
        if (!noteType) {
          result.failed++;
          const message = `Note type "${ntName}" not found`;
          result.errors.push({ index: i, message });
          result.itemResults.push({ index: i, status: 'failed', message });
          continue;
        }

        const fieldError = getRequiredFieldError(noteType, item.fields);
        if (fieldError) {
          result.failed++;
          result.errors.push({ index: i, message: fieldError });
          result.itemResults.push({ index: i, status: 'failed', message: fieldError });
          continue;
        }

        // Check duplicate
        const hash = hashFields(item.fields);
        const existing = findExistingNote(userId, item, hash);
        if (existing && strategy === 'skip') {
          result.skipped++;
          result.itemResults.push({ index: i, status: 'skipped', noteId: existing.id });
          continue;
        }

        // Resolve deck
        const dk = deckName.toLowerCase();
        if (!deckCache.has(dk)) {
          deckCache.set(dk, resolveOrCreateDeck(userId, deckName));
        }
        const deckId = deckCache.get(dk)!;
        const metadata = getCanonicalMetadata(item, agentId);
        const tags = buildImportTags(item.tags || [], options.tagPrefix);

        if (existing && (strategy === 'update' || strategy === 'merge_tags')) {
          const ts = nowIso();
          const mergedTags = strategy === 'merge_tags'
            ? mergeUniqueTags(existing.tags, tags)
            : tags;
          const nextMetadata =
            strategy === 'merge_tags'
              ? buildCanonicalSourceMetadata({
                  source: item.source,
                  sourceMetadata: {
                    ...(existing.source_metadata ? JSON.parse(existing.source_metadata) as Record<string, unknown> : {}),
                    ...metadata,
                  },
                  importSource: item.source || 'agent-import',
                  externalId: item.externalId,
                  duplicateKey: item.duplicateKey,
                  agentId,
                  subject: item.subject,
                  module: item.module,
                  chapter: item.chapter,
                  topic: item.topic,
                  subtopic: item.subtopic,
                  lectureDate: item.lectureDate,
                  professor: item.professor,
                  sourcePage: item.sourcePage,
                  book: item.book,
                  className: item.className,
                  examScope: item.examScope,
                  aiGenerated: item.aiGenerated ?? true,
                  aiReviewStatus: item.aiReviewStatus ?? 'pending-review',
                  priority: item.priority,
                  conceptualDifficulty: item.conceptualDifficulty,
                })
              : metadata;

          sqlite.prepare(`
            UPDATE notes
            SET deck_id = ?,
                note_type_id = ?,
                field_values = ?,
                tags = ?,
                source = ?,
                source_metadata = ?,
                hash = ?,
                updated_at = ?
            WHERE id = ? AND user_id = ?
          `).run(
            deckId,
            noteType.id,
            JSON.stringify(item.fields),
            JSON.stringify(mergedTags),
            item.source || 'agent-import',
            JSON.stringify(nextMetadata),
            hash,
            ts,
            existing.id,
            userId
          );
          result.updated++;
          result.itemResults.push({ index: i, status: 'updated', noteId: existing.id, deckId });
          continue;
        }

        // Create note
        const noteId = genId();
        const ts = nowIso();

        sqlite.prepare(`
          INSERT INTO notes (id, user_id, deck_id, note_type_id, field_values, tags, source, source_metadata, hash, suspended, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `).run(
          noteId, userId, deckId, noteType.id,
          JSON.stringify(item.fields),
          JSON.stringify(tags),
          item.source || 'agent-import',
          JSON.stringify(metadata),
          hash, ts, ts
        );
        createCardsForImportedNote(userId, noteId, noteType, deckId, item.fields, ts);

        // Link to curriculum if subject provided
        if (item.subject || item.program || item.module || item.chapter || item.topic) {
          linkToCurriculum(userId, noteId, deckId, item);
        }

        result.created++;
        result.itemResults.push({ index: i, status: 'created', noteId, deckId });
      } catch (err) {
        result.failed++;
        const message = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push({
          index: i,
          message,
        });
        result.itemResults.push({ index: i, status: 'failed', message });
      }
    }
  });

  runImport();

  result.durationMs = Date.now() - startTime;

  // Emit completed event (outside transaction — informational)
  emitAgentEvent(userId, 'agent_import_completed', 'batch', genId(), {
    agentId,
    created: result.created,
    skipped: result.skipped,
    failed: result.failed,
    durationMs: result.durationMs,
  });

  return result;
}

// ─── Curriculum Linking ────────────────────────────────────────────────────

function linkToCurriculum(
  userId: string,
  noteId: string,
  deckId: string,
  item: AgentImportItem
) {
  let programId: string | null = null;
  let subjectId: string | null = null;
  let moduleId: string | null = null;
  let chapterId: string | null = null;
  let topicId: string | null = null;

  if (item.program) {
    const prog = sqlite.prepare(
      `SELECT id FROM curriculum_programs WHERE user_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL LIMIT 1`
    ).get(userId, item.program) as { id: string } | undefined;
    programId = prog?.id ?? null;
  }

  if (item.subject) {
    const subQuery = programId
      ? `SELECT id FROM curriculum_subjects WHERE user_id = ? AND LOWER(name) = LOWER(?) AND program_id = ? AND deleted_at IS NULL LIMIT 1`
      : `SELECT id FROM curriculum_subjects WHERE user_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL LIMIT 1`;
    const params = programId ? [userId, item.subject, programId] : [userId, item.subject];
    const sub = sqlite.prepare(subQuery).get(...params) as { id: string } | undefined;
    subjectId = sub?.id ?? null;
  }

  if (item.module) {
    const modQuery = subjectId
      ? `SELECT id FROM curriculum_modules WHERE user_id = ? AND LOWER(name) = LOWER(?) AND subject_id = ? AND deleted_at IS NULL LIMIT 1`
      : `SELECT id FROM curriculum_modules WHERE user_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL LIMIT 1`;
    const params = subjectId ? [userId, item.module, subjectId] : [userId, item.module];
    const mod = sqlite.prepare(modQuery).get(...params) as { id: string } | undefined;
    moduleId = mod?.id ?? null;
  }

  if (item.chapter) {
    const chapterQuery = moduleId
      ? `SELECT id FROM curriculum_chapters WHERE user_id = ? AND LOWER(name) = LOWER(?) AND module_id = ? AND deleted_at IS NULL LIMIT 1`
      : `SELECT id FROM curriculum_chapters WHERE user_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL LIMIT 1`;
    const params = moduleId ? [userId, item.chapter, moduleId] : [userId, item.chapter];
    const chapter = sqlite.prepare(chapterQuery).get(...params) as { id: string } | undefined;
    chapterId = chapter?.id ?? null;
  }

  if (item.topic) {
    const topicQuery = chapterId
      ? `SELECT id FROM curriculum_topics WHERE user_id = ? AND LOWER(name) = LOWER(?) AND chapter_id = ? AND deleted_at IS NULL LIMIT 1`
      : `SELECT id FROM curriculum_topics WHERE user_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL LIMIT 1`;
    const params = chapterId ? [userId, item.topic, chapterId] : [userId, item.topic];
    const topic = sqlite.prepare(topicQuery).get(...params) as { id: string } | undefined;
    topicId = topic?.id ?? null;
  }

  if (programId || subjectId || moduleId || chapterId || topicId) {
    const ts = nowIso();
    sqlite.prepare(`
      INSERT INTO curriculum_links (id, user_id, note_id, deck_id, program_id, subject_id, module_id, chapter_id, topic_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(genId(), userId, noteId, deckId, programId, subjectId, moduleId, chapterId, topicId, ts);
  }
}

// ─── Recommendations ──────────────────────────────────────────────────────

export function getRecommendations(userId: string): Recommendation[] {
  ensureMigrated();
  const recommendations: Recommendation[] = [];
  const ts = nowIso();

  // 1. Overdue cards
  const overdue = sqlite.prepare(`
    SELECT COUNT(*) as count FROM cards
    WHERE user_id = ? AND due_at < ? AND state != 'new' AND suspended = 0 AND deleted_at IS NULL
  `).get(userId, ts) as { count: number };

  if (overdue.count > 0) {
    recommendations.push({
      type: 'overdue_cards',
      priority: overdue.count > 50 ? 'critical' : overdue.count > 20 ? 'high' : 'medium',
      title: `${overdue.count} tarjetas vencidas`,
      description: `Tienes ${overdue.count} tarjetas que ya pasaron su fecha de repaso. Repasarlas pronto evita pérdida de retención.`,
      data: { count: overdue.count },
    });
  }

  // 2. Hard topics (leeches)
  const hardTopics = sqlite.prepare(`
    SELECT c.deck_id, d.name as deck_name, COUNT(*) as count
    FROM cards c JOIN decks d ON c.deck_id = d.id
    WHERE c.user_id = ? AND c.lapses >= 3 AND c.suspended = 0 AND c.deleted_at IS NULL AND d.deleted_at IS NULL
    GROUP BY c.deck_id ORDER BY count DESC LIMIT 5
  `).all(userId) as Array<{ deck_id: string; deck_name: string; count: number }>;

  if (hardTopics.length > 0) {
    const total = hardTopics.reduce((s, h) => s + h.count, 0);
    recommendations.push({
      type: 'hard_topics',
      priority: total > 20 ? 'high' : 'medium',
      title: `${total} tarjetas difíciles (leeches)`,
      description: `Estas tarjetas tienen 3+ errores. Considera reformularlas o estudiarlas con la sesión de rescate.`,
      data: { total, byDeck: hardTopics },
    });
  }

  // 3. AI cards pending review
  const aiPending = { count: countPendingAiReviewCards(userId) };

  if (aiPending.count > 0) {
    recommendations.push({
      type: 'ai_pending_review',
      priority: aiPending.count > 30 ? 'high' : 'medium',
      title: `${aiPending.count} tarjetas IA sin revisar`,
      description: 'Tarjetas generadas por IA pendientes de revisión humana antes de estudiarlas.',
      data: { count: aiPending.count },
    });
  }

  // 4. Subjects at risk (many overdue relative to total)
  const subjectRisk = sqlite.prepare(`
    SELECT cs.id, cs.name,
      COUNT(c.id) as total,
      SUM(CASE WHEN c.due_at < ? AND c.state != 'new' THEN 1 ELSE 0 END) as overdue
    FROM curriculum_subjects cs
    JOIN curriculum_links cl ON cl.subject_id = cs.id
    JOIN cards c ON (cl.card_id = c.id OR cl.deck_id = c.deck_id) AND c.user_id = ?
    WHERE cs.user_id = ? AND cs.deleted_at IS NULL AND c.deleted_at IS NULL AND c.suspended = 0
    GROUP BY cs.id
    HAVING total > 0
    ORDER BY CAST(overdue AS REAL) / total DESC
    LIMIT 5
  `).all(ts, userId, userId) as Array<{ id: string; name: string; total: number; overdue: number }>;

  for (const sub of subjectRisk) {
    if (sub.overdue === 0) continue;
    const ratio = sub.overdue / sub.total;
    if (ratio > 0.3) {
      recommendations.push({
        type: 'subject_at_risk',
        priority: ratio > 0.6 ? 'critical' : 'high',
        title: `${sub.name}: ${Math.round(ratio * 100)}% vencido`,
        description: `${sub.overdue} de ${sub.total} tarjetas vencidas en esta materia. Está en riesgo de olvido.`,
        data: { subjectId: sub.id, subjectName: sub.name, overdue: sub.overdue, total: sub.total, ratio },
      });
    }
  }

  const topicRisk = sqlite.prepare(`
    SELECT ct.id, ct.name,
      cs.id as subject_id,
      cs.name as subject_name,
      cm.id as module_id,
      cm.name as module_name,
      cc.id as chapter_id,
      cc.name as chapter_name,
      COUNT(DISTINCT c.id) as total,
      COUNT(DISTINCT CASE WHEN c.due_at < ? AND c.state != 'new' THEN c.id END) as overdue
    FROM curriculum_topics ct
    JOIN curriculum_chapters cc ON cc.id = ct.chapter_id AND cc.deleted_at IS NULL
    JOIN curriculum_modules cm ON cm.id = cc.module_id AND cm.deleted_at IS NULL
    JOIN curriculum_subjects cs ON cs.id = cm.subject_id AND cs.deleted_at IS NULL
    JOIN curriculum_links cl ON cl.topic_id = ct.id AND cl.deleted_at IS NULL
    JOIN cards c ON (cl.card_id = c.id OR cl.note_id = c.note_id OR cl.deck_id = c.deck_id) AND c.user_id = ?
    WHERE ct.user_id = ? AND ct.deleted_at IS NULL AND c.deleted_at IS NULL AND c.suspended = 0
    GROUP BY ct.id
    HAVING total > 0
    ORDER BY CAST(overdue AS REAL) / total DESC, total DESC
    LIMIT 5
  `).all(ts, userId, userId) as Array<{
    id: string;
    name: string;
    subject_id: string;
    subject_name: string;
    module_id: string;
    module_name: string;
    chapter_id: string;
    chapter_name: string;
    total: number;
    overdue: number;
  }>;

  for (const topic of topicRisk) {
    if (topic.overdue === 0) continue;
    const ratio = topic.overdue / topic.total;
    if (ratio > 0.3) {
      recommendations.push({
        type: 'topic_at_risk',
        priority: ratio > 0.6 ? 'critical' : 'high',
        title: `${topic.name}: ${Math.round(ratio * 100)}% vencido`,
        description: `${topic.overdue} de ${topic.total} tarjetas vencidas en este tema.`,
        data: {
          topicId: topic.id,
          topicName: topic.name,
          subjectId: topic.subject_id,
          subjectName: topic.subject_name,
          moduleId: topic.module_id,
          moduleName: topic.module_name,
          chapterId: topic.chapter_id,
          chapterName: topic.chapter_name,
          overdue: topic.overdue,
          total: topic.total,
          ratio,
        },
      });
    }
  }

  // 5. Abandoned decks (no reviews in 14+ days with pending cards)
  const abandoned = sqlite.prepare(`
    SELECT d.id, d.name, MAX(rl.reviewed_at) as last_review, COUNT(c.id) as pending
    FROM decks d
    JOIN cards c ON c.deck_id = d.id AND c.state != 'new' AND c.suspended = 0 AND c.deleted_at IS NULL
    LEFT JOIN review_logs rl ON rl.card_id = c.id AND rl.user_id = ?
    WHERE d.user_id = ? AND d.deleted_at IS NULL
    GROUP BY d.id
    HAVING pending > 0
    ORDER BY last_review ASC
    LIMIT 10
  `).all(userId, userId) as Array<{ id: string; name: string; last_review: string | null; pending: number }>;

  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  for (const deck of abandoned) {
    if (!deck.last_review || deck.last_review < fourteenDaysAgo) {
      recommendations.push({
        type: 'abandoned_deck',
        priority: 'medium',
        title: `${deck.name}: abandonado`,
        description: `Este mazo no se repasa hace más de 14 días y tiene ${deck.pending} tarjetas pendientes.`,
        data: { deckId: deck.id, deckName: deck.name, lastReview: deck.last_review, pending: deck.pending },
      });
    }
  }

  // 6. Rescue recommendation
  const highRisk = sqlite.prepare(`
    SELECT COUNT(*) as count FROM cards
    WHERE user_id = ? AND retrievability IS NOT NULL AND retrievability < 0.5
      AND suspended = 0 AND deleted_at IS NULL
  `).get(userId) as { count: number };

  if (highRisk.count > 0) {
    recommendations.push({
      type: 'rescue_session',
      priority: highRisk.count > 30 ? 'high' : 'medium',
      title: `Sesión de rescate recomendada`,
      description: `${highRisk.count} tarjetas con retrievability < 50%. Una sesión de rescate recuperará las más críticas.`,
      data: { highRiskCount: highRisk.count },
    });
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  emitAgentEvent(userId, 'agent_recommendation_requested', 'recommendations', genId(), {
    count: recommendations.length,
  });

  return recommendations;
}

// ─── Study Plan ────────────────────────────────────────────────────────────

export function getStudyPlan(userId: string, maxMinutes = 60): { entries: StudyPlanEntry[]; totalMinutes: number; totalCards: number } {
  ensureMigrated();
  const entries: StudyPlanEntry[] = [];
  const ts = nowIso();
  let order = 1;
  let totalMinutes = 0;
  let totalCards = 0;
  const avgMinPerCard = 0.5; // ~30s per card

  // Step 0: Focus topics with real curriculum links
  const focusTopics = sqlite.prepare(`
    SELECT ct.id as topic_id, ct.name as topic_name,
      cc.id as chapter_id, cc.name as chapter_name,
      cm.id as module_id, cm.name as module_name,
      cs.id as subject_id, cs.name as subject_name,
      MIN(c.deck_id) as deck_id,
      MIN(d.name) as deck_name,
      COUNT(DISTINCT c.id) as total,
      COUNT(DISTINCT CASE WHEN c.due_at < ? AND c.state != 'new' THEN c.id END) as overdue
    FROM curriculum_topics ct
    JOIN curriculum_chapters cc ON cc.id = ct.chapter_id AND cc.deleted_at IS NULL
    JOIN curriculum_modules cm ON cm.id = cc.module_id AND cm.deleted_at IS NULL
    JOIN curriculum_subjects cs ON cs.id = cm.subject_id AND cs.deleted_at IS NULL
    JOIN curriculum_links cl ON cl.topic_id = ct.id AND cl.deleted_at IS NULL
    JOIN cards c ON (cl.card_id = c.id OR cl.note_id = c.note_id OR cl.deck_id = c.deck_id) AND c.user_id = ?
    LEFT JOIN decks d ON d.id = c.deck_id
    WHERE ct.user_id = ? AND ct.deleted_at IS NULL AND c.deleted_at IS NULL AND c.suspended = 0
    GROUP BY ct.id
    HAVING overdue > 0
    ORDER BY overdue DESC, total DESC
    LIMIT 3
  `).all(ts, userId, userId) as Array<{
    topic_id: string;
    topic_name: string;
    chapter_id: string;
    chapter_name: string;
    module_id: string;
    module_name: string;
    subject_id: string;
    subject_name: string;
    deck_id: string | null;
    deck_name: string | null;
    total: number;
    overdue: number;
  }>;

  for (const topic of focusTopics) {
    if (totalMinutes >= maxMinutes) break;
    const cardCount = Math.min(topic.overdue, Math.floor((maxMinutes - totalMinutes) / avgMinPerCard));
    if (cardCount <= 0) break;
    const mins = Math.ceil(cardCount * avgMinPerCard);
    entries.push({
      order: order++,
      action: 'focus_topic',
      deckId: topic.deck_id ?? undefined,
      deckName: topic.deck_name ?? undefined,
      subjectId: topic.subject_id,
      subjectName: topic.subject_name,
      moduleId: topic.module_id,
      moduleName: topic.module_name,
      chapterId: topic.chapter_id,
      chapterName: topic.chapter_name,
      topicId: topic.topic_id,
      topicName: topic.topic_name,
      cardCount,
      reason: `${topic.overdue} tarjetas vencidas en el tema "${topic.topic_name}"`,
      estimatedMinutes: mins,
    });
    totalMinutes += mins;
    totalCards += cardCount;
  }

  // Step 1: High-risk cards (retrievability < 0.5)
  const highRisk = sqlite.prepare(`
    SELECT c.deck_id, d.name as deck_name, COUNT(*) as count
    FROM cards c JOIN decks d ON c.deck_id = d.id
    WHERE c.user_id = ? AND c.retrievability IS NOT NULL AND c.retrievability < 0.5
      AND c.suspended = 0 AND c.deleted_at IS NULL AND d.deleted_at IS NULL
    GROUP BY c.deck_id ORDER BY count DESC LIMIT 3
  `).all(userId) as Array<{ deck_id: string; deck_name: string; count: number }>;

  for (const hr of highRisk) {
    if (totalMinutes >= maxMinutes) break;
    const cardCount = Math.min(hr.count, Math.floor((maxMinutes - totalMinutes) / avgMinPerCard));
    if (cardCount <= 0) break;
    const mins = Math.ceil(cardCount * avgMinPerCard);
    entries.push({
      order: order++,
      action: 'rescue',
      deckId: hr.deck_id,
      deckName: hr.deck_name,
      cardCount,
      reason: `${hr.count} tarjetas en riesgo alto de olvido`,
      estimatedMinutes: mins,
    });
    totalMinutes += mins;
    totalCards += cardCount;
  }

  // Step 2: Overdue reviews
  const overdue = sqlite.prepare(`
    SELECT c.deck_id, d.name as deck_name, COUNT(*) as count
    FROM cards c JOIN decks d ON c.deck_id = d.id
    WHERE c.user_id = ? AND c.due_at < ? AND c.state != 'new'
      AND c.suspended = 0 AND c.deleted_at IS NULL AND d.deleted_at IS NULL
    GROUP BY c.deck_id ORDER BY count DESC LIMIT 5
  `).all(userId, ts) as Array<{ deck_id: string; deck_name: string; count: number }>;

  for (const ov of overdue) {
    if (totalMinutes >= maxMinutes) break;
    const cardCount = Math.min(ov.count, Math.floor((maxMinutes - totalMinutes) / avgMinPerCard));
    if (cardCount <= 0) break;
    const mins = Math.ceil(cardCount * avgMinPerCard);
    entries.push({
      order: order++,
      action: 'review',
      deckId: ov.deck_id,
      deckName: ov.deck_name,
      cardCount,
      reason: `${ov.count} tarjetas vencidas en este mazo`,
      estimatedMinutes: mins,
    });
    totalMinutes += mins;
    totalCards += cardCount;
  }

  // Step 3: New cards
  if (totalMinutes < maxMinutes) {
    const newCards = sqlite.prepare(`
      SELECT c.deck_id, d.name as deck_name, COUNT(*) as count
      FROM cards c JOIN decks d ON c.deck_id = d.id
      WHERE c.user_id = ? AND c.state = 'new'
        AND c.suspended = 0 AND c.deleted_at IS NULL AND d.deleted_at IS NULL
      GROUP BY c.deck_id ORDER BY count DESC LIMIT 3
    `).all(userId) as Array<{ deck_id: string; deck_name: string; count: number }>;

    for (const nc of newCards) {
      if (totalMinutes >= maxMinutes) break;
      const cardCount = Math.min(nc.count, 20, Math.floor((maxMinutes - totalMinutes) / avgMinPerCard));
      if (cardCount <= 0) break;
      const mins = Math.ceil(cardCount * avgMinPerCard);
      entries.push({
        order: order++,
        action: 'learn_new',
        deckId: nc.deck_id,
        deckName: nc.deck_name,
        cardCount,
        reason: `${nc.count} tarjetas nuevas disponibles`,
        estimatedMinutes: mins,
      });
      totalMinutes += mins;
      totalCards += cardCount;
    }
  }

  emitAgentEvent(userId, 'agent_study_plan_generated', 'study_plan', genId(), {
    totalEntries: entries.length,
    totalMinutes,
    totalCards,
    maxMinutes,
  });

  return { entries, totalMinutes, totalCards };
}

// ─── Academic Summary ──────────────────────────────────────────────────────

export function getAcademicSummary(userId: string, options: { emitEvent?: boolean } = {}) {
  ensureMigrated();
  const ts = nowIso();

  // Overall stats
  const overall = sqlite.prepare(`
    SELECT
      COUNT(*) as total_cards,
      SUM(CASE WHEN state = 'new' THEN 1 ELSE 0 END) as new_cards,
      SUM(CASE WHEN state = 'review' AND reps >= 3 THEN 1 ELSE 0 END) as mature_cards,
      SUM(CASE WHEN due_at < ? AND state != 'new' THEN 1 ELSE 0 END) as overdue_cards,
      SUM(CASE WHEN lapses >= 3 THEN 1 ELSE 0 END) as leech_cards,
      AVG(CASE WHEN retrievability IS NOT NULL THEN retrievability END) as avg_retrievability,
      AVG(CASE WHEN stability > 0 THEN stability END) as avg_stability
    FROM cards WHERE user_id = ? AND suspended = 0 AND deleted_at IS NULL
  `).get(ts, userId) as Record<string, number | null>;

  // Reviews last 7 / 30 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const reviews7 = sqlite.prepare(`
    SELECT COUNT(*) as count,
      SUM(CASE WHEN rating IN ('good', 'easy') THEN 1 ELSE 0 END) as correct
    FROM review_logs WHERE user_id = ? AND reviewed_at > ?
  `).get(userId, sevenDaysAgo) as { count: number; correct: number };

  const reviews30 = sqlite.prepare(`
    SELECT COUNT(*) as count,
      SUM(CASE WHEN rating IN ('good', 'easy') THEN 1 ELSE 0 END) as correct
    FROM review_logs WHERE user_id = ? AND reviewed_at > ?
  `).get(userId, thirtyDaysAgo) as { count: number; correct: number };

  // Gamification
  const gamification = sqlite.prepare(`
    SELECT total_xp, level, current_streak, longest_streak, daily_goal
    FROM user_gamification WHERE user_id = ? LIMIT 1
  `).get(userId) as { total_xp: number; level: number; current_streak: number; longest_streak: number; daily_goal: number } | undefined;

  // Subject breakdown
  const subjects = sqlite.prepare(`
    SELECT cs.id, cs.name, cp.name as program_name,
      COUNT(c.id) as total,
      SUM(CASE WHEN c.state = 'new' THEN 1 ELSE 0 END) as new_count,
      SUM(CASE WHEN c.state = 'review' AND c.reps >= 3 THEN 1 ELSE 0 END) as mature,
      SUM(CASE WHEN c.due_at < ? AND c.state != 'new' THEN 1 ELSE 0 END) as overdue
    FROM curriculum_subjects cs
    LEFT JOIN curriculum_programs cp ON cs.program_id = cp.id
    JOIN curriculum_links cl ON cl.subject_id = cs.id
    JOIN cards c ON (cl.card_id = c.id OR cl.deck_id = c.deck_id) AND c.user_id = ?
    WHERE cs.user_id = ? AND cs.deleted_at IS NULL AND c.deleted_at IS NULL AND c.suspended = 0
    GROUP BY cs.id
    ORDER BY overdue DESC
  `).all(ts, userId, userId) as Array<{
    id: string; name: string; program_name: string | null;
    total: number; new_count: number; mature: number; overdue: number;
  }>;

  const subjectSummaries = subjects.map(s => ({
    id: s.id,
    name: s.name,
    program: s.program_name,
    totalCards: s.total,
    newCards: s.new_count,
    matureCards: s.mature,
    overdueCards: s.overdue,
    masteryPercent: s.total > 0 ? Math.round((s.mature / s.total) * 100) : 0,
    riskLevel: getRiskLevel(s.overdue, s.total),
  }));

  const modules = sqlite.prepare(`
    SELECT cm.id, cm.name,
      cs.id as subject_id, cs.name as subject_name,
      COUNT(DISTINCT c.id) as total,
      COUNT(DISTINCT CASE WHEN c.state = 'new' THEN c.id END) as new_count,
      COUNT(DISTINCT CASE WHEN c.state = 'review' AND c.reps >= 3 THEN c.id END) as mature,
      COUNT(DISTINCT CASE WHEN c.due_at < ? AND c.state != 'new' THEN c.id END) as overdue
    FROM curriculum_modules cm
    JOIN curriculum_subjects cs ON cs.id = cm.subject_id AND cs.deleted_at IS NULL
    JOIN curriculum_links cl ON cl.module_id = cm.id AND cl.deleted_at IS NULL
    JOIN cards c ON (cl.card_id = c.id OR cl.note_id = c.note_id OR cl.deck_id = c.deck_id) AND c.user_id = ?
    WHERE cm.user_id = ? AND cm.deleted_at IS NULL AND c.deleted_at IS NULL AND c.suspended = 0
    GROUP BY cm.id
    ORDER BY overdue DESC, total DESC
  `).all(ts, userId, userId) as Array<{
    id: string;
    name: string;
    subject_id: string;
    subject_name: string;
    total: number;
    new_count: number;
    mature: number;
    overdue: number;
  }>;

  const chapters = sqlite.prepare(`
    SELECT cc.id, cc.name, cc.exam_scope,
      cm.id as module_id, cm.name as module_name,
      cs.id as subject_id, cs.name as subject_name,
      COUNT(DISTINCT c.id) as total,
      COUNT(DISTINCT CASE WHEN c.state = 'new' THEN c.id END) as new_count,
      COUNT(DISTINCT CASE WHEN c.state = 'review' AND c.reps >= 3 THEN c.id END) as mature,
      COUNT(DISTINCT CASE WHEN c.due_at < ? AND c.state != 'new' THEN c.id END) as overdue
    FROM curriculum_chapters cc
    JOIN curriculum_modules cm ON cm.id = cc.module_id AND cm.deleted_at IS NULL
    JOIN curriculum_subjects cs ON cs.id = cm.subject_id AND cs.deleted_at IS NULL
    JOIN curriculum_links cl ON cl.chapter_id = cc.id AND cl.deleted_at IS NULL
    JOIN cards c ON (cl.card_id = c.id OR cl.note_id = c.note_id OR cl.deck_id = c.deck_id) AND c.user_id = ?
    WHERE cc.user_id = ? AND cc.deleted_at IS NULL AND c.deleted_at IS NULL AND c.suspended = 0
    GROUP BY cc.id
    ORDER BY overdue DESC, total DESC
  `).all(ts, userId, userId) as Array<{
    id: string;
    name: string;
    exam_scope: string | null;
    module_id: string;
    module_name: string;
    subject_id: string;
    subject_name: string;
    total: number;
    new_count: number;
    mature: number;
    overdue: number;
  }>;

  const topics = sqlite.prepare(`
    SELECT ct.id, ct.name, ct.priority_default, ct.conceptual_difficulty_default,
      cc.id as chapter_id, cc.name as chapter_name,
      cm.id as module_id, cm.name as module_name,
      cs.id as subject_id, cs.name as subject_name,
      COUNT(DISTINCT c.id) as total,
      COUNT(DISTINCT CASE WHEN c.state = 'new' THEN c.id END) as new_count,
      COUNT(DISTINCT CASE WHEN c.state = 'review' AND c.reps >= 3 THEN c.id END) as mature,
      COUNT(DISTINCT CASE WHEN c.due_at < ? AND c.state != 'new' THEN c.id END) as overdue
    FROM curriculum_topics ct
    JOIN curriculum_chapters cc ON cc.id = ct.chapter_id AND cc.deleted_at IS NULL
    JOIN curriculum_modules cm ON cm.id = cc.module_id AND cm.deleted_at IS NULL
    JOIN curriculum_subjects cs ON cs.id = cm.subject_id AND cs.deleted_at IS NULL
    JOIN curriculum_links cl ON cl.topic_id = ct.id AND cl.deleted_at IS NULL
    JOIN cards c ON (cl.card_id = c.id OR cl.note_id = c.note_id OR cl.deck_id = c.deck_id) AND c.user_id = ?
    WHERE ct.user_id = ? AND ct.deleted_at IS NULL AND c.deleted_at IS NULL AND c.suspended = 0
    GROUP BY ct.id
    ORDER BY overdue DESC, total DESC
  `).all(ts, userId, userId) as Array<{
    id: string;
    name: string;
    priority_default: string | null;
    conceptual_difficulty_default: string | null;
    chapter_id: string;
    chapter_name: string;
    module_id: string;
    module_name: string;
    subject_id: string;
    subject_name: string;
    total: number;
    new_count: number;
    mature: number;
    overdue: number;
  }>;

  // Decks overview
  const decks = sqlite.prepare(`
    SELECT d.id, d.name,
      COUNT(c.id) as total,
      SUM(CASE WHEN c.state = 'new' THEN 1 ELSE 0 END) as new_count,
      SUM(CASE WHEN c.due_at < ? AND c.state != 'new' THEN 1 ELSE 0 END) as overdue
    FROM decks d
    JOIN cards c ON c.deck_id = d.id AND c.user_id = ?
    WHERE d.user_id = ? AND d.deleted_at IS NULL AND c.deleted_at IS NULL AND c.suspended = 0
    GROUP BY d.id ORDER BY overdue DESC LIMIT 20
  `).all(ts, userId, userId) as Array<{ id: string; name: string; total: number; new_count: number; overdue: number }>;

  if (options.emitEvent !== false) {
    emitAgentEvent(userId, 'agent_summary_generated', 'academic_summary', genId(), {
      totalCards: overall.total_cards,
      subjects: subjects.length,
      modules: modules.length,
      chapters: chapters.length,
      topics: topics.length,
    });
  }

  return {
    timestamp: ts,
    userId,
    cards: {
      total: overall.total_cards ?? 0,
      new: overall.new_cards ?? 0,
      mature: overall.mature_cards ?? 0,
      overdue: overall.overdue_cards ?? 0,
      leeches: overall.leech_cards ?? 0,
      avgRetrievability: overall.avg_retrievability ? Math.round(overall.avg_retrievability * 1000) / 1000 : null,
      avgStabilityDays: overall.avg_stability ? Math.round(overall.avg_stability * 10) / 10 : null,
    },
    activity: {
      last7Days: { reviews: reviews7.count, correctRate: reviews7.count > 0 ? Math.round((reviews7.correct / reviews7.count) * 100) : 0 },
      last30Days: { reviews: reviews30.count, correctRate: reviews30.count > 0 ? Math.round((reviews30.correct / reviews30.count) * 100) : 0 },
    },
    gamification: gamification ? {
      totalXP: gamification.total_xp,
      level: gamification.level,
      currentStreak: gamification.current_streak,
      longestStreak: gamification.longest_streak,
      dailyGoal: gamification.daily_goal,
    } : null,
    subjects: subjectSummaries,
    modules: modules.map((module) => ({
      id: module.id,
      name: module.name,
      subjectId: module.subject_id,
      subjectName: module.subject_name,
      totalCards: module.total,
      newCards: module.new_count,
      matureCards: module.mature,
      overdueCards: module.overdue,
      masteryPercent: module.total > 0 ? Math.round((module.mature / module.total) * 100) : 0,
      riskLevel: getRiskLevel(module.overdue, module.total),
    })),
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      name: chapter.name,
      examScope: chapter.exam_scope,
      moduleId: chapter.module_id,
      moduleName: chapter.module_name,
      subjectId: chapter.subject_id,
      subjectName: chapter.subject_name,
      totalCards: chapter.total,
      newCards: chapter.new_count,
      matureCards: chapter.mature,
      overdueCards: chapter.overdue,
      masteryPercent: chapter.total > 0 ? Math.round((chapter.mature / chapter.total) * 100) : 0,
      riskLevel: getRiskLevel(chapter.overdue, chapter.total),
    })),
    topics: topics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      priorityDefault: topic.priority_default,
      conceptualDifficultyDefault: topic.conceptual_difficulty_default,
      chapterId: topic.chapter_id,
      chapterName: topic.chapter_name,
      moduleId: topic.module_id,
      moduleName: topic.module_name,
      subjectId: topic.subject_id,
      subjectName: topic.subject_name,
      totalCards: topic.total,
      newCards: topic.new_count,
      matureCards: topic.mature,
      overdueCards: topic.overdue,
      masteryPercent: topic.total > 0 ? Math.round((topic.mature / topic.total) * 100) : 0,
      riskLevel: getRiskLevel(topic.overdue, topic.total),
    })),
    decks: decks.map(d => ({
      id: d.id,
      name: d.name,
      totalCards: d.total,
      newCards: d.new_count,
      overdueCards: d.overdue,
    })),
  };
}

function toCoverageBreakdownItem<
  T extends {
    id: string;
    name: string;
    totalCards: number;
    newCards: number;
    matureCards: number;
    overdueCards: number;
    masteryPercent: number;
    riskLevel: 'low' | 'medium' | 'high';
    subjectName?: string;
    moduleName?: string;
    chapterName?: string;
  },
>(item: T): AcademicCoverageBreakdownItem {
  return {
    id: item.id,
    name: item.name,
    subjectName: item.subjectName,
    moduleName: item.moduleName,
    chapterName: item.chapterName,
    totalCards: item.totalCards,
    newCards: item.newCards,
    matureCards: item.matureCards,
    overdueCards: item.overdueCards,
    masteryPercent: item.masteryPercent,
    riskLevel: item.riskLevel,
    coveragePercent: getCoveragePercent(item.newCards, item.totalCards),
    overdueRatioPercent: getOverdueRatioPercent(item.overdueCards, item.totalCards),
  };
}

export function getAcademicCoverage(userId: string): AcademicCoverageSnapshot {
  ensureMigrated();
  const summary = getAcademicSummary(userId, { emitEvent: false });

  const linkedRow = sqlite.prepare(`
    SELECT COUNT(DISTINCT c.id) as count
    FROM cards c
    JOIN curriculum_links cl
      ON (
        cl.card_id = c.id
        OR cl.note_id = c.note_id
        OR cl.deck_id = c.deck_id
      )
    WHERE c.user_id = ?
      AND c.deleted_at IS NULL
      AND c.suspended = 0
      AND cl.deleted_at IS NULL
  `).get(userId) as { count: number };

  const highRiskRow = sqlite.prepare(`
    SELECT COUNT(*) as count
    FROM cards
    WHERE user_id = ?
      AND retrievability IS NOT NULL
      AND retrievability < 0.7
      AND deleted_at IS NULL
      AND suspended = 0
  `).get(userId) as { count: number };

  const curriculumLinkedCards = linkedRow.count ?? 0;
  const totalCards = summary.cards.total;
  const unlinkedCards = Math.max(totalCards - curriculumLinkedCards, 0);

  const snapshot: AcademicCoverageSnapshot = {
    timestamp: summary.timestamp,
    userId,
    overall: {
      totalCards,
      newCards: summary.cards.new,
      matureCards: summary.cards.mature,
      overdueCards: summary.cards.overdue,
      highRiskCards: highRiskRow.count ?? 0,
      pendingAiReviewCards: countPendingAiReviewCards(userId),
      studiedCoveragePercent: getCoveragePercent(summary.cards.new, totalCards),
      overdueRatioPercent: getOverdueRatioPercent(summary.cards.overdue, totalCards),
      curriculumLinkedCards,
      curriculumLinkedPercent: totalCards > 0 ? Math.round(((curriculumLinkedCards / totalCards) * 100) * 10) / 10 : 0,
      unlinkedCards,
    },
    atRisk: {
      subjects: summary.subjects
        .map((subject) => toCoverageBreakdownItem(subject))
        .filter((subject) => subject.riskLevel !== 'low' || subject.overdueCards > 0)
        .sort((left, right) => right.overdueRatioPercent - left.overdueRatioPercent)
        .slice(0, 5),
      topics: summary.topics
        .map((topic) => toCoverageBreakdownItem(topic))
        .filter((topic) => topic.riskLevel !== 'low' || topic.overdueCards > 0)
        .sort((left, right) => right.overdueRatioPercent - left.overdueRatioPercent)
        .slice(0, 8),
    },
    subjects: summary.subjects
      .map((subject) => toCoverageBreakdownItem(subject))
      .sort((left, right) => right.overdueRatioPercent - left.overdueRatioPercent),
    modules: summary.modules
      .map((module) => toCoverageBreakdownItem(module))
      .sort((left, right) => right.overdueRatioPercent - left.overdueRatioPercent),
    chapters: summary.chapters
      .map((chapter) => toCoverageBreakdownItem(chapter))
      .sort((left, right) => right.overdueRatioPercent - left.overdueRatioPercent),
    topics: summary.topics
      .map((topic) => toCoverageBreakdownItem(topic))
      .sort((left, right) => right.overdueRatioPercent - left.overdueRatioPercent),
  };

  emitAgentEvent(userId, 'agent_coverage_generated', 'coverage', genId(), {
    totalCards: snapshot.overall.totalCards,
    linkedCards: snapshot.overall.curriculumLinkedCards,
    linkedPercent: snapshot.overall.curriculumLinkedPercent,
    highRiskCards: snapshot.overall.highRiskCards,
    pendingAiReviewCards: snapshot.overall.pendingAiReviewCards,
  });

  return snapshot;
}

// ─── Review Status Update ──────────────────────────────────────────────────

export function updateReviewStatus(
  userId: string,
  noteIds: string[],
  status: 'reviewed' | 'corrected',
  agentId = 'unknown'
): { updated: number; notFound: number } {
  ensureMigrated();

  let updated = 0;
  let notFound = 0;

  for (const noteId of noteIds) {
    const note = sqlite.prepare(
      `SELECT id, source, source_metadata FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
    ).get(noteId, userId) as { id: string; source: string | null; source_metadata: string | null } | undefined;

    if (!note) {
      notFound++;
      continue;
    }

    const meta = buildCanonicalSourceMetadata({
      source: note.source || 'agent-import',
      sourceMetadata: note.source_metadata ? JSON.parse(note.source_metadata) as Record<string, unknown> : {},
      aiReviewStatus: status,
      agentId,
    }) as Record<string, unknown>;
    meta.reviewedAt = nowIso();
    meta.reviewedBy = agentId;

    sqlite.prepare(
      `UPDATE notes SET source_metadata = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    ).run(JSON.stringify(meta), nowIso(), noteId, userId);
    updated++;
  }

  emitAgentEvent(userId, 'agent_review_status_updated', 'notes', genId(), {
    agentId,
    status,
    noteIds,
    updated,
    notFound,
  });

  return { updated, notFound };
}

// ─── Study Scopes ──────────────────────────────────────────────────────────

export function getStudyScopes(userId: string) {
  ensureMigrated();
  const ts = nowIso();

  // Decks with card stats
  const decks = sqlite.prepare(`
    SELECT d.id, d.name,
      COUNT(c.id) as total,
      SUM(CASE WHEN c.state = 'new' THEN 1 ELSE 0 END) as new_count,
      SUM(CASE WHEN c.due_at < ? AND c.state != 'new' THEN 1 ELSE 0 END) as overdue,
      SUM(CASE WHEN c.state = 'review' AND c.reps >= 3 THEN 1 ELSE 0 END) as mature
    FROM decks d
    JOIN cards c ON c.deck_id = d.id AND c.user_id = ?
    WHERE d.user_id = ? AND d.deleted_at IS NULL AND c.deleted_at IS NULL AND c.suspended = 0
    GROUP BY d.id ORDER BY d.name
  `).all(ts, userId, userId) as Array<{
    id: string; name: string; total: number; new_count: number; overdue: number; mature: number;
  }>;

  // Programs
  const programs = sqlite.prepare(`
    SELECT id, name, career, year, semester
    FROM curriculum_programs WHERE user_id = ? AND deleted_at IS NULL ORDER BY name
  `).all(userId) as Array<{ id: string; name: string; career: string | null; year: number | null; semester: number | null }>;

  // Subjects
  const subjects = sqlite.prepare(`
    SELECT id, name, code, program_id
    FROM curriculum_subjects WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order, name
  `).all(userId) as Array<{ id: string; name: string; code: string | null; program_id: string }>;

  const modules = sqlite.prepare(`
    SELECT id, name, subject_id
    FROM curriculum_modules WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order, name
  `).all(userId) as Array<{ id: string; name: string; subject_id: string }>;

  const chapters = sqlite.prepare(`
    SELECT id, name, module_id, exam_scope
    FROM curriculum_chapters WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order, name
  `).all(userId) as Array<{ id: string; name: string; module_id: string; exam_scope: string | null }>;

  const topics = sqlite.prepare(`
    SELECT id, name, chapter_id, priority_default, conceptual_difficulty_default
    FROM curriculum_topics WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order, name
  `).all(userId) as Array<{
    id: string;
    name: string;
    chapter_id: string;
    priority_default: string | null;
    conceptual_difficulty_default: string | null;
  }>;

  // Note types
  const noteTypes = sqlite.prepare(`
    SELECT id, name, kind FROM note_types WHERE user_id = ? AND deleted_at IS NULL ORDER BY name
  `).all(userId) as Array<{ id: string; name: string; kind: string }>;

  return {
    timestamp: ts,
    userId,
    decks: decks.map(d => ({
      id: d.id,
      name: d.name,
      totalCards: d.total,
      newCards: d.new_count,
      overdueCards: d.overdue,
      matureCards: d.mature,
    })),
    programs,
    subjects: subjects.map(s => ({ ...s, programId: s.program_id })),
    modules: modules.map((module) => ({ ...module, subjectId: module.subject_id })),
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      name: chapter.name,
      moduleId: chapter.module_id,
      examScope: chapter.exam_scope,
    })),
    topics: topics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      chapterId: topic.chapter_id,
      priorityDefault: topic.priority_default,
      conceptualDifficultyDefault: topic.conceptual_difficulty_default,
    })),
    noteTypes,
  };
}
