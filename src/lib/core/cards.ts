// ============================================================================
// RecallForge — Cards
// ============================================================================
// A card is one question/answer pair with its own FSRS memory state.
// ============================================================================

import { z } from 'zod';
import { genId, getDb, nowIso } from './db';
import { deckScopeSql, getOrCreateDeck } from './decks';
import { badRequest, notFound } from './errors';
import { getSettings } from './settings';
import { checkCardQuality } from './quality';
import { retrievability } from './scheduler';
import type { Card, CardRow, QuestionCard, StudySettings } from './types';

const tagsSchema = z.array(z.string().trim().min(1).max(100)).max(30);

export const CardInputSchema = z.object({
  front: z.string().trim().min(1).max(4000),
  back: z.string().trim().min(1).max(8000),
  explanation: z.string().trim().max(8000).optional(),
  source: z.string().trim().max(500).optional(),
  tags: tagsSchema.optional(),
  deck: z.string().trim().min(1).max(300).optional(),
  /** Index of the document part (page, slide, section) the card comes from. */
  documentPart: z.number().int().min(0).optional(),
});

export const AddCardsSchema = z.object({
  deck: z.string().trim().min(1).max(300).optional(),
  cards: z.array(CardInputSchema).min(1).max(500),
  allowDuplicates: z.boolean().optional(),
  /** Source document; its default deck is used when no deck is given. */
  documentId: z.string().trim().min(1).optional(),
  /** Create the cards as drafts that the learner approves before studying them. */
  draft: z.boolean().optional(),
});

export const ApproveCardsSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(1000).optional(),
    documentId: z.string().min(1).optional(),
    deck: z.string().trim().min(1).max(300).optional(),
  })
  .refine((value) => value.ids || value.documentId || value.deck, 'Provide ids, documentId or deck');

export const CardPatchSchema = z
  .object({
    front: z.string().trim().min(1).max(4000),
    back: z.string().trim().min(1).max(8000),
    explanation: z.string().trim().max(8000),
    source: z.string().trim().max(500),
    tags: tagsSchema,
    deck: z.string().trim().min(1).max(300),
    suspended: z.boolean(),
  })
  .partial();

