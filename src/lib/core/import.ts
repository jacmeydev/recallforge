// ============================================================================
// RecallForge — Import
// ============================================================================
//   JSON  a RecallForge export (any version): restores subjects, exam dates,
//         documents, cards with their memory state, reviews and edit history.
//         Merges: anything whose id already exists is left untouched, so
//         importing the same backup twice changes nothing.
//   Text  CSV/TSV (Anki "Notes in Plain Text", spreadsheets): one card per
//         line, front and back first. Anki headers (#separator, #html,
//         #deck column, #tags column) are understood. Cards are created new.
// ============================================================================

import { z } from 'zod';
import { getDb, nowIso } from './db';
import { addCards, normalizeTags } from './cards';
import { getOrCreateDeck } from './decks';
import { badRequest } from './errors';
import { EXPORT_FORMAT } from './export';
import { htmlToText } from './text';

export const ImportOptionsSchema = z.object({
  /** Subject for text imports without a deck column. */
  deck: z.string().trim().min(1).max(300).optional(),
  /** Text imports: create the cards as drafts to review first. */
  draft: z.boolean().optional(),
});

export interface ImportResult {
  format: 'recallforge' | 'delimited';
  decks: number;
  documents: number;
  cards: number;
  reviews: number;
  revisions: number;
  /** Items already present (same id) or duplicates, left untouched. */
  skipped: number;
  warnings: string[];
}

const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

export function importData(userId: string, content: string, optionsInput: unknown = {}): ImportResult {
  const options = ImportOptionsSchema.safeParse(optionsInput ?? {});
  if (!options.success) throw badRequest('Invalid import options', options.error.issues);
  if (content.length > MAX_IMPORT_BYTES) throw badRequest('The file is too large to import');
  const trimmed = content.replace(/^﻿/, '').trim();
  if (!trimmed) throw badRequest('The file is empty');
  if (trimmed.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw badRequest('The file looks like JSON but could not be parsed');
    }
    return importBackup(userId, parsed);
  }
  return importDelimited(userId, trimmed, options.data);
}

// ---------------------------------------------------------------------------
// RecallForge JSON
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const strOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter((item): item is Json => !!item && typeof item === 'object') : []);
const CARD_STATES = new Set(['new', 'learning', 'review', 'relearning']);
const RATINGS = new Set(['again', 'hard', 'good', 'easy']);

