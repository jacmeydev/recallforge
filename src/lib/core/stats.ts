// ============================================================================
// RecallForge — Learning statistics
// ============================================================================
// A compact snapshot an agent can reason about: today's work, what is due,
// real retention, streak, upcoming load and the weakest cards.
// ============================================================================

import { getDb } from './db';
import { tagFilterSql, toCard } from './cards';
import { resolveDeck } from './decks';
import { badRequest } from './errors';
import { getSettings } from './settings';
import { nextCard, StudyFilterSchema } from './study';
import { studyDay, studyDaySqlModifier } from './time';
import type { CardRow, QueueCounts } from './types';

export interface Stats {
  scope: { deck: string | null; tag: string | null };
  today: {
    date: string;
    reviews: number;
    newCards: number;
    again: number;
    hard: number;
    good: number;
    easy: number;
    /** Share of today's answers not rated "again". */
    accuracy: number | null;
    minutes: number;
  };
  due: QueueCounts;
  cards: { total: number; new: number; learning: number; review: number; mature: number; suspended: number };
  /** Pass rate on review-state cards over the last 30 days (true retention). */
  retention30d: { reviews: number; rate: number | null };
  streakDays: number;
  forecast: Array<{ date: string; due: number }>;
  weakCards: Array<{
    id: string;
    deck: string;
    front: string;
    lapses: number;
    timesFailed: number;
    reps: number;
    retrievability: number | null;
  }>;
  settings: { desiredRetention: number; newCardsPerDay: number; maxReviewsPerDay: number; timezone: string };
}

