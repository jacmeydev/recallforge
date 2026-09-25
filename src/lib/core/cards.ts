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
import { containsLoosely, contentWords, similarity } from './text';
import { retrievability } from './scheduler';
import type { Card, CardRow, QuestionCard, StudySettings } from './types';

const tagsSchema = z.array(z.string().trim().min(1).max(100)).max(30);

export const CardInputSchema = z.object({
  front: z.string().trim().min(1).max(4000),
  back: z.string().trim().min(1).max(8000),
  explanation: z.string().trim().max(8000).optional(),
  source: z.string().trim().max(500).optional(),
  /** Exact passage of the source the card is based on (shown to the learner, checked against the document). */
  excerpt: z.string().trim().max(2000).optional(),
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
  /** Only check (duplicates, contradictions, quality, sources) without saving anything. */
  dryRun: z.boolean().optional(),
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
    excerpt: z.string().trim().max(2000),
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
    suggestRephrase: row.state === 'review' && row.reps >= REPHRASE_AFTER_REPS,
  };
}

/** After this many successful reviews, agents should vary the wording of the question. */
export const REPHRASE_AFTER_REPS = 4;

export function toCard(row: CardRow, settings: StudySettings, now = new Date()): Card {
  return {
    ...toQuestion(row),
    back: row.back,
    explanation: row.explanation,
    source: row.source,
    excerpt: row.excerpt ?? '',
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
  /** Possible problems (quality, near-duplicates, contradictions, sources). The cards were still created unless dryRun. */
  warnings: Array<{ index: number; cardId: string | null; front: string; issues: string[] }>;
  decksCreated: string[];
  status: 'active' | 'draft';
  dryRun: boolean;
}

class DryRunRollback extends Error {}

interface SimilarCard {
  id: string;
  front: string;
  back: string;
  frontWords: Set<string>;
  backWords: Set<string>;
}

/**
 * Existing cards of one top-level subject, indexed by word so each new card is
 * only compared with cards that share vocabulary (fast on large collections).
 */
class SimilarityIndex {
  private cards: SimilarCard[] = [];
  private byWord = new Map<string, number[]>();

  add(card: Omit<SimilarCard, 'frontWords' | 'backWords'>) {
    const indexed: SimilarCard = { ...card, frontWords: new Set(contentWords(card.front)), backWords: new Set(contentWords(card.back)) };
    const position = this.cards.push(indexed) - 1;
    for (const word of indexed.frontWords) {
      const list = this.byWord.get(word);
      if (list) list.push(position);
      else this.byWord.set(word, [position]);
    }
  }

  /** Near-duplicates (same question and answer) and contradictions (same question, different answer). */
  check(front: string, back: string): string[] {
    const frontWords = new Set(contentWords(front));
    const backWords = new Set(contentWords(back));
    const shared = new Map<number, number>();
    for (const word of frontWords) for (const position of this.byWord.get(word) ?? []) shared.set(position, (shared.get(position) ?? 0) + 1);
    const issues: string[] = [];
    for (const [position, count] of shared) {
      if (count < Math.min(2, frontWords.size)) continue;
      const other = this.cards[position];
      if (similarity(frontWords, other.frontWords) < 0.6) continue;
      const sameAnswer =
        similarity(backWords, other.backWords) >= 0.5 || containsLoosely(back, other.back) || containsLoosely(other.back, back);
      issues.push(
        sameAnswer
          ? `Near-duplicate of card ${other.id}: "${other.front}"`
          : `Possible contradiction with card ${other.id}: similar question "${other.front}" has a different answer "${other.back}". Check which one is right.`
      );
      if (issues.length >= 3) break;
    }
    return issues;
  }
}

export function addCards(userId: string, input: unknown): AddCardsResult {
  const parsed = AddCardsSchema.safeParse(input);
  if (!parsed.success) throw badRequest('Invalid cards', parsed.error.issues);
  const { cards, allowDuplicates, documentId, dryRun } = parsed.data;
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

  const result: AddCardsResult = { created: [], skipped: [], warnings: [], decksCreated: [], status, dryRun: Boolean(dryRun) };
  const insert = db.prepare(`
    INSERT INTO cards (id, user_id, deck_id, front, back, explanation, source, excerpt, tags, state, due_at, status, document_id, document_part, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)
  `);
  const partRow = db.prepare(`SELECT label, text FROM document_parts WHERE document_id = ? AND idx = ?`);

  // One similarity index per top-level subject ("Medicina" for "Medicina::Farmacología").
  const indexes = new Map<string, SimilarityIndex>();
  const indexFor = (deckName: string) => {
    const root = deckName.split('::')[0];
    let index = indexes.get(root.toLowerCase());
    if (!index) {
      index = new SimilarityIndex();
      const rows = db
        .prepare(
          `SELECT c.id, c.front, c.back FROM cards c JOIN decks d ON d.id = c.deck_id
           WHERE c.user_id = ? AND (d.name = ? OR substr(d.name, 1, ?) = ?)`
        )
        .all(userId, root, root.length + 2, `${root}::`) as Array<{ id: string; front: string; back: string }>;
      for (const row of rows) index.add(row);
      indexes.set(root.toLowerCase(), index);
    }
    return index;
  };

  const write = db.transaction(() => {
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
      const part =
        document && card.documentPart !== undefined
          ? (partRow.get(document.id, card.documentPart) as { label: string; text: string } | undefined)
          : undefined;
      const source = card.source ?? (document ? [document.title, part?.label].filter(Boolean).join(', ') : '');
      const issues = [...checkCardQuality(card), ...indexFor(deck.name).check(card.front, card.back)];
      if (document && card.excerpt && part && !containsLoosely(part.text, card.excerpt)) {
        issues.push(`The excerpt was not found in ${part.label} of "${document.title}"; quote the source text exactly.`);
      }
      if (document && !card.excerpt) issues.push('Add the exact excerpt of the source this card comes from.');
      insert.run(
        id,
        userId,
        deck.id,
        card.front,
        card.back,
        card.explanation ?? '',
        source,
        card.excerpt ?? '',
        JSON.stringify(normalizeTags(card.tags)),
        createdAt,
        status,
        document?.id ?? null,
        card.documentPart ?? null,
        createdAt,
        createdAt
      );
      existing.set(key, id);
      indexFor(deck.name).add({ id, front: card.front, back: card.back });
      result.created.push({ id, deck: deck.name, front: card.front });
      if (issues.length > 0) result.warnings.push({ index, cardId: dryRun ? null : id, front: card.front, issues });
    }
    if (dryRun) throw new DryRunRollback();
  });

  try {
    write();
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    result.created = result.created.map((card) => ({ ...card, id: '' }));
  }
  return result;
}