function importBackup(userId: string, data: unknown): ImportResult {
  const backup = (data ?? {}) as Json;
  if (backup.format !== EXPORT_FORMAT) throw badRequest(`Not a RecallForge export (expected "format": "${EXPORT_FORMAT}")`);
  const db = getDb();
  const result: ImportResult = { format: 'recallforge', decks: 0, documents: 0, cards: 0, reviews: 0, revisions: 0, skipped: 0, warnings: [] };
  const now = nowIso();
  const exists = (table: string, id: string) => db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id) !== undefined;

  db.transaction(() => {
    const deckIdByName = new Map<string, string>();
    const deckId = (name: string) => {
      const key = name.toLowerCase();
      let id = deckIdByName.get(key);
      if (!id) {
        const { deck, created } = getOrCreateDeck(userId, name);
        if (created) result.decks++;
        id = deck.id;
        deckIdByName.set(key, id);
      }
      return id;
    };

    for (const deck of list(backup.decks)) {
      const name = str(deck.name);
      if (!name) continue;
      const id = deckId(name);
      db.prepare(
        `UPDATE decks SET description = CASE WHEN description = '' THEN ? ELSE description END,
                          exam_date = COALESCE(exam_date, ?) WHERE id = ?`
      ).run(str(deck.description), strOrNull(deck.examDate), id);
    }

    const documentIds = new Set<string>();
    for (const doc of list(backup.documents)) {
      const id = str(doc.id);
      if (!id) continue;
      if (exists('documents', id)) {
        result.skipped++;
        documentIds.add(id);
        continue;
      }
      const parts = list(doc.parts);
      const deck = str(doc.deck);
      db.prepare(
        `INSERT INTO documents (id, user_id, title, filename, mime_type, deck_id, parts, chars, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        userId,
        str(doc.title, 'Documento'),
        strOrNull(doc.filename),
        strOrNull(doc.mimeType),
        deck ? deckId(deck) : null,
        parts.length,
        parts.reduce((sum, part) => sum + str(part.text).length, 0),
        str(doc.createdAt, now),
        str(doc.updatedAt, now)
      );
      const insertPart = db.prepare(`INSERT INTO document_parts (document_id, idx, label, text) VALUES (?, ?, ?, ?)`);
      parts.forEach((part, idx) => insertPart.run(id, idx, str(part.label, `parte ${idx + 1}`), str(part.text)));
      documentIds.add(id);
      result.documents++;
    }

    const insertCard = db.prepare(`
      INSERT INTO cards (id, user_id, deck_id, front, back, explanation, source, excerpt, tags, state, due_at,
        stability, difficulty, elapsed_days, scheduled_days, reps, lapses, learning_steps, last_review_at,
        suspended, status, document_id, document_part, created_at, updated_at)
      VALUES (@id, @userId, @deckId, @front, @back, @explanation, @source, @excerpt, @tags, @state, @dueAt,
        @stability, @difficulty, @elapsedDays, @scheduledDays, @reps, @lapses, @learningSteps, @lastReviewAt,
        @suspended, @status, @documentId, @documentPart, @createdAt, @updatedAt)`);
    const cardIds = new Set<string>();
    for (const card of list(backup.cards)) {
      const id = str(card.id);
      const front = str(card.front).trim();
      const back = str(card.back).trim();
      const deck = str((card.deck as Json | undefined)?.name ?? card.deck);
      if (!id || !front || !back || !deck) {
        result.warnings.push(`Skipped an incomplete card${id ? ` (${id})` : ''}`);
        continue;
      }
      if (exists('cards', id)) {
        result.skipped++;
        cardIds.add(id);
        continue;
      }
      const fsrs = (card.fsrs ?? {}) as Json;
      const document = (card.document ?? null) as Json | null;
      const documentId = document && documentIds.has(str(document.id)) ? str(document.id) : null;
      insertCard.run({
        id,
        userId,
        deckId: deckId(deck),
        front,
        back,
        explanation: str(card.explanation),
        source: str(card.source),
        excerpt: str(card.excerpt),
        tags: JSON.stringify(normalizeTags(Array.isArray(card.tags) ? card.tags.filter((t): t is string => typeof t === 'string') : [])),
        state: CARD_STATES.has(str(card.state)) ? str(card.state) : 'new',
        dueAt: str(card.dueAt, now),
        stability: num(fsrs.stability, num(card.stability)),
        difficulty: num(fsrs.difficulty, num(card.difficulty)),
        elapsedDays: num(fsrs.elapsedDays),
        scheduledDays: num(fsrs.scheduledDays),
        reps: num(card.reps),
        lapses: num(card.lapses),
        learningSteps: num(fsrs.learningSteps),
        lastReviewAt: strOrNull(card.lastReviewAt),
        suspended: card.suspended === true ? 1 : 0,
        status: card.status === 'draft' ? 'draft' : 'active',
        documentId,
        documentPart: documentId && typeof document?.part === 'number' ? document.part : null,
        createdAt: str(card.createdAt, now),
        updatedAt: str(card.updatedAt, now),
      });
      cardIds.add(id);
      result.cards++;
    }

    const insertLog = db.prepare(`
      INSERT INTO review_logs (id, user_id, card_id, reviewed_at, rating, state, next_state, due_at, next_due_at,
        stability, next_stability, difficulty, next_difficulty, elapsed_days, scheduled_days, duration_ms,
        answer, feedback, source, mode, format, snapshot)
      VALUES (@id, @userId, @cardId, @reviewedAt, @rating, @state, @nextState, @dueAt, @nextDueAt,
        @stability, @nextStability, @difficulty, @nextDifficulty, @elapsedDays, @scheduledDays, @durationMs,
        @answer, @feedback, @source, @mode, @format, @snapshot)`);
    for (const log of list(backup.reviewLogs)) {
      const id = str(log.id);
      const cardId = str(log.cardId);
      if (!id || !cardIds.has(cardId) || !RATINGS.has(str(log.rating)) || !log.reviewedAt) continue;
      if (exists('review_logs', id)) {
        result.skipped++;
        continue;
      }
      insertLog.run({
        id,
        userId,
        cardId,
        reviewedAt: str(log.reviewedAt),
        rating: str(log.rating),
        state: str(log.state, 'new'),
        nextState: str(log.nextState, 'review'),
        dueAt: strOrNull(log.dueAt),
        nextDueAt: str(log.nextDueAt, str(log.reviewedAt)),
        stability: log.stability ?? null,
        nextStability: log.nextStability ?? null,
        difficulty: log.difficulty ?? null,
        nextDifficulty: log.nextDifficulty ?? null,
        elapsedDays: log.elapsedDays ?? null,
        scheduledDays: log.scheduledDays ?? null,
        durationMs: log.durationMs ?? null,
        answer: strOrNull(log.answer),
        feedback: strOrNull(log.feedback),
        source: str(log.source, 'api'),
        mode: str(log.mode, 'review'),
        format: str(log.format, 'recall'),
        snapshot: strOrNull(log.snapshot),
      });
      result.reviews++;
    }

    const insertRevision = db.prepare(
      `INSERT INTO card_revisions (id, user_id, card_id, changed_at, source, reason, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const revision of list(backup.revisions)) {
      const id = str(revision.id);
      const cardId = str(revision.cardId);
      if (!id || !cardIds.has(cardId)) continue;
      if (exists('card_revisions', id)) {
        result.skipped++;
        continue;
      }
      insertRevision.run(
        id,
        userId,
        cardId,
        str(revision.changedAt, now),
        str(revision.source, 'api'),
        strOrNull(revision.reason),
        JSON.stringify(revision.before ?? {}),
        JSON.stringify(revision.after ?? {})
      );
      result.revisions++;
    }
  })();
  return result;
}

// ---------------------------------------------------------------------------
// CSV / TSV
// ---------------------------------------------------------------------------

/** Split delimited text into rows, honouring "quoted" fields with embedded separators, quotes and newlines. */
export function parseDelimited(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let atFieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (char === separator) {
      row.push(field);
      field = '';
      atFieldStart = true;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      atFieldStart = true;
    } else {
      field += char;
      atFieldStart = false;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim()));
}

