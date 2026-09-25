// ============================================================================
// RecallForge — Active-recall study engine
// ============================================================================
// Protocol (shared by the REST API, the MCP tools and the web UI):
//   1. nextCard()   → the question only
//   2. the learner answers from memory
//   3. revealCard() → expected answer, explanation, projected intervals
//   4. gradeCard()  → FSRS reschedules the card and logs the attempt
// Queue order: learning cards due now → reviews due today → new cards → learning
// cards due within the learn-ahead window. Daily limits follow the learner's
// study day (timezone + dayStartHour).
// ============================================================================

import { z } from 'zod';
import { genId, getDb } from './db';
import { CARD_SELECT, getCardRow, tagFilterSql, toCard, toQuestion } from './cards';
import { resolveDeck } from './decks';
import { badRequest } from './errors';
import { previewOutcomes, schedule } from './scheduler';
import { getSettings, type UserSettings } from './settings';
import { formatInterval, studyDay } from './time';
import { RATINGS, type Card, type CardRow, type QueueCounts, type QuestionCard, type Rating, type ReviewSource } from './types';

export const StudyFilterSchema = z.object({
  deck: z.string().trim().min(1).max(200).optional(),
  tag: z.string().trim().min(1).max(100).optional(),
});

export type StudyFilter = z.infer<typeof StudyFilterSchema>;

export const GradeSchema = z.object({
  rating: z.union([
    z.enum(['again', 'hard', 'good', 'easy']),
    z.number().int().min(1).max(4).transform((n) => RATINGS[n - 1]),
  ]),
  answer: z.string().max(8000).optional(),
  feedback: z.string().max(8000).optional(),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
});

interface QueueScope {
  settings: UserSettings;
  where: string;
  params: Record<string, unknown>;
  newRemaining: number;
  reviewRemaining: number;
  now: Date;
  learnAheadUntil: Date;
}

function buildScope(userId: string, filter: StudyFilter, now: Date): QueueScope {
  const settings = getSettings(userId);
  const day = studyDay(now, settings.timezone, settings.dayStartHour);
  const where = ['c.user_id = @userId', 'c.suspended = 0'];
  const params: Record<string, unknown> = {
    userId,
    now: now.toISOString(),
    dayEnd: day.end.toISOString(),
  };
  if (filter.deck) {
    where.push('c.deck_id = @deckId');
    params.deckId = resolveDeck(userId, filter.deck).id;
  }
  if (filter.tag) {
    where.push(tagFilterSql('@tag'));
    params.tag = filter.tag;
  }

  // Daily limits are global per learner, counted from today's review log.
  const done = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT CASE WHEN state = 'new' THEN card_id END) AS new_done,
              COALESCE(SUM(state = 'review'), 0) AS review_done
       FROM review_logs WHERE user_id = ? AND reviewed_at >= ?`
    )
    .get(userId, day.start.toISOString()) as { new_done: number; review_done: number };

  return {
    settings,
    where: where.join(' AND '),
    params,
    newRemaining: Math.max(0, settings.newCardsPerDay - done.new_done),
    reviewRemaining: Math.max(0, settings.maxReviewsPerDay - done.review_done),
    now,
    learnAheadUntil: new Date(now.getTime() + settings.learnAheadMinutes * 60_000),
  };
}

function queueCounts(scope: QueueScope): QueueCounts {
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(c.state IN ('learning', 'relearning') AND c.due_at <= @now), 0) AS learning,
         COALESCE(SUM(c.state = 'review' AND c.due_at < @dayEnd), 0) AS review,
         COALESCE(SUM(c.state = 'new'), 0) AS new_cards,
         COALESCE(SUM(c.state IN ('learning', 'relearning') AND c.due_at <= @learnAhead), 0) AS learn_ahead
       FROM cards c WHERE ${scope.where}`
    )
    .get({ ...scope.params, learnAhead: scope.learnAheadUntil.toISOString() }) as {
    learning: number;
    review: number;
    new_cards: number;
    learn_ahead: number;
  };
  const review = Math.min(row.review, scope.reviewRemaining);
  const newCards = Math.min(row.new_cards, scope.newRemaining);
  // When nothing else is due, learning cards inside the learn-ahead window are served, so count them.
  const learning = row.learning + review + newCards === 0 ? row.learn_ahead : row.learning;
  return { learning, review, new: newCards };
}

function pickNext(scope: QueueScope): CardRow | undefined {
  const db = getDb();
  const first = (condition: string, order: string, extra: Record<string, unknown> = {}) =>
    db
      .prepare(`${CARD_SELECT} WHERE ${scope.where} AND ${condition} ORDER BY ${order} LIMIT 1`)
      .get({ ...scope.params, ...extra }) as CardRow | undefined;

  return (
    first(`c.state IN ('learning', 'relearning') AND c.due_at <= @now`, 'c.due_at ASC') ??
    (scope.reviewRemaining > 0 ? first(`c.state = 'review' AND c.due_at < @dayEnd`, 'c.due_at ASC') : undefined) ??
    (scope.newRemaining > 0 ? first(`c.state = 'new'`, 'c.created_at ASC, c.rowid ASC') : undefined) ??
    first(`c.state IN ('learning', 'relearning') AND c.due_at <= @learnAhead`, 'c.due_at ASC', {
      learnAhead: scope.learnAheadUntil.toISOString(),
    })
  );
}

function nextDueAt(scope: QueueScope): string | null {
  const row = getDb()
    .prepare(`SELECT MIN(c.due_at) AS due FROM cards c WHERE ${scope.where} AND c.state != 'new' AND c.due_at > @now`)
    .get(scope.params) as { due: string | null };
  return row.due;
}

