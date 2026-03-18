// ============================================================================
// RecallForge — Note Service
// ============================================================================

import { db, queueSync } from '@/lib/db';
import { generateId, now, hashString, extractClozeIndices } from '@/lib/utils';
import { EventEmitters } from '@/lib/events';
import { createNewFSRSCard } from '@/lib/fsrs';
import { serializeNoteFields } from '@/lib/import/canonical';
import { CreateNoteSchema } from '@/lib/validation/schemas';
import type { Note, Card, NoteType, JSONObject } from '@/types';

// ─── Create Note + generate Cards ──────────────────────────────────────────

export async function createNote(
  userId: string,
  data: {
    deckId: string;
    noteTypeId: string;
    fieldValues: Record<string, string>;
    tags?: string[];
    source?: string;
    sourceMetadata?: JSONObject;
  }
): Promise<{ note: Note; cards: Card[] }> {
  const validated = CreateNoteSchema.parse(data);
  const noteType = await db.noteTypes.get(validated.noteTypeId);
  if (!noteType) throw new Error(`NoteType ${validated.noteTypeId} not found`);

  // Compute hash for duplicate detection
  const hashInput = serializeNoteFields(validated.fieldValues);
  const noteHash = await hashString(hashInput);

  const note: Note = {
    id: generateId(),
    userId,
    deckId: validated.deckId,
    noteTypeId: validated.noteTypeId,
    fieldValues: validated.fieldValues,
    tags: validated.tags || [],
    source: validated.source,
    sourceMetadata: validated.sourceMetadata as JSONObject | undefined,
    hash: noteHash,
    createdAt: now(),
    updatedAt: now(),
    suspended: false,
  };

  // Generate cards from templates
  const cards = generateCardsFromNote(userId, note, noteType);

  await db.transaction('rw', [db.notes, db.cards], async () => {
    await db.notes.add(note);
    await db.cards.bulkAdd(cards);
  });

  await queueSync('notes', note.id, 'create', note as unknown as JSONObject);
  for (const card of cards) {
    await queueSync('cards', card.id, 'create', card as unknown as JSONObject);
  }

  await EventEmitters.noteCreated(userId, note.id, {
    deckId: note.deckId,
    noteTypeId: note.noteTypeId,
    cardsGenerated: cards.length,
  });

  return { note, cards };
}

// ─── Generate cards from Note + NoteType ───────────────────────────────────

export function generateCardsFromNote(
  userId: string,
  note: Note,
  noteType: NoteType
): Card[] {
  const cards: Card[] = [];
  const fsrsDefaults = createNewFSRSCard();

  if (noteType.kind === 'cloze') {
    // For cloze: one card per cloze index
    const allText = Object.values(note.fieldValues).join(' ');
    const indices = extractClozeIndices(allText);

    const template = noteType.templates[0];
    if (!template) return cards;

    for (const idx of indices) {
      cards.push({
        id: generateId(),
        userId,
        noteId: note.id,
        templateId: template.id,
        deckId: note.deckId,
        state: 'new',
        queuePosition: 0,
        suspended: false,
        buriedUntil: null,
        customData: { clozeIndex: idx },
        createdAt: now(),
        updatedAt: now(),
        ...fsrsDefaults,
      } as Card);
    }
  } else if (noteType.kind === 'image_occlusion') {
    // For IO: one card per mask zone
    const template = noteType.templates[0];
    if (!template) return cards;

    let maskCount = 1;
    try {
      const masksJson = note.fieldValues['Masks'];
      if (masksJson) {
        const parsed = JSON.parse(masksJson);
        if (Array.isArray(parsed) && parsed.length > 0) maskCount = parsed.length;
      }
    } catch { /* use default 1 */ }

    for (let i = 0; i < maskCount; i++) {
      cards.push({
        id: generateId(),
        userId,
        noteId: note.id,
        templateId: template.id,
        deckId: note.deckId,
        state: 'new',
        queuePosition: 0,
        suspended: false,
        buriedUntil: null,
        customData: { maskIndex: i },
        createdAt: now(),
        updatedAt: now(),
        ...fsrsDefaults,
      } as Card);
    }
  } else {
    // For other types: one card per active template
    for (const template of noteType.templates) {
      if (!template.active) continue;

      cards.push({
        id: generateId(),
        userId,
        noteId: note.id,
        templateId: template.id,
        deckId: note.deckId,
        state: 'new',
        queuePosition: 0,
        suspended: false,
        buriedUntil: null,
        customData: {},
        createdAt: now(),
        updatedAt: now(),
        ...fsrsDefaults,
      } as Card);
    }
  }

  return cards;
}

// ─── Update Note ───────────────────────────────────────────────────────────

export async function updateNote(
  userId: string,
  noteId: string,
  data: Partial<Pick<Note, 'fieldValues' | 'tags' | 'deckId' | 'suspended'>>
): Promise<Note | undefined> {
  const existing = await db.notes.get(noteId);
  if (!existing) return undefined;

  const merged = { ...existing, ...data, updatedAt: now() } as Note;

  if (data.fieldValues) {
    const hashInput = serializeNoteFields(data.fieldValues);
    merged.hash = await hashString(hashInput);
  }

  // ─── IO card sync: adjust cards when mask count changes ──────────
  if (data.fieldValues) {
    const noteType = await db.noteTypes.get(existing.noteTypeId);
    if (noteType?.kind === 'image_occlusion') {
      const oldMasks = parseMaskCount(existing.fieldValues['Masks']);
      const newMasks = parseMaskCount(data.fieldValues['Masks']);

      if (oldMasks !== newMasks) {
        await syncIOCards(userId, merged, noteType, oldMasks, newMasks);
      }
    }
  }

  await db.notes.put(merged);
  await queueSync('notes', noteId, 'update', merged as unknown as JSONObject);
  await EventEmitters.noteUpdated(userId, noteId);

  return db.notes.get(noteId);
}