export function getStats(userId: string, filterInput: unknown = {}, now = new Date()): Stats {
  const parsed = StudyFilterSchema.safeParse(filterInput ?? {});
  if (!parsed.success) throw badRequest('Invalid stats filter', parsed.error.issues);
  const filter = parsed.data;
  const settings = getSettings(userId);
  const db = getDb();
  const today = studyDay(now, settings.timezone, settings.dayStartHour);

  const where = ['c.user_id = @userId'];
  const params: Record<string, unknown> = { userId, now: now.toISOString() };
  if (filter.deck) {
    where.push('c.deck_id = @deckId');
    params.deckId = resolveDeck(userId, filter.deck).id;
  }
  if (filter.tag) {
    where.push(tagFilterSql('@tag'));
    params.tag = filter.tag;
  }
  const cardWhere = where.join(' AND ');
  const logJoin = `FROM review_logs r JOIN cards c ON c.id = r.card_id WHERE ${cardWhere}`;

  const todayRow = db
    .prepare(
      `SELECT COUNT(*) AS reviews,
              COUNT(DISTINCT CASE WHEN r.state = 'new' THEN r.card_id END) AS new_cards,
              COALESCE(SUM(r.rating = 'again'), 0) AS again,
              COALESCE(SUM(r.rating = 'hard'), 0) AS hard,
              COALESCE(SUM(r.rating = 'good'), 0) AS good,
              COALESCE(SUM(r.rating = 'easy'), 0) AS easy,
              COALESCE(SUM(r.duration_ms), 0) AS duration
       ${logJoin} AND r.reviewed_at >= @start`
    )
    .get({ ...params, start: today.start.toISOString() }) as {
    reviews: number;
    new_cards: number;
    again: number;
    hard: number;
    good: number;
    easy: number;
    duration: number;
  };

  const cardsRow = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(c.suspended = 0 AND c.state = 'new'), 0) AS new_cards,
              COALESCE(SUM(c.suspended = 0 AND c.state IN ('learning', 'relearning')), 0) AS learning,
              COALESCE(SUM(c.suspended = 0 AND c.state = 'review'), 0) AS review,
              COALESCE(SUM(c.suspended = 0 AND c.state = 'review' AND c.scheduled_days >= 21), 0) AS mature,
              COALESCE(SUM(c.suspended = 1), 0) AS suspended
       FROM cards c WHERE ${cardWhere}`
    )
    .get(params) as { total: number; new_cards: number; learning: number; review: number; mature: number; suspended: number };

  const retentionRow = db
    .prepare(
      `SELECT COUNT(*) AS reviews, COALESCE(SUM(r.rating != 'again'), 0) AS passed
       ${logJoin} AND r.state = 'review' AND r.reviewed_at >= @since`
    )
    .get({ ...params, since: new Date(now.getTime() - 30 * 86_400_000).toISOString() }) as { reviews: number; passed: number };

  // Streak: consecutive study days with at least one review (all decks).
  const modifier = studyDaySqlModifier(now, settings.timezone, settings.dayStartHour);
  const studiedDays = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT date(reviewed_at, @modifier) AS day FROM review_logs
           WHERE user_id = @userId AND reviewed_at >= @since`
        )
        .all({ userId, modifier, since: new Date(now.getTime() - 400 * 86_400_000).toISOString() }) as Array<{ day: string }>
    ).map((row) => row.day)
  );
  let streakDays = 0;
  let cursor = studiedDays.has(today.date) ? 0 : -1;
  while (studiedDays.has(studyDay(now, settings.timezone, settings.dayStartHour, cursor).date)) {
    streakDays++;
    cursor--;
  }

  // Forecast: cards coming due in each of the next 7 study days (overdue counts today).
  const forecastRows = db
    .prepare(
      `SELECT date(MAX(c.due_at, @now), @modifier) AS day, COUNT(*) AS due
       FROM cards c WHERE ${cardWhere} AND c.suspended = 0 AND c.state != 'new' AND c.due_at < @until
       GROUP BY day`
    )
    .all({
      ...params,
      modifier,
      until: studyDay(now, settings.timezone, settings.dayStartHour, 6).end.toISOString(),
    }) as Array<{ day: string; due: number }>;
  const forecastByDay = new Map(forecastRows.map((row) => [row.day, row.due]));
  const forecast = Array.from({ length: 7 }, (_, offset) => {
    const date = studyDay(now, settings.timezone, settings.dayStartHour, offset).date;
    return { date, due: forecastByDay.get(date) ?? 0 };
  });

  // Weak cards: forgotten after being learned (lapses) or repeatedly failed ("again").
  const weakRows = db
    .prepare(
      `SELECT * FROM (
         SELECT c.*, d.name AS deck_name,
                (SELECT COUNT(*) FROM review_logs r WHERE r.card_id = c.id AND r.rating = 'again') AS again_count
         FROM cards c JOIN decks d ON d.id = c.deck_id
         WHERE ${cardWhere} AND c.suspended = 0 AND c.reps > 0
       ) WHERE lapses > 0 OR again_count > 0
       ORDER BY lapses DESC, again_count DESC, stability ASC LIMIT 10`
    )
    .all(params) as Array<CardRow & { again_count: number }>;

  return {
    scope: { deck: filter.deck ?? null, tag: filter.tag ?? null },
    today: {
      date: today.date,
      reviews: todayRow.reviews,
      newCards: todayRow.new_cards,
      again: todayRow.again,
      hard: todayRow.hard,
      good: todayRow.good,
      easy: todayRow.easy,
      accuracy: todayRow.reviews > 0 ? round((todayRow.reviews - todayRow.again) / todayRow.reviews) : null,
      minutes: Math.round(todayRow.duration / 60_000),
    },
    due: nextCard(userId, filter, now).remaining,
    cards: {
      total: cardsRow.total,
      new: cardsRow.new_cards,
      learning: cardsRow.learning,
      review: cardsRow.review,
      mature: cardsRow.mature,
      suspended: cardsRow.suspended,
    },
    retention30d: {
      reviews: retentionRow.reviews,
      rate: retentionRow.reviews > 0 ? round(retentionRow.passed / retentionRow.reviews) : null,
    },
    streakDays,
    forecast,
    weakCards: weakRows.map((row) => {
      const card = toCard(row, settings, now);
      return {
        id: card.id,
        deck: card.deck.name,
        front: card.front,
        lapses: card.lapses,
        timesFailed: row.again_count,
        reps: card.reps,
        retrievability: card.retrievability,
      };
    }),
    settings: {
      desiredRetention: settings.desiredRetention,
      newCardsPerDay: settings.newCardsPerDay,
      maxReviewsPerDay: settings.maxReviewsPerDay,
      timezone: settings.timezone,
    },
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
