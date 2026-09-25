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
import { CARD_SELECT, getCardRow, normalizeTags, tagFilterSql, toCard, toQuestion } from './cards';
import { deckScopeSql, effectiveExamDate, listDecks, resolveDeck } from './decks';
import { LEECH_LAPSES } from './progress';
import { badRequest } from './errors';
import { previewOutcomes, retrievability, schedule } from './scheduler';
import { getSettings, type UserSettings } from './settings';
import { formatInterval, localDateTime, studyDay } from './time';
import { RATINGS, type Card, type CardRow, type QueueCounts, type QuestionCard, type Rating, type ReviewSource } from './types';

export const StudyFilterSchema = z.object({
  deck: z.string().trim().min(1).max(300).optional(),
  tag: z.string().trim().min(1).max(100).optional(),
  /**
   * "exam": ignore due dates and daily limits and ask first the cards you are
   * least likely to remember on the exam day of the deck (see update_deck).
   */
  mode: z.enum(['normal', 'exam']).optional(),
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
  const where = ['c.user_id = @userId', `c.status = 'active'`, 'c.suspended = 0'];
  const params: Record<string, unknown> = {
    userId,
    now: now.toISOString(),
    dayEnd: day.end.toISOString(),
  };
  if (filter.deck) {
    const scope = deckScopeSql(userId, filter.deck);
    where.push(scope.sql);
    Object.assign(params, scope.params);
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
  if (parsed.data.mode === 'exam') return nextExamCard(userId, parsed.data, now);
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

/** Cards reviewed this recently are not asked again in exam mode. */
const EXAM_MIN_GAP_MS = 6 * 60 * 60 * 1000;

/**
 * Exam mode: every card of the deck is ranked by how likely you are to recall
 * it on exam day (unseen cards first), ignoring due dates and daily limits.
 * Cards reviewed in the last few hours are skipped (except learning steps).
 * The session is done when every card is predicted at or above the target
 * retention for the exam.
 */
function nextExamCard(userId: string, filter: StudyFilter, now: Date): NextCardResult {
  if (!filter.deck) throw badRequest('Exam mode needs a deck (the subject of the exam)');
  const settings = getSettings(userId);
  const deck = resolveDeck(userId, filter.deck);
  const examDate = effectiveExamDate(listDecks(userId, now), deck.name);
  if (!examDate) throw badRequest(`Set an exam date on "${deck.name}" first (update_deck with exam_date)`);
  const examAt = localDateTime(examDate, settings.dayStartHour, settings.timezone);
  const target = examAt > now ? examAt : now;

  const where = ['c.user_id = @userId', `c.status = 'active'`, 'c.suspended = 0'];
  const scope = deckScopeSql(userId, deck.id);
  const params: Record<string, unknown> = { userId, ...scope.params };
  where.push(scope.sql);
  if (filter.tag) {
    where.push(tagFilterSql('@tag'));
    params.tag = filter.tag;
  }
  const rows = getDb().prepare(`${CARD_SELECT} WHERE ${where.join(' AND ')}`).all(params) as CardRow[];

  const recentCutoff = now.getTime() - EXAM_MIN_GAP_MS;
  const learningDue = rows
    .filter((row) => (row.state === 'learning' || row.state === 'relearning') && row.due_at <= now.toISOString())
    .sort((a, b) => a.due_at.localeCompare(b.due_at));
  const ranked = rows
    .map((row) => ({ row, recall: retrievability(row, settings, target) ?? 0 }))
    .filter(({ recall }) => recall < settings.desiredRetention)
    .sort((a, b) => a.recall - b.recall || a.row.created_at.localeCompare(b.row.created_at));
  const askable = ranked.filter(({ row }) => !row.last_review_at || new Date(row.last_review_at).getTime() < recentCutoff);

  const remaining: QueueCounts = {
    learning: learningDue.length,
    review: ranked.filter(({ row }) => row.state !== 'new').length,
    new: ranked.filter(({ row }) => row.state === 'new').length,
  };
  const pick = learningDue[0] ?? askable[0]?.row;
  if (pick) return { card: toQuestion(pick), remaining };

  const predicted = rows.length
    ? rows.reduce((sum, row) => sum + (retrievability(row, settings, target) ?? 0), 0) / rows.length
    : 0;
  return {
    card: null,
    remaining,
    nextDueAt: null,
    message:
      ranked.length === 0
        ? `Ready for the ${examDate} exam: every card of "${deck.name}" is predicted at or above ${Math.round(settings.desiredRetention * 100)}% (average ${Math.round(predicted * 100)}%).`
        : `The remaining weak cards of "${deck.name}" were reviewed in the last few hours; come back later today. Predicted recall on exam day: ${Math.round(predicted * 100)}%.`,
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
  lapses: number;
  /** True when the card keeps being forgotten: suggest rewriting it (split it, add a mnemonic, clarify). */
  leech: boolean;
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
  const leech = next.lapses >= LEECH_LAPSES && next.lapses > row.lapses;
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
         duration_ms, answer, feedback, source, snapshot
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      source,
      JSON.stringify(snapshotOf(row))
    );
    if (leech && !parseTagList(row.tags).some((tag) => tag.toLowerCase() === 'leech')) {
      db.prepare(`UPDATE cards SET tags = ? WHERE id = ?`).run(
        JSON.stringify(normalizeTags([...parseTagList(row.tags), 'leech'])),
        cardId
      );
    }
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
    lapses: next.lapses,
    leech,
  };
}

const SNAPSHOT_FIELDS = [
  'state',
  'due_at',
  'stability',
  'difficulty',
  'elapsed_days',
  'scheduled_days',
  'reps',
  'lapses',
  'learning_steps',
  'last_review_at',
  'tags',
] as const;

type CardSnapshot = Pick<CardRow, (typeof SNAPSHOT_FIELDS)[number]>;

function snapshotOf(row: CardRow): CardSnapshot {
  return Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [field, row[field]])) as CardSnapshot;
}

function parseTagList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Undo the most recent review (of one card, or of any card), restoring the
 * card exactly as it was before and deleting that review from the history.
 */
export function undoLastReview(
  userId: string,
  cardId?: string
): { undone: { cardId: string; rating: Rating; reviewedAt: string }; card: QuestionCard } {
  const db = getDb();
  const log = db
    .prepare(
      `SELECT id, card_id, rating, reviewed_at, snapshot FROM review_logs
       WHERE user_id = ? ${cardId ? 'AND card_id = ?' : ''} ORDER BY reviewed_at DESC, rowid DESC LIMIT 1`
    )
    .get(...(cardId ? [userId, cardId] : [userId])) as
    | { id: string; card_id: string; rating: Rating; reviewed_at: string; snapshot: string | null }
    | undefined;
  if (!log) throw badRequest('There is no review to undo');
  if (!log.snapshot) throw badRequest('This review was recorded before undo was available and cannot be undone');
  const snapshot = JSON.parse(log.snapshot) as CardSnapshot;
  db.transaction(() => {
    db.prepare(
      `UPDATE cards SET ${SNAPSHOT_FIELDS.map((field) => `${field} = @${field}`).join(', ')}, updated_at = @now
       WHERE id = @id AND user_id = @userId`
    ).run({ ...snapshot, now: new Date().toISOString(), id: log.card_id, userId });
    db.prepare(`DELETE FROM review_logs WHERE id = ?`).run(log.id);
  })();
  return {
    undone: { cardId: log.card_id, rating: log.rating, reviewedAt: log.reviewed_at },
    card: toQuestion(getCardRow(userId, log.card_id)),
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
