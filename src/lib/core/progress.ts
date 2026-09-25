// ============================================================================
// RecallForge — Progress map
// ============================================================================
// What you know, subject by subject: FSRS estimates how likely you are to
// recall every card right now ("mastery"), how much of each subject you have
// already seen, what is consolidated, what is weak, and — for subjects with an
// exam date — how much you are predicted to remember on exam day. Plus a
// GitHub-style heatmap of study days and document coverage.
// ============================================================================

import { getDb } from './db';
import { DECK_SEPARATOR, effectiveExamDate, listDecks } from './decks';
import { listDocuments } from './documents';
import { retrievability } from './scheduler';
import { getSettings } from './settings';
import { localDateTime, studyDay, studyDaySqlModifier } from './time';
import type { CardRow } from './types';

/** Cards forgotten this many times after being learned are "leeches". */
export const LEECH_LAPSES = 4;
/** A card counts as consolidated once FSRS stability reaches 21 days. */
export const MATURE_STABILITY_DAYS = 21;

export interface SubjectProgress {
  id: string;
  name: string;
  shortName: string;
  parentId: string | null;
  depth: number;
  /** Active, non-suspended cards (this subject and its subdecks). */
  cards: number;
  unseen: number;
  learning: number;
  mature: number;
  weak: number;
  due: number;
  drafts: number;
  /** Mean probability of recalling every card right now (unseen cards count as 0). 0–1. */
  mastery: number;
  /** Mean recall probability over cards already studied, or null. 0–1. */
  recall: number | null;
  /** Share of cards seen at least once. 0–1. */
  coverage: number;
  exam: { date: string; daysLeft: number; predictedRecall: number } | null;
}

export interface ProgressMap {
  generatedAt: string;
  overall: Pick<SubjectProgress, 'cards' | 'unseen' | 'learning' | 'mature' | 'weak' | 'due' | 'drafts' | 'mastery' | 'recall' | 'coverage'>;
  subjects: SubjectProgress[];
  heatmap: {
    from: string;
    to: string;
    days: Array<{ date: string; reviews: number }>;
    maxReviews: number;
    studiedDays: number;
    totalReviews: number;
    streakDays: number;
  };
  documents: Array<{ id: string; title: string; deck: string | null; parts: number; partsCovered: number; cards: number; drafts: number }>;
}

interface Accumulator {
  cards: number;
  unseen: number;
  learning: number;
  mature: number;
  weak: number;
  due: number;
  sumR: number;
  seen: number;
  sumRSeen: number;
  examCards: number;
  sumRExam: number;
}

const emptyAccumulator = (): Accumulator => ({
  cards: 0,
  unseen: 0,
  learning: 0,
  mature: 0,
  weak: 0,
  due: 0,
  sumR: 0,
  seen: 0,
  sumRSeen: 0,
  examCards: 0,
  sumRExam: 0,
});

const round = (value: number) => Math.round(value * 1000) / 1000;