export interface NextCardResult {
  card: QuestionCard | null;
  remaining: QueueCounts;
  /** Present when nothing is due: when the next card becomes due. */
  nextDueAt?: string | null;
  message?: string;
}

export function nextCard(userId: string, filterInput: unknown = {}, now = new Date()): NextCardResult {
  const parsed = StudyFilterSchema.safeParse(filterInput ?? {});
  if (!parsed.success) throw badRequest('Invalid study filter', parsed.error.issues);
  const scope = buildScope(userId, parsed.data, now);
  const row = pickNext(scope);
  const remaining = queueCounts(scope);

  if (row) return { card: toQuestion(row), remaining };

  const due = nextDueAt(scope);
  const limitHit =
    scope.newRemaining === 0 &&
    (getDb().prepare(`SELECT 1 FROM cards c WHERE ${scope.where} AND c.state = 'new' LIMIT 1`).get(scope.params) !==
      undefined);
  return {
    card: null,
    remaining,
    nextDueAt: due,
    message: [
      'Nothing left to study right now.',
      due ? `Next card due in ${formatInterval(new Date(due).getTime() - now.getTime())} (${due}).` : '',
      limitHit ? 'The daily new-card limit was reached; raise newCardsPerDay in settings to keep learning new cards.' : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

export interface RevealResult {
  card: Card;
  /** When the card would next be due for each possible rating. */
  outcomes: Record<Rating, { dueAt: string; interval: string }>;
  /** Most recent attempts, newest first, to spot recurring mistakes. */
  recentAttempts: Array<{ reviewedAt: string; rating: Rating; answer: string | null; feedback: string | null }>;
}

export function revealCard(userId: string, cardId: string, now = new Date()): RevealResult {
  const settings = getSettings(userId);
  const row = getCardRow(userId, cardId);
  const attempts = getDb()
    .prepare(
      `SELECT reviewed_at, rating, answer, feedback FROM review_logs
       WHERE card_id = ? AND user_id = ? ORDER BY reviewed_at DESC LIMIT 5`
    )
    .all(cardId, userId) as Array<{ reviewed_at: string; rating: Rating; answer: string | null; feedback: string | null }>;

  return {
    card: toCard(row, settings, now),
    outcomes: previewOutcomes(row, settings, now),
    recentAttempts: attempts.map((a) => ({
      reviewedAt: a.reviewed_at,
      rating: a.rating,
      answer: a.answer,
      feedback: a.feedback,
    })),
  };
}

export interface GradeResult {
  cardId: string;
  rating: Rating;
  previousState: string;
  state: string;
  dueAt: string;
  interval: string;
  stability: number;
  difficulty: number;
}

export function gradeCard(
  userId: string,
  cardId: string,
  input: unknown,
  source: ReviewSource = 'api',
  now = new Date()
): GradeResult {
  const parsed = GradeSchema.safeParse(input);
  if (!parsed.success) throw badRequest('Invalid grade: rating must be again, hard, good or easy (or 1-4)', parsed.error.issues);
  const { rating, answer, feedback, durationMs } = parsed.data;

  const settings = getSettings(userId);
  const row = getCardRow(userId, cardId);
  const outcome = schedule(row, rating, settings, now);
  const next = outcome.card;
  const elapsedDays = row.last_review_at ? (now.getTime() - new Date(row.last_review_at).getTime()) / 86_400_000 : 0;
  const db = getDb();

  db.transaction(() => {
    db.prepare(
      `UPDATE cards SET state = ?, due_at = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
         reps = ?, lapses = ?, learning_steps = ?, last_review_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      next.state,
      next.due_at,
      next.stability,
      next.difficulty,
      next.elapsed_days,
      next.scheduled_days,
      next.reps,
      next.lapses,
      next.learning_steps,
      next.last_review_at,
      now.toISOString(),
      cardId,
      userId
    );
    db.prepare(
      `INSERT INTO review_logs (
         id, user_id, card_id, reviewed_at, rating, state, next_state, due_at, next_due_at,
         stability, next_stability, difficulty, next_difficulty, elapsed_days, scheduled_days,
         duration_ms, answer, feedback, source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      genId(),
      userId,
      cardId,
      now.toISOString(),
      rating,
      row.state,
      next.state,
      row.due_at,
      next.due_at,
      row.stability,
      next.stability,
      row.difficulty,
      next.difficulty,
      Math.round(elapsedDays * 1000) / 1000,
      next.scheduled_days,
      durationMs ?? null,
      answer?.trim() || null,
      feedback?.trim() || null,
      source
    );
  })();

  return {
    cardId,
    rating,
    previousState: row.state,
    state: next.state,
    dueAt: next.due_at,
    interval: outcome.interval,
    stability: Math.round(next.stability * 100) / 100,
    difficulty: Math.round(next.difficulty * 100) / 100,
  };
}

/** Reset a card to "new", discarding its memory state (history is kept). */
export function resetCard(userId: string, cardId: string, now = new Date()): Card {
  getCardRow(userId, cardId);
  getDb()
    .prepare(
      `UPDATE cards SET state = 'new', due_at = ?, stability = 0, difficulty = 0, elapsed_days = 0, scheduled_days = 0,
         reps = 0, lapses = 0, learning_steps = 0, last_review_at = NULL, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .run(now.toISOString(), now.toISOString(), cardId, userId);
  return toCard(getCardRow(userId, cardId), getSettings(userId), now);
}
