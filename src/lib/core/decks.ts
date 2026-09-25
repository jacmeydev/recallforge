// ============================================================================
// RecallForge — Decks
// ============================================================================

import { z } from 'zod';
import { genId, getDb, nowIso } from './db';
import { badRequest, conflict, notFound } from './errors';
import { getSettings } from './settings';
import { studyDay } from './time';
import type { Deck, DeckSummary } from './types';

export const DeckInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
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
    db.prepare(`SELECT * FROM decks WHERE user_id = ? AND name = ? COLLATE NOCASE`).get(userId, ref.trim())) as
    | DeckRow
    | undefined;
}

/** Resolve a deck by id or (case-insensitive) name. */
export function resolveDeck(userId: string, ref: string): Deck {
  const row = findDeck(userId, ref);
  if (!row) throw notFound('Deck', ref);
  return toDeck(row);
}

export function createDeck(userId: string, input: unknown): Deck {
  const parsed = DeckInputSchema.safeParse(input);
  if (!parsed.success) throw badRequest('Invalid deck', parsed.error.issues);
  if (findDeck(userId, parsed.data.name)) throw conflict(`A deck named "${parsed.data.name}" already exists`);
  const now = nowIso();
  const deck: DeckRow = {
    id: genId(),
    name: parsed.data.name,
    description: parsed.data.description ?? '',
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(`INSERT INTO decks (id, user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(deck.id, userId, deck.name, deck.description, deck.created_at, deck.updated_at);
  return toDeck(deck);
}

/** Find a deck by id/name, creating it (by name) if it does not exist. */
export function getOrCreateDeck(userId: string, ref: string): { deck: Deck; created: boolean } {
  const existing = findDeck(userId, ref);
  if (existing) return { deck: toDeck(existing), created: false };
  return { deck: createDeck(userId, { name: ref }), created: true };
}

export function updateDeck(userId: string, ref: string, patch: unknown): Deck {
  const parsed = DeckPatchSchema.safeParse(patch);
  if (!parsed.success) throw badRequest('Invalid deck', parsed.error.issues);
  const deck = resolveDeck(userId, ref);
  const name = parsed.data.name ?? deck.name;
  if (name.toLowerCase() !== deck.name.toLowerCase()) {
    const clash = findDeck(userId, name);
    if (clash && clash.id !== deck.id) throw conflict(`A deck named "${name}" already exists`);
  }
  const description = parsed.data.description ?? deck.description;
  const updatedAt = nowIso();
  getDb()
    .prepare(`UPDATE decks SET name = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(name, description, updatedAt, deck.id, userId);
  return { ...deck, name, description, updatedAt };
}

export function deleteDeck(userId: string, ref: string): { deck: Deck; deletedCards: number } {
  const deck = resolveDeck(userId, ref);
  const db = getDb();
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM cards WHERE deck_id = ?`).get(deck.id) as { count: number };
  db.prepare(`DELETE FROM decks WHERE id = ? AND user_id = ?`).run(deck.id, userId);
  return { deck, deletedCards: count };
}

export function listDecks(userId: string, now = new Date()): DeckSummary[] {
  const settings = getSettings(userId);
  const { end } = studyDay(now, settings.timezone, settings.dayStartHour);
  const rows = getDb()
    .prepare(
      `SELECT d.*,
         COUNT(c.id) AS total,
         COALESCE(SUM(c.suspended = 0 AND c.state = 'new'), 0) AS new_count,
         COALESCE(SUM(c.suspended = 0 AND c.state IN ('learning', 'relearning')), 0) AS learning_count,
         COALESCE(SUM(c.suspended = 0 AND c.state = 'review'), 0) AS review_count,
         COALESCE(SUM(c.suspended = 1), 0) AS suspended_count,
         COALESCE(SUM(c.suspended = 0 AND (
           (c.state IN ('learning', 'relearning') AND c.due_at <= @learnAhead) OR
           (c.state = 'review' AND c.due_at < @end)
         )), 0) AS due_count
       FROM decks d
       LEFT JOIN cards c ON c.deck_id = d.id
       WHERE d.user_id = @userId
       GROUP BY d.id
       ORDER BY d.name COLLATE NOCASE`
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
      due_count: number;
    }
  >;

  return rows.map((row) => ({
    ...toDeck(row),
    counts: {
      total: row.total,
      new: row.new_count,
      learning: row.learning_count,
      review: row.review_count,
      suspended: row.suspended_count,
      due: row.due_count,
    },
  }));
}
