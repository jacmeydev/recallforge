// ============================================================================
// RecallForge — Decks (hierarchical subjects)
// ============================================================================
// Deck names are paths: "Medicina::Farmacología::Antibióticos". Creating a deck
// creates its missing ancestors, renaming moves its subdecks along, deleting
// removes the whole subtree, and study/search filters on a deck include its
// subdecks.
// ============================================================================

import { z } from 'zod';
import { genId, getDb, nowIso } from './db';
import { badRequest, conflict, notFound } from './errors';
import { getSettings } from './settings';
import { studyDay } from './time';
import type { Deck, DeckCounts, DeckSummary } from './types';

export const DECK_SEPARATOR = '::';

const deckName = z
  .string()
  .max(300)
  .transform(normalizeDeckPath)
  .refine((name) => name.length > 0, 'Deck name is required')
  .refine((name) => name.split(DECK_SEPARATOR).every((part) => part.length <= 100), 'Each level must be 100 characters or fewer');

export const DeckInputSchema = z.object({
  name: deckName,
  description: z.string().trim().max(2000).optional(),
});

export const DeckPatchSchema = DeckInputSchema.partial();

interface DeckRow {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

/** "  Medicina :: Farmacología::" → "Medicina::Farmacología" */
export function normalizeDeckPath(name: string): string {
  return name
    .split(DECK_SEPARATOR)
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(DECK_SEPARATOR);
}

function toDeck(row: DeckRow): Deck {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function findDeck(userId: string, ref: string): DeckRow | undefined {
  const db = getDb();
  return (db.prepare(`SELECT * FROM decks WHERE user_id = ? AND id = ?`).get(userId, ref) ??
    db.prepare(`SELECT * FROM decks WHERE user_id = ? AND name = ? COLLATE NOCASE`).get(userId, normalizeDeckPath(ref))) as
    | DeckRow
    | undefined;
}

/** Resolve a deck by id or (case-insensitive) path. */
export function resolveDeck(userId: string, ref: string): Deck {
  const row = findDeck(userId, ref);
  if (!row) throw notFound('Deck', ref);
  return toDeck(row);
}

/**
 * SQL condition selecting cards of a deck and all its subdecks.
 * Binds @scopeDeckName and @scopeDeckPrefix.
 */
export function deckScopeSql(userId: string, ref: string): { sql: string; params: Record<string, unknown> } {
  const deck = resolveDeck(userId, ref);
  const prefix = `${deck.name}${DECK_SEPARATOR}`;
  return {
    sql: `c.deck_id IN (SELECT id FROM decks WHERE user_id = @userId AND (name = @scopeDeckName OR substr(name, 1, @scopeDeckPrefixLength) = @scopeDeckPrefix))`,
    params: { scopeDeckName: deck.name, scopeDeckPrefix: prefix, scopeDeckPrefixLength: prefix.length },
  };
}

function insertDeck(userId: string, name: string, description: string): DeckRow {
  const now = nowIso();
  const row: DeckRow = { id: genId(), name, description, created_at: now, updated_at: now };
  getDb()
    .prepare(`INSERT INTO decks (id, user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(row.id, userId, row.name, row.description, row.created_at, row.updated_at);
  return row;
}

/** Create any missing ancestors of a path ("A::B::C" → "A", "A::B"). */
function ensureAncestors(userId: string, name: string): void {
  const parts = name.split(DECK_SEPARATOR);
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join(DECK_SEPARATOR);
    if (!findDeck(userId, ancestor)) insertDeck(userId, ancestor, '');
  }
}

export function createDeck(userId: string, input: unknown): Deck {
  const parsed = DeckInputSchema.safeParse(input);
  if (!parsed.success) throw badRequest('Invalid deck', parsed.error.issues);
  const { name, description } = parsed.data;
  if (findDeck(userId, name)) throw conflict(`A deck named "${name}" already exists`);
  return getDb().transaction(() => {
    ensureAncestors(userId, name);
    return toDeck(insertDeck(userId, name, description ?? ''));
  })();
}

/** Find a deck by id/path, creating it (and its ancestors) if it does not exist. */
export function getOrCreateDeck(userId: string, ref: string): { deck: Deck; created: boolean } {
  const existing = findDeck(userId, ref);
  if (existing) return { deck: toDeck(existing), created: false };
  return { deck: createDeck(userId, { name: ref }), created: true };
}

function subtree(userId: string, name: string): DeckRow[] {
  const prefix = `${name}${DECK_SEPARATOR}`;
  return getDb()
    .prepare(`SELECT * FROM decks WHERE user_id = ? AND (name = ? OR substr(name, 1, ?) = ?) ORDER BY length(name)`)
    .all(userId, name, prefix.length, prefix) as DeckRow[];
}

/** Rename or move a deck; its subdecks keep their place under the new path. */
export function updateDeck(userId: string, ref: string, patch: unknown): Deck {
  const parsed = DeckPatchSchema.safeParse(patch);
  if (!parsed.success) throw badRequest('Invalid deck', parsed.error.issues);
  const deck = resolveDeck(userId, ref);
  const name = parsed.data.name ?? deck.name;
  const description = parsed.data.description ?? deck.description;
  const updatedAt = nowIso();
  const db = getDb();

  db.transaction(() => {
    if (name !== deck.name) {
      if (name.toLowerCase().startsWith(`${deck.name.toLowerCase()}${DECK_SEPARATOR}`)) {
        throw badRequest('A deck cannot be moved inside itself');
      }
      const clash = findDeck(userId, name);
      if (clash && clash.id !== deck.id) throw conflict(`A deck named "${name}" already exists`);
      ensureAncestors(userId, name);
      const rename = db.prepare(`UPDATE decks SET name = ?, updated_at = ? WHERE id = ?`);
      for (const row of subtree(userId, deck.name)) {
        const nextName = name + row.name.slice(deck.name.length);
        const collision = row.id !== deck.id ? findDeck(userId, nextName) : undefined;
        if (collision) throw conflict(`A deck named "${nextName}" already exists`);
        rename.run(nextName, updatedAt, row.id);
      }
    }
    db.prepare(`UPDATE decks SET description = ?, updated_at = ? WHERE id = ?`).run(description, updatedAt, deck.id);
  })();
  return { ...deck, name, description, updatedAt };
}

/** Delete a deck, its subdecks and all their cards. */
export function deleteDeck(userId: string, ref: string): { deck: Deck; deletedDecks: number; deletedCards: number } {
  const deck = resolveDeck(userId, ref);
  const db = getDb();
  const rows = subtree(userId, deck.name);
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(', ');
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM cards WHERE deck_id IN (${placeholders})`).get(...ids) as {
    count: number;
  };
  db.prepare(`DELETE FROM decks WHERE user_id = ? AND id IN (${placeholders})`).run(userId, ...ids);
  return { deck, deletedDecks: ids.length, deletedCards: count };
}

const EMPTY_COUNTS: DeckCounts = { total: 0, new: 0, learning: 0, review: 0, suspended: 0, drafts: 0, due: 0 };

/** Every deck in tree order, with its own counts and totals including subdecks. */
export function listDecks(userId: string, now = new Date()): DeckSummary[] {
  const settings = getSettings(userId);
  const { end } = studyDay(now, settings.timezone, settings.dayStartHour);
  const rows = getDb()
    .prepare(
      `SELECT d.*,
         COALESCE(SUM(c.id IS NOT NULL AND c.status = 'active'), 0) AS total,
         COALESCE(SUM(c.status = 'active' AND c.suspended = 0 AND c.state = 'new'), 0) AS new_count,
         COALESCE(SUM(c.status = 'active' AND c.suspended = 0 AND c.state IN ('learning', 'relearning')), 0) AS learning_count,
         COALESCE(SUM(c.status = 'active' AND c.suspended = 0 AND c.state = 'review'), 0) AS review_count,
         COALESCE(SUM(c.status = 'active' AND c.suspended = 1), 0) AS suspended_count,
         COALESCE(SUM(c.status = 'draft'), 0) AS draft_count,
         COALESCE(SUM(c.status = 'active' AND c.suspended = 0 AND (
           (c.state IN ('learning', 'relearning') AND c.due_at <= @learnAhead) OR
           (c.state = 'review' AND c.due_at < @end)
         )), 0) AS due_count
       FROM decks d
       LEFT JOIN cards c ON c.deck_id = d.id
       WHERE d.user_id = @userId
       GROUP BY d.id`
    )
    .all({
      userId,
      learnAhead: new Date(now.getTime() + settings.learnAheadMinutes * 60_000).toISOString(),
      end: end.toISOString(),
    }) as Array<
    DeckRow & {
      total: number;
      new_count: number;
      learning_count: number;
      review_count: number;
      suspended_count: number;
      draft_count: number;
      due_count: number;
    }
  >;

  // Tree order: parents before children, siblings alphabetically.
  const sortKey = (name: string) => name.split(DECK_SEPARATOR).map((part) => part.toLocaleLowerCase('es'));
  rows.sort((a, b) => {
    const ka = sortKey(a.name);
    const kb = sortKey(b.name);
    for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
      const cmp = ka[i].localeCompare(kb[i], 'es');
      if (cmp !== 0) return cmp;
    }
    return ka.length - kb.length;
  });

  const byName = new Map(rows.map((row) => [row.name.toLowerCase(), row]));
  const decks: DeckSummary[] = rows.map((row) => {
    const parts = row.name.split(DECK_SEPARATOR);
    const parent = parts.length > 1 ? byName.get(parts.slice(0, -1).join(DECK_SEPARATOR).toLowerCase()) : undefined;
    const counts: DeckCounts = {
      total: row.total,
      new: row.new_count,
      learning: row.learning_count,
      review: row.review_count,
      suspended: row.suspended_count,
      drafts: row.draft_count,
      due: row.due_count,
    };
    return {
      ...toDeck(row),
      shortName: parts[parts.length - 1],
      parentId: parent?.id ?? null,
      depth: parts.length - 1,
      counts,
      totals: { ...counts },
    };
  });

  // Roll counts up to every ancestor.
  const summaryByName = new Map(decks.map((deck) => [deck.name.toLowerCase(), deck]));
  for (const deck of decks) {
    const parts = deck.name.split(DECK_SEPARATOR);
    for (let i = 1; i < parts.length; i++) {
      const ancestor = summaryByName.get(parts.slice(0, i).join(DECK_SEPARATOR).toLowerCase());
      if (!ancestor) continue;
      for (const key of Object.keys(EMPTY_COUNTS) as Array<keyof DeckCounts>) ancestor.totals[key] += deck.counts[key];
    }
  }
  return decks;
}
