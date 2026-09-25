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
import { checkFormatAnswer, isPracticeFormat, present, QUESTION_FORMATS, type FormatCheck, type Presentation, type QuestionFormat } from './formats';
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
  mode: z.enum(['normal', 'exam', 'quick']).optional(),
  /** How to ask: recall (default), typing, multiple_choice or true_false (the last two are practice only). */
  format: z.enum(QUESTION_FORMATS as [string, ...string[]]).optional(),
});

export type StudyFilter = z.infer<typeof StudyFilterSchema>;

export const GradeSchema = z.object({
  /** Required for recall/typing; derived from the check for multiple_choice and true_false. */
  rating: z
    .union([z.enum(['again', 'hard', 'good', 'easy']), z.number().int().min(1).max(4).transform((n) => RATINGS[n - 1])])
    .optional(),
  answer: z.string().max(8000).optional(),
  feedback: z.string().max(8000).optional(),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
  mode: z.enum(['normal', 'exam', 'quick']).optional(),
  format: z.enum(QUESTION_FORMATS as [string, ...string[]]).optional(),
  /** multiple_choice: the option the learner picked. */
  choice: z.string().max(8000).optional(),
  /** true_false: the statement shown and whether the learner judged it true. */
  statement: z.string().max(8000).optional(),
  answerTrue: z.boolean().optional(),
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
       FROM review_logs WHERE user_id = ? AND reviewed_at >= ? AND mode != 'practice'`
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
  /** How to ask the card (choices for multiple choice, the statement for true/false). */
  presentation?: Presentation;
  remaining: QueueCounts;
  /** Present when nothing is due: when the next card becomes due. */
  nextDueAt?: string | null;
  message?: string;
}

export function nextCard(userId: string, filterInput: unknown = {}, now = new Date()): NextCardResult {
  const parsed = StudyFilterSchema.safeParse(filterInput ?? {});
  if (!parsed.success) throw badRequest('Invalid study filter', parsed.error.issues);
  const filter = parsed.data;
  if (isPracticeFormat(filter.format as never)) return nextPracticeCard(userId, filter, now);
  if (filter.mode === 'exam') return withPresentation(nextExamCard(userId, filter, now), userId, filter);
  const scope = buildScope(userId, filter, now);
  // Quick session: only what is already due (no new cards), most at-risk first.
  if (filter.mode === 'quick') scope.newRemaining = 0;
  const row = pickNext(scope);
  const remaining = queueCounts(scope);

  if (row) return { card: toQuestion(row), presentation: present(row, (filter.format as never) ?? 'recall'), remaining };

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

function withPresentation(result: NextCardResult, userId: string, filter: StudyFilter): NextCardResult {
  if (!result.card) return result;
  return { ...result, presentation: present(getCardRow(userId, result.card.id), (filter.format as never) ?? 'recall') };
}

/** Practiced this recently = skipped, so a practice session keeps moving through the subject. */
const PRACTICE_GAP_MS = 10 * 60 * 1000;

/**
 * Practice (multiple choice, true/false): weakest cards of the scope first,
 * skipping those practiced in the last minutes. Never changes the schedule.
 */
function nextPracticeCard(userId: string, filter: StudyFilter, now: Date): NextCardResult {
  const settings = getSettings(userId);
  const where = ['c.user_id = @userId', `c.status = 'active'`, 'c.suspended = 0'];
  const params: Record<string, unknown> = {
    userId,
    since: new Date(now.getTime() - PRACTICE_GAP_MS).toISOString(),
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
  where.push(`NOT EXISTS (SELECT 1 FROM review_logs r WHERE r.card_id = c.id AND r.mode = 'practice' AND r.reviewed_at >= @since)`);
  const rows = getDb().prepare(`${CARD_SELECT} WHERE ${where.join(' AND ')}`).all(params) as CardRow[];
  const ranked = rows
    .map((row) => ({ row, recall: retrievability(row, settings, now) ?? 0 }))
    .sort((a, b) => a.recall - b.recall || Math.random() - 0.5);
  const pick = ranked[0]?.row;
  const remaining: QueueCounts = { learning: 0, review: rows.filter((r) => r.state !== 'new').length, new: rows.filter((r) => r.state === 'new').length };
  if (!pick) {
    return { card: null, remaining, nextDueAt: null, message: 'Every card in this scope was practiced in the last few minutes.' };
  }
  return { card: toQuestion(pick), presentation: present(pick, filter.format as never), remaining };
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
  /** Practice answers (multiple choice, true/false) are logged but never change the schedule. */
  practice: boolean;
  /** Objective check for multiple choice / true-false, or an exact-match hint for typing. */
  check: FormatCheck | null;
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
  const { answer, feedback, durationMs } = parsed.data;
  const format = (parsed.data.format ?? 'recall') as QuestionFormat;
  const settings = getSettings(userId);
  const row = getCardRow(userId, cardId);
  const check = checkFormatAnswer(row, { ...parsed.data, format });
  // Only the objective practice formats derive the rating; recall and typing are judged by meaning, never by string match.
  const derived = isPracticeFormat(format) && check ? (check.correct ? 'good' : 'again') : undefined;
  const rating: Rating | undefined = parsed.data.rating ?? derived;
  if (!rating) throw badRequest('rating is required (again, hard, good or easy)');

  if (isPracticeFormat(format)) return logPractice(userId, row, rating, format, check, { answer, feedback, durationMs, source }, now);

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
         duration_ms, answer, feedback, source, snapshot, mode, format
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      JSON.stringify(snapshotOf(row)),
      parsed.data.mode === 'exam' ? 'exam' : 'review',
      format
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
    practice: false,
    check,
  };
}

function logPractice(
  userId: string,
  row: CardRow,
  rating: Rating,
  format: string,
  check: FormatCheck | null,
  details: { answer?: string; feedback?: string; durationMs?: number; source: ReviewSource },
  now: Date
): GradeResult {
  getDb()
    .prepare(
      `INSERT INTO review_logs (
         id, user_id, card_id, reviewed_at, rating, state, next_state, due_at, next_due_at,
         stability, next_stability, difficulty, next_difficulty, duration_ms, answer, feedback, source, mode, format
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'practice', ?)`
    )
    .run(
      genId(),
      userId,
      row.id,
      now.toISOString(),
      rating,
      row.state,
      row.state,
      row.due_at,
      row.due_at,
      row.stability,
      row.stability,
      row.difficulty,
      row.difficulty,
      details.durationMs ?? null,
      details.answer?.trim() || check?.given || null,
      details.feedback?.trim() || null,
      details.source,
      format
    );
  return {
    cardId: row.id,
    rating,
    previousState: row.state,
    state: row.state,
    dueAt: row.due_at,
    interval: 'unchanged (practice)',
    stability: Math.round(row.stability * 100) / 100,
    difficulty: Math.round(row.difficulty * 100) / 100,
    lapses: row.lapses,
    leech: false,
    practice: true,
    check,
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
       WHERE user_id = ? AND mode != 'practice' ${cardId ? 'AND card_id = ?' : ''} ORDER BY reviewed_at DESC, rowid DESC LIMIT 1`
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

export const CorrectGradeSchema = z.object({
  rating: z.union([z.enum(['again', 'hard', 'good', 'easy']), z.number().int().min(1).max(4).transform((n) => RATINGS[n - 1])]),
  reason: z.string().trim().max(2000).optional(),
});

/**
 * "My answer was right": replace the rating of the card's last review with the
 * learner's own judgement. The card is restored to its state before that review
 * and rescheduled with the corrected rating at the original review time, so the
 * result is exactly as if it had been graded that way. The correction is noted
 * in the review's feedback.
 */
export function correctLastReview(userId: string, cardId: string, input: unknown): GradeResult & { correctedFrom: Rating } {
  const parsed = CorrectGradeSchema.safeParse(input);
  if (!parsed.success) throw badRequest('Invalid correction: rating must be again, hard, good or easy (or 1-4)', parsed.error.issues);
  const log = getDb()
    .prepare(
      `SELECT rating, reviewed_at, answer, feedback, duration_ms, source, mode, format FROM review_logs
       WHERE user_id = ? AND card_id = ? AND mode != 'practice' ORDER BY reviewed_at DESC, rowid DESC LIMIT 1`
    )
    .get(userId, cardId) as
    | { rating: Rating; reviewed_at: string; answer: string | null; feedback: string | null; duration_ms: number | null; source: ReviewSource; mode: string; format: string }
    | undefined;
  if (!log) throw badRequest('This card has no review to correct');
  const note = `Rating corrected by the learner: ${log.rating} → ${parsed.data.rating}${parsed.data.reason ? ` (${parsed.data.reason})` : ''}`;
  let result!: GradeResult;
  getDb().transaction(() => {
    undoLastReview(userId, cardId);
    result = gradeCard(
      userId,
      cardId,
      {
        rating: parsed.data.rating,
        answer: log.answer ?? undefined,
        feedback: [log.feedback, note].filter(Boolean).join('\n'),
        durationMs: log.duration_ms ?? undefined,
        mode: log.mode === 'exam' ? 'exam' : undefined,
        format: log.format === 'typing' ? 'typing' : 'recall',
      },
      log.source,
      new Date(log.reviewed_at)
    );
  })();
  return { ...result, correctedFrom: log.rating };
}