const SEPARATORS: Record<string, string> = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ', colon: ':' };

function importDelimited(userId: string, text: string, options: z.infer<typeof ImportOptionsSchema>): ImportResult {
  const headers: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  let firstData = 0;
  while (firstData < lines.length && lines[firstData].startsWith('#')) {
    const match = /^#([^:]+):(.*)$/.exec(lines[firstData]);
    if (match) headers[match[1].trim().toLowerCase()] = match[2].trim();
    firstData++;
  }
  const body = lines.slice(firstData).join('\n');
  const declared = headers.separator?.toLowerCase();
  const separator = declared
    ? SEPARATORS[declared] ?? declared
    : body.includes('\t')
      ? '\t'
      : (body.split('\n')[0].match(/;/g)?.length ?? 0) > (body.split('\n')[0].match(/,/g)?.length ?? 0)
        ? ';'
        : ',';
  const html = headers.html === 'true' || /<(br|div|b|i|p|span|img)\b/i.test(body);
  const clean = (value: string) => (html ? htmlToText(value) : value).trim();
  const deckColumn = headers['deck column'] ? Number(headers['deck column']) - 1 : -1;
  const tagsColumn = headers['tags column'] ? Number(headers['tags column']) - 1 : -1;

  let rows = parseDelimited(body, separator);
  // A header row like "front,back" / "pregunta;respuesta" is not a card.
  if (rows.length && /^(front|question|pregunta|anverso|frente)$/i.test(rows[0][0]?.trim() ?? '')) rows = rows.slice(1);

  const result: ImportResult = { format: 'delimited', decks: 0, documents: 0, cards: 0, reviews: 0, revisions: 0, skipped: 0, warnings: [] };
  const fallbackDeck = options.deck ?? headers.deck ?? 'Importado';
  const cards: Array<{ front: string; back: string; deck: string; tags?: string[] }> = [];
  rows.forEach((row, index) => {
    const fields = row.filter((_, i) => i !== deckColumn && i !== tagsColumn);
    const front = clean(fields[0] ?? '');
    const back = clean(fields[1] ?? '');
    if (!front || !back) {
      result.warnings.push(`Line ${index + 1} has no front or back and was skipped`);
      result.skipped++;
      return;
    }
    const tags = tagsColumn >= 0 ? (row[tagsColumn] ?? '').split(/\s+/).filter(Boolean) : undefined;
    const deck = deckColumn >= 0 && row[deckColumn]?.trim() ? row[deckColumn].trim() : fallbackDeck;
    cards.push({ front: front.slice(0, 4000), back: back.slice(0, 8000), deck, tags });
  });
  if (cards.length === 0) throw badRequest('No cards found: each line needs at least a front and a back');

  for (let i = 0; i < cards.length; i += 500) {
    const chunk = cards.slice(i, i + 500);
    const added = addCards(userId, { cards: chunk, draft: options.draft });
    result.cards += added.created.length;
    result.skipped += added.skipped.length;
    result.decks += added.decksCreated.length;
  }
  if (result.skipped > 0) result.warnings.push(`${result.skipped} lines were skipped (empty or duplicate questions in the same subject)`);
  return result;
}