export const SearchCardsSchema = z.object({
  query: z.string().trim().max(500).optional(),
  deck: z.string().trim().max(300).optional(),
  tag: z.string().trim().max(100).optional(),
  documentId: z.string().trim().max(100).optional(),
  state: z.enum(['new', 'learning', 'review', 'suspended', 'due', 'leech', 'draft']).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

export const CARD_SELECT = `SELECT c.*, d.name AS deck_name, doc.title AS document_title, dp.label AS document_label
  FROM cards c
  JOIN decks d ON d.id = c.deck_id
  LEFT JOIN documents doc ON doc.id = c.document_id
  LEFT JOIN document_parts dp ON dp.document_id = c.document_id AND dp.idx = c.document_part`;

export function normalizeTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim().replace(/\s+/g, ' ');
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    result.push(tag);
  }
  return result;
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeFront(front: string): string {
  return front.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function toQuestion(row: CardRow): QuestionCard {
  return {
    id: row.id,
    deck: { id: row.deck_id, name: row.deck_name },
    front: row.front,
    tags: parseTags(row.tags),
    state: row.state,
    reps: row.reps,
    lapses: row.lapses,
  };
}

export function toCard(row: CardRow, settings: StudySettings, now = new Date()): Card {
  return {
    ...toQuestion(row),
    back: row.back,
    explanation: row.explanation,
    source: row.source,
    dueAt: row.due_at,
    stability: Math.round(row.stability * 100) / 100,
    difficulty: Math.round(row.difficulty * 100) / 100,
    retrievability: retrievability(row, settings, now),
    lastReviewAt: row.last_review_at,
    suspended: row.suspended === 1,
    status: row.status ?? 'active',
    document:
      row.document_id && row.document_title
        ? { id: row.document_id, title: row.document_title, part: row.document_part, label: row.document_label ?? null }
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getCardRow(userId: string, id: string): CardRow {
  const row = getDb().prepare(`${CARD_SELECT} WHERE c.user_id = ? AND c.id = ?`).get(userId, id) as CardRow | undefined;
  if (!row) throw notFound('Card', id);
  return row;
}

export function getCard(userId: string, id: string): Card {
  return toCard(getCardRow(userId, id), getSettings(userId));
}

export interface AddCardsResult {
  created: Array<{ id: string; deck: string; front: string }>;
  skipped: Array<{ index: number; front: string; reason: string; existingCardId?: string }>;
  /** Possible quality problems; the cards were still created. Fix them with update_card. */
  warnings: Array<{ index: number; cardId: string; front: string; issues: string[] }>;
  decksCreated: string[];
  status: 'active' | 'draft';
}

export function addCards(userId: string, input: unknown): AddCardsResult {
  const parsed = AddCardsSchema.safeParse(input);
  if (!parsed.success) throw badRequest('Invalid cards', parsed.error.issues);
  const { cards, allowDuplicates, documentId } = parsed.data;
  const status = parsed.data.draft ? 'draft' : 'active';
  const db = getDb();

  const document = documentId
    ? (db
        .prepare(
          `SELECT doc.id, doc.title, doc.parts, d.name AS deck_name FROM documents doc
           LEFT JOIN decks d ON d.id = doc.deck_id WHERE doc.user_id = ? AND doc.id = ?`
        )
        .get(userId, documentId) as { id: string; title: string; parts: number; deck_name: string | null } | undefined)
    : undefined;
  if (documentId && !document) throw notFound('Document', documentId);
  const defaultDeck = parsed.data.deck ?? document?.deck_name ?? undefined;

  for (const [index, card] of cards.entries()) {
    if (!card.deck && !defaultDeck) throw badRequest(`Card ${index} has no deck (set "deck" on the request or the card)`);
    if (card.documentPart !== undefined && (!document || card.documentPart >= document.parts)) {
      throw badRequest(`Card ${index} has an invalid documentPart`);
    }
  }

  const result: AddCardsResult = { created: [], skipped: [], warnings: [], decksCreated: [], status };
  const insert = db.prepare(`
    INSERT INTO cards (id, user_id, deck_id, front, back, explanation, source, tags, state, due_at, status, document_id, document_part, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)
  `);
  const partLabel = db.prepare(`SELECT label FROM document_parts WHERE document_id = ? AND idx = ?`);

  db.transaction(() => {
    const fronts = new Map<string, Map<string, string>>();
    const frontsFor = (deckId: string) => {
      let map = fronts.get(deckId);
      if (!map) {
        map = new Map();
        const rows = db.prepare(`SELECT id, front FROM cards WHERE deck_id = ?`).all(deckId) as Array<{ id: string; front: string }>;
        for (const row of rows) map.set(normalizeFront(row.front), row.id);
        fronts.set(deckId, map);
      }
      return map;
    };

    for (const [index, card] of cards.entries()) {
      const { deck, created } = getOrCreateDeck(userId, card.deck ?? defaultDeck!);
      if (created) result.decksCreated.push(deck.name);
      const existing = frontsFor(deck.id);
      const key = normalizeFront(card.front);
      const duplicateOf = existing.get(key);
      if (duplicateOf && !allowDuplicates) {
        result.skipped.push({ index, front: card.front, reason: 'duplicate front in deck', existingCardId: duplicateOf });
        continue;
      }
      // Stagger creation times by a millisecond so new cards keep their input order.
      const createdAt = new Date(Date.now() + index).toISOString();
      const id = genId();
      const label =
        document && card.documentPart !== undefined
          ? (partLabel.get(document.id, card.documentPart) as { label: string } | undefined)?.label
          : undefined;
      const source = card.source ?? (document ? [document.title, label].filter(Boolean).join(', ') : '');
      insert.run(
        id,
        userId,
        deck.id,
        card.front,
        card.back,
        card.explanation ?? '',
        source,
        JSON.stringify(normalizeTags(card.tags)),
        createdAt,
        status,
        document?.id ?? null,
        card.documentPart ?? null,
        createdAt,
        createdAt
      );
      existing.set(key, id);
      result.created.push({ id, deck: deck.name, front: card.front });
      const issues = checkCardQuality(card);
      if (issues.length > 0) result.warnings.push({ index, cardId: id, front: card.front, issues });
    }
  })();

  return result;
}

export function updateCard(userId: string, id: string, patch: unknown): Card {
  const parsed = CardPatchSchema.safeParse(patch);
  if (!parsed.success) throw badRequest('Invalid card update', parsed.error.issues);
  const row = getCardRow(userId, id);
  const data = parsed.data;
  const deckId = data.deck ? getOrCreateDeck(userId, data.deck).deck.id : row.deck_id;

  getDb()
    .prepare(
      `UPDATE cards SET front = ?, back = ?, explanation = ?, source = ?, tags = ?, deck_id = ?, suspended = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .run(
      data.front ?? row.front,
      data.back ?? row.back,
      data.explanation ?? row.explanation,
      data.source ?? row.source,
      data.tags ? JSON.stringify(normalizeTags(data.tags)) : row.tags,
      deckId,
      data.suspended === undefined ? row.suspended : data.suspended ? 1 : 0,
      nowIso(),
      id,
      userId
    );
  return getCard(userId, id);
}

export function deleteCards(userId: string, ids: string[]): { deleted: string[]; notFound: string[] } {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) throw badRequest('Provide between 1 and 500 card ids');
  const db = getDb();
  const remove = db.prepare(`DELETE FROM cards WHERE id = ? AND user_id = ?`);
  const result = { deleted: [] as string[], notFound: [] as string[] };
  db.transaction(() => {
    for (const id of ids) (remove.run(id, userId).changes > 0 ? result.deleted : result.notFound).push(id);
  })();
  return result;
}

/** SQL fragment matching a tag exactly or as a "parent::child" prefix. */
export function tagFilterSql(param: string): string {
  return `EXISTS (SELECT 1 FROM json_each(c.tags) t WHERE t.value = ${param} COLLATE NOCASE OR t.value LIKE ${param} || '::%')`;
}

export function searchCards(userId: string, input: unknown, now = new Date()): { total: number; cards: Card[] } {
  const parsed = SearchCardsSchema.safeParse(input);
  if (!parsed.success) throw badRequest('Invalid search', parsed.error.issues);
  const { query, deck, tag, documentId, state, limit = 50, offset = 0 } = parsed.data;

  const where = ['c.user_id = @userId', state === 'draft' ? `c.status = 'draft'` : `c.status = 'active'`];
  const params: Record<string, unknown> = { userId, now: now.toISOString() };
  if (deck) {
    const scope = deckScopeSql(userId, deck);
    where.push(scope.sql);
    Object.assign(params, scope.params);
  }
  if (documentId) {
    where.push('c.document_id = @documentId');
    params.documentId = documentId;
  }
  if (tag) {
    where.push(tagFilterSql('@tag'));
    params.tag = tag;
  }
  if (query) {
    where.push(
      `(c.front LIKE @q ESCAPE '\\' OR c.back LIKE @q ESCAPE '\\' OR c.explanation LIKE @q ESCAPE '\\' OR c.tags LIKE @q ESCAPE '\\')`
    );
    params.q = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  }
  switch (state) {
    case 'new':
    case 'review':
      where.push(`c.state = '${state}' AND c.suspended = 0`);
      break;
    case 'learning':
      where.push(`c.state IN ('learning', 'relearning') AND c.suspended = 0`);
      break;
    case 'suspended':
      where.push('c.suspended = 1');
      break;
    case 'due':
      where.push(`c.state != 'new' AND c.suspended = 0 AND c.due_at <= @now`);
      break;
    case 'leech':
      where.push('c.lapses >= 4');
      break;
  }

  const db = getDb();
  const whereSql = where.join(' AND ');
  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM cards c WHERE ${whereSql}`)
    .get(params) as { total: number };
  const order =
    state === 'leech'
      ? 'c.lapses DESC, c.stability ASC'
      : state === 'due'
        ? 'c.due_at ASC'
        : state === 'draft'
          ? 'c.created_at ASC'
          : 'c.created_at DESC';
  const rows = db
    .prepare(`${CARD_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset }) as CardRow[];

  const settings = getSettings(userId);
  return { total, cards: rows.map((row) => toCard(row, settings, now)) };
}

/**
 * Approve draft cards so they enter the study queue: by ids, by source
 * document, or every draft in a deck (and its subdecks).
 */
export function approveCards(userId: string, input: unknown): { approved: number } {
  const parsed = ApproveCardsSchema.safeParse(input);
  if (!parsed.success) throw badRequest('Invalid approval', parsed.error.issues);
  const { ids, documentId, deck } = parsed.data;
  const where = [`c.user_id = @userId`, `c.status = 'draft'`];
  const params: Record<string, unknown> = { userId, now: nowIso() };
  if (ids) {
    where.push(`c.id IN (SELECT value FROM json_each(@ids))`);
    params.ids = JSON.stringify(ids);
  }
  if (documentId) {
    where.push('c.document_id = @documentId');
    params.documentId = documentId;
  }
  if (deck) {
    const scope = deckScopeSql(userId, deck);
    where.push(scope.sql);
    Object.assign(params, scope.params);
  }
  const result = getDb()
    .prepare(
      `UPDATE cards SET status = 'active', due_at = @now, updated_at = @now
       WHERE id IN (SELECT c.id FROM cards c WHERE ${where.join(' AND ')})`
    )
    .run(params);
  return { approved: result.changes };
}