// ─── IO card sync helpers ──────────────────────────────────────────────────

function parseMaskCount(masksJson: string | undefined): number {
  if (!masksJson) return 0;
  try {
    const parsed = JSON.parse(masksJson);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Positional sync: preserve existing cards (and their FSRS state),
 * add new ones for extra masks, delete excess ones.
 *
 * - Cards with maskIndex < newCount are kept untouched (preserving
 *   stability, difficulty, reps, lapses, due dates, review logs).
 * - Cards with maskIndex >= newCount are deleted.
 * - New cards are created for maskIndex values that have no card yet.
 */
async function syncIOCards(
  userId: string,
  note: Note,
  noteType: NoteType,
  _oldCount: number,
  newCount: number,
): Promise<void> {
  const template = noteType.templates[0];
  if (!template) return;

  const existingCards = await db.cards
    .where('noteId')
    .equals(note.id)
    .toArray();

  // Separate IO cards by maskIndex
  const ioCards = existingCards.filter(
    c => (c.customData as Record<string, unknown>)?.maskIndex !== undefined
  );

  // Build a map: maskIndex → card
  const byIndex = new Map<number, Card>();
  for (const card of ioCards) {
    const idx = (card.customData as Record<string, number>).maskIndex;
    byIndex.set(idx, card);
  }

  const fsrsDefaults = createNewFSRSCard();

  await db.transaction('rw', [db.cards], async () => {
    // Delete cards whose maskIndex >= newCount
    const toDelete = ioCards.filter(
      c => (c.customData as Record<string, number>).maskIndex >= newCount
    );
    if (toDelete.length > 0) {
      await db.cards.bulkDelete(toDelete.map(c => c.id));
    }

    // Create cards for new indices that don't have a card yet
    const toAdd: Card[] = [];
    for (let i = 0; i < newCount; i++) {
      if (!byIndex.has(i)) {
        toAdd.push({
          id: generateId(),
          userId,
          noteId: note.id,
          templateId: template.id,
          deckId: note.deckId,
          state: 'new',
          queuePosition: 0,
          suspended: false,
          buriedUntil: null,
          customData: { maskIndex: i },
          createdAt: now(),
          updatedAt: now(),
          ...fsrsDefaults,
        } as Card);
      }
    }
    if (toAdd.length > 0) {
      await db.cards.bulkAdd(toAdd);
    }
  });

  // Queue sync for deleted/added cards
  const deletedCards = ioCards.filter(
    c => (c.customData as Record<string, number>).maskIndex >= newCount
  );
  for (const card of deletedCards) {
    await queueSync('cards', card.id, 'delete', {});
  }

  const addedCards = await db.cards
    .where('noteId')
    .equals(note.id)
    .toArray();
  for (const card of addedCards) {
    const idx = (card.customData as Record<string, number>)?.maskIndex;
    if (idx !== undefined && !byIndex.has(idx) && idx < newCount) {
      await queueSync('cards', card.id, 'create', card as unknown as JSONObject);
    }
  }
}

// ─── Delete Note ───────────────────────────────────────────────────────────

export async function deleteNote(userId: string, noteId: string): Promise<void> {
  await db.transaction('rw', [db.notes, db.cards], async () => {
    await db.cards.where('noteId').equals(noteId).delete();
    await db.notes.delete(noteId);
  });

  await queueSync('notes', noteId, 'delete', {});
  await EventEmitters.noteDeleted(userId, noteId);
}

// ─── Get Notes ─────────────────────────────────────────────────────────────

export async function getNotes(
  userId: string,
  options?: {
    deckId?: string;
    noteTypeId?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
  }
): Promise<Note[]> {
  let collection = db.notes.where('userId').equals(userId);
  let results = await collection.toArray();

  if (options?.deckId) {
    results = results.filter(n => n.deckId === options.deckId);
  }
  if (options?.noteTypeId) {
    results = results.filter(n => n.noteTypeId === options.noteTypeId);
  }
  if (options?.tags && options.tags.length > 0) {
    results = results.filter(n =>
      options.tags!.some(t => n.tags.includes(t))
    );
  }

  results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (options?.offset) results = results.slice(options.offset);
  if (options?.limit) results = results.slice(0, options.limit);

  return results;
}

export async function getNote(noteId: string): Promise<Note | undefined> {
  return db.notes.get(noteId);
}

// ─── Duplicate detection ──────────────────────────────────────────────────

export async function findDuplicates(
  userId: string,
  fieldValues: Record<string, string>,
  excludeNoteId?: string
): Promise<Note[]> {
  const hashInput = serializeNoteFields(fieldValues);
  const hash = await hashString(hashInput);

  let duplicates = await db.notes
    .where('hash')
    .equals(hash)
    .filter(n => n.userId === userId)
    .toArray();

  if (excludeNoteId) {
    duplicates = duplicates.filter(n => n.id !== excludeNoteId);
  }

  return duplicates;
}

// ─── Get cards for a note ──────────────────────────────────────────────────

export async function getCardsForNote(noteId: string): Promise<Card[]> {
  return db.cards.where('noteId').equals(noteId).toArray();
}