export function getProgressMap(userId: string, options: { days?: number } = {}, now = new Date()): ProgressMap {
  const settings = getSettings(userId);
  const db = getDb();
  const days = Math.min(Math.max(options.days ?? 182, 7), 400);
  const today = studyDay(now, settings.timezone, settings.dayStartHour);
  const decks = listDecks(userId, now);

  // Exam moments per deck (own or inherited), at the start of the exam's study day.
  const examMoment = new Map<string, { date: string; at: Date }>();
  for (const deck of decks) {
    const date = effectiveExamDate(decks, deck.name);
    if (date) examMoment.set(deck.id, { date, at: localDateTime(date, settings.dayStartHour, settings.timezone) });
  }

  // One pass over every active card: attribute it to its deck.
  const own = new Map<string, Accumulator>();
  const rows = db
    .prepare(`SELECT c.*, '' AS deck_name FROM cards c WHERE c.user_id = ? AND c.status = 'active' AND c.suspended = 0`)
    .iterate(userId) as Iterable<CardRow>;
  const learnAheadUntil = new Date(now.getTime() + settings.learnAheadMinutes * 60_000).toISOString();
  for (const card of rows) {
    const acc = own.get(card.deck_id) ?? emptyAccumulator();
    own.set(card.deck_id, acc);
    acc.cards++;
    const r = retrievability(card, settings, now);
    if (card.state === 'new') acc.unseen++;
    else {
      acc.seen++;
      acc.sumRSeen += r ?? 0;
    }
    acc.sumR += r ?? 0;
    if (card.state === 'learning' || card.state === 'relearning') acc.learning++;
    if (card.state === 'review' && card.stability >= MATURE_STABILITY_DAYS) acc.mature++;
    if (card.lapses >= LEECH_LAPSES) acc.weak++;
    if (
      ((card.state === 'learning' || card.state === 'relearning') && card.due_at <= learnAheadUntil) ||
      (card.state === 'review' && card.due_at < today.end.toISOString())
    ) {
      acc.due++;
    }
    const exam = examMoment.get(card.deck_id);
    if (exam && exam.at > now) {
      acc.examCards++;
      acc.sumRExam += retrievability(card, settings, exam.at) ?? 0;
    }
  }

  // Roll every deck's numbers up to its ancestors.
  const total = new Map<string, Accumulator>(decks.map((deck) => [deck.id, emptyAccumulator()]));
  const idByName = new Map(decks.map((deck) => [deck.name.toLowerCase(), deck.id]));
  for (const deck of decks) {
    const acc = own.get(deck.id);
    if (!acc) continue;
    const parts = deck.name.split(DECK_SEPARATOR);
    for (let i = parts.length; i > 0; i--) {
      const ancestorId = idByName.get(parts.slice(0, i).join(DECK_SEPARATOR).toLowerCase());
      const target = ancestorId ? total.get(ancestorId) : undefined;
      if (!target) continue;
      for (const key of Object.keys(acc) as Array<keyof Accumulator>) target[key] += acc[key];
    }
  }

  const summarize = (acc: Accumulator) => ({
    cards: acc.cards,
    unseen: acc.unseen,
    learning: acc.learning,
    mature: acc.mature,
    weak: acc.weak,
    due: acc.due,
    mastery: acc.cards > 0 ? round(acc.sumR / acc.cards) : 0,
    recall: acc.seen > 0 ? round(acc.sumRSeen / acc.seen) : null,
    coverage: acc.cards > 0 ? round(acc.seen / acc.cards) : 0,
  });

  const subjects: SubjectProgress[] = decks.map((deck) => {
    const acc = total.get(deck.id)!;
    const ownExam = effectiveExamDate(decks, deck.name);
    const examAt = ownExam ? localDateTime(ownExam, settings.dayStartHour, settings.timezone) : null;
    return {
      id: deck.id,
      name: deck.name,
      shortName: deck.shortName,
      parentId: deck.parentId,
      depth: deck.depth,
      ...summarize(acc),
      drafts: deck.totals.drafts,
      exam:
        ownExam && examAt && examAt > now
          ? {
              date: ownExam,
              daysLeft: Math.ceil((examAt.getTime() - now.getTime()) / 86_400_000),
              predictedRecall: acc.examCards > 0 ? round(acc.sumRExam / acc.examCards) : 0,
            }
          : null,
    };
  });

  const overallAcc = emptyAccumulator();
  for (const acc of own.values()) for (const key of Object.keys(acc) as Array<keyof Accumulator>) overallAcc[key] += acc[key];

  // Heatmap of reviews per study day.
  const modifier = studyDaySqlModifier(now, settings.timezone, settings.dayStartHour);
  const first = studyDay(now, settings.timezone, settings.dayStartHour, -(days - 1));
  const perDay = new Map(
    (
      db
        .prepare(
          `SELECT date(reviewed_at, @modifier) AS day, COUNT(*) AS reviews FROM review_logs
           WHERE user_id = @userId AND reviewed_at >= @since GROUP BY day`
        )
        .all({ userId, modifier, since: first.start.toISOString() }) as Array<{ day: string; reviews: number }>
    ).map((row) => [row.day, row.reviews])
  );
  const heatDays = Array.from({ length: days }, (_, i) => {
    const date = studyDay(now, settings.timezone, settings.dayStartHour, i - (days - 1)).date;
    return { date, reviews: perDay.get(date) ?? 0 };
  });
  let streakDays = 0;
  for (let i = heatDays.length - 1 - (heatDays[heatDays.length - 1].reviews > 0 ? 0 : 1); i >= 0 && heatDays[i].reviews > 0; i--) {
    streakDays++;
  }

  return {
    generatedAt: now.toISOString(),
    overall: { ...summarize(overallAcc), drafts: decks.reduce((sum, deck) => sum + deck.counts.drafts, 0) },
    subjects,
    heatmap: {
      from: heatDays[0].date,
      to: today.date,
      days: heatDays,
      maxReviews: Math.max(0, ...heatDays.map((day) => day.reviews)),
      studiedDays: heatDays.filter((day) => day.reviews > 0).length,
      totalReviews: heatDays.reduce((sum, day) => sum + day.reviews, 0),
      streakDays,
    },
    documents: listDocuments(userId).map((doc) => ({
      id: doc.id,
      title: doc.title,
      deck: doc.deck?.name ?? null,
      parts: doc.parts,
      partsCovered: doc.cards.partsCovered,
      cards: doc.cards.active,
      drafts: doc.cards.drafts,
    })),
  };
}