export type EditSource = 'agent' | 'web' | 'api' | 'revert';

/** The editable content of a card, as stored in revisions. */
interface CardContent {
  front: string;
  back: string;
  explanation: string;
  source: string;
  excerpt: string;
  tags: string[];
  deck: string;
}

function contentOf(row: CardRow): CardContent {
  return {
    front: row.front,
    back: row.back,
    explanation: row.explanation,
    source: row.source,
    excerpt: row.excerpt ?? '',
    tags: parseTags(row.tags),
    deck: row.deck_name,
  };
}

/**
 * Edit a card. Content changes are recorded as a revision (who changed what and
 * why), so no edit — by an agent or anyone else — is ever silent or permanent.
 */
export function updateCard(userId: string, id: string, patch: unknown, editSource: EditSource = 'api', reason?: string): Card {
  const parsed = CardPatchSchema.safeParse(patch);
  if (!parsed.success) throw badRequest('Invalid card update', parsed.error.issues);
  const row = getCardRow(userId, id);
  const data = parsed.data;
  const db = getDb();

  db.transaction(() => {
    const deck = data.deck ? getOrCreateDeck(userId, data.deck).deck : { id: row.deck_id, name: row.deck_name };
    const before = contentOf(row);
    const after: CardContent = {
      front: data.front ?? row.front,
      back: data.back ?? row.back,
      explanation: data.explanation ?? row.explanation,
      source: data.source ?? row.source,
      excerpt: data.excerpt ?? row.excerpt ?? '',
      tags: data.tags ? normalizeTags(data.tags) : before.tags,
      deck: deck.name,
    };
    const now = nowIso();
    db.prepare(
      `UPDATE cards SET front = ?, back = ?, explanation = ?, source = ?, excerpt = ?, tags = ?, deck_id = ?, suspended = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      after.front,
      after.back,
      after.explanation,
      after.source,
      after.excerpt,
      JSON.stringify(after.tags),
      deck.id,
      data.suspended === undefined ? row.suspended : data.suspended ? 1 : 0,
      now,
      id,
      userId
    );
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      db.prepare(
        `INSERT INTO card_revisions (id, user_id, card_id, changed_at, source, reason, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(genId(), userId, id, now, editSource, reason?.trim() || null, JSON.stringify(before), JSON.stringify(after));
    }
  })();
  return getCard(userId, id);
}

export interface CardRevision {
  id: string;
  changedAt: string;
  source: EditSource;
  reason: string | null;
  /** Only the fields that changed. */
  changes: Array<{ field: keyof CardContent; before: unknown; after: unknown }>;
}

export function listRevisions(userId: string, cardId: string): CardRevision[] {
  getCardRow(userId, cardId);
  const rows = getDb()
    .prepare(`SELECT * FROM card_revisions WHERE user_id = ? AND card_id = ? ORDER BY changed_at DESC, rowid DESC`)
    .all(userId, cardId) as Array<{ id: string; changed_at: string; source: EditSource; reason: string | null; before: string; after: string }>;
  return rows.map((row) => {
    const before = JSON.parse(row.before) as CardContent;
    const after = JSON.parse(row.after) as CardContent;
    const changes = (Object.keys(after) as Array<keyof CardContent>)
      .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
      .map((field) => ({ field, before: before[field], after: after[field] }));
    return { id: row.id, changedAt: row.changed_at, source: row.source, reason: row.reason, changes };
  });
}

/** Put a card's content back to how it was before a revision (recorded as a new revision). */
export function revertRevision(userId: string, revisionId: string): Card {
  const row = getDb()
    .prepare(`SELECT card_id, before FROM card_revisions WHERE user_id = ? AND id = ?`)
    .get(userId, revisionId) as { card_id: string; before: string } | undefined;
  if (!row) throw notFound('Revision', revisionId);
  const before = JSON.parse(row.before) as CardContent;
  return updateCard(userId, row.card_id, before, 'revert', `Reverted revision ${revisionId}`);
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
