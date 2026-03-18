// ============================================================================
// RecallForge — FSRS Engine Wrapper
// ============================================================================
// Wraps ts-fsrs to provide the scheduling engine for RecallForge.
// Uses the mature open-source ts-fsrs library (FSRS-5 compliant).
// ============================================================================

import {
  FSRS,
  fsrs,
  generatorParameters,
  type FSRSParameters,
  Rating,
  State,
  type Card as FSRSCard,
  type RecordLogItem,
  type Grade,
  createEmptyCard,
} from 'ts-fsrs';

import type {
  Card,
  CardState,
  ReviewRating,
  SchedulingPreset,
  IntervalPreview,
} from '@/types';
import { formatInterval } from '@/lib/utils';

// ─── Mapping utilities ─────────────────────────────────────────────────────

export function mapRatingToGrade(rating: ReviewRating): Grade {
  switch (rating) {
    case 'again': return Rating.Again;
    case 'hard': return Rating.Hard;
    case 'good': return Rating.Good;
    case 'easy': return Rating.Easy;
  }
}

export function mapGradeToRating(grade: Grade): ReviewRating {
  switch (grade) {
    case Rating.Again: return 'again';
    case Rating.Hard: return 'hard';
    case Rating.Good: return 'good';
    case Rating.Easy: return 'easy';
    default: return 'good';
  }
}

export function mapStateToCardState(state: State): CardState {
  switch (state) {
    case State.New: return 'new';
    case State.Learning: return 'learning';
    case State.Review: return 'review';
    case State.Relearning: return 'relearning';
  }
}

export function mapCardStateToState(state: CardState): State {
  switch (state) {
    case 'new': return State.New;
    case 'learning': return State.Learning;
    case 'review': return State.Review;
    case 'relearning': return State.Relearning;
  }
}

// ─── Convert app Card to ts-fsrs Card ──────────────────────────────────────

export function toFSRSCard(card: Card): FSRSCard {
  return {
    due: new Date(card.dueAt),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    learning_steps: card.learningSteps ?? 0,
    state: mapCardStateToState(card.state),
    last_review: card.lastReviewAt ? new Date(card.lastReviewAt) : undefined,
  };
}

// ─── Convert ts-fsrs Card back to app Card partial ─────────────────────────

export function fromFSRSCard(
  fsrsCard: FSRSCard,
  original: Card
): Partial<Card> {
  return {
    dueAt: fsrsCard.due.toISOString(),
    stability: fsrsCard.stability,
    difficulty: fsrsCard.difficulty,
    elapsedDays: fsrsCard.elapsed_days,
    scheduledDays: fsrsCard.scheduled_days,
    reps: fsrsCard.reps,
    lapses: fsrsCard.lapses,
    learningSteps: fsrsCard.learning_steps ?? 0,
    state: mapStateToCardState(fsrsCard.state),
    lastReviewAt: fsrsCard.last_review?.toISOString() ?? original.lastReviewAt,
  };
}

// ─── Create FSRS instance from preset ──────────────────────────────────────

export function createScheduler(preset: SchedulingPreset): FSRS {
  const params: FSRSParameters = generatorParameters({
    request_retention: preset.desiredRetention,
    maximum_interval: preset.maximumInterval,
    w: preset.fsrsParameters.length > 0 ? preset.fsrsParameters : undefined,
    enable_fuzz: preset.enableFuzz,
  });
  return fsrs(params);
}

// ─── Get default preset ────────────────────────────────────────────────────

export function getDefaultPreset(): SchedulingPreset {
  return {
    id: 'default',
    userId: '',
    name: 'Default',
    desiredRetention: 0.9,
    learningSteps: [1, 10],
    relearningSteps: [10],
    maximumInterval: 36500,
    enableFuzz: true,
    buryNewSiblings: true,
    buryReviewSiblings: false,
    newCardOrder: 'sequential',
    reviewOrder: 'due_date',
    dailyLimits: { newCards: 20, reviews: 200 },
    fsrsParameters: [],
    optimizerMetadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ─── Default FSRS instance ─────────────────────────────────────────────────

let defaultScheduler: FSRS | null = null;

export function getDefaultScheduler(): FSRS {
  if (!defaultScheduler) {
    defaultScheduler = createScheduler(getDefaultPreset());
  }
  return defaultScheduler;
}

// ─── Schedule a review ─────────────────────────────────────────────────────

export interface ScheduleResult {
  card: Partial<Card>;
  log: {
    rating: ReviewRating;
    previousState: CardState;
    nextState: CardState;
    previousStability: number;
    nextStability: number;
    previousDifficulty: number;
    nextDifficulty: number;
    previousDueAt: string;
    nextDueAt: string;
  };
}

export function scheduleReview(
  card: Card,
  rating: ReviewRating,
  preset?: SchedulingPreset,
  reviewTime?: Date
): ScheduleResult {
  const scheduler = preset ? createScheduler(preset) : getDefaultScheduler();
  const fsrsCard = toFSRSCard(card);
  const now = reviewTime || new Date();

  const result = scheduler.repeat(fsrsCard, now);
  const grade = mapRatingToGrade(rating);
  const recordLog: RecordLogItem = result[grade];

  const updatedCard = fromFSRSCard(recordLog.card, card);

  return {
    card: {
      ...updatedCard,
      updatedAt: now.toISOString(),
    },
    log: {
      rating,
      previousState: card.state,
      nextState: updatedCard.state!,
      previousStability: card.stability,
      nextStability: updatedCard.stability!,
      previousDifficulty: card.difficulty,
      nextDifficulty: updatedCard.difficulty!,
      previousDueAt: card.dueAt,
      nextDueAt: updatedCard.dueAt!,
    },
  };
}

// ─── Get interval previews for all buttons ─────────────────────────────────

export function getIntervalPreviews(
  card: Card,
  preset?: SchedulingPreset,
  reviewTime?: Date
): IntervalPreview {
  const scheduler = preset ? createScheduler(preset) : getDefaultScheduler();
  const fsrsCard = toFSRSCard(card);
  const now = reviewTime || new Date();

  const result = scheduler.repeat(fsrsCard, now);

  function formatResult(grade: Grade) {
    const r = result[grade];
    const days = r.card.scheduled_days;

    // For learning/relearning cards, scheduled_days is 0 (intra-day).
    // Compute actual interval from due date difference instead.
    if (days === 0) {
      const diffMs = r.card.due.getTime() - now.getTime();
      if (diffMs > 0) {
        const diffDays = diffMs / (24 * 60 * 60 * 1000);
        return {
          interval: formatInterval(diffDays),
          dueDate: r.card.due.toISOString(),
        };
      }
    }

    return {
      interval: formatInterval(days),
      dueDate: r.card.due.toISOString(),
    };
  }

  return {
    again: formatResult(Rating.Again),
    hard: formatResult(Rating.Hard),
    good: formatResult(Rating.Good),
    easy: formatResult(Rating.Easy),
  };
}

// ─── Create a new empty card ───────────────────────────────────────────────

export function createNewFSRSCard(): Partial<Card> {
  const empty = createEmptyCard();
  return {
    dueAt: empty.due.toISOString(),
    state: 'new',
    stability: empty.stability,
    difficulty: empty.difficulty,
    elapsedDays: empty.elapsed_days,
    scheduledDays: empty.scheduled_days,
    reps: empty.reps,
    lapses: empty.lapses,
    learningSteps: 0,
    lastReviewAt: null,
  };
}

// ─── Calculate retrievability ──────────────────────────────────────────────

export function calculateRetrievability(card: Card, now?: Date): number {
  if (card.state === 'new') return 0;
  if (card.stability <= 0) return 0;

  const currentTime = now || new Date();
  const lastReview = card.lastReviewAt ? new Date(card.lastReviewAt) : new Date(card.dueAt);
  const elapsedDays = (currentTime.getTime() - lastReview.getTime()) / (1000 * 60 * 60 * 24);

  if (elapsedDays <= 0) return 1;

  // FSRS retrievability formula: R = (1 + t / (9 * s))^-1
  // where t = elapsed time, s = stability
  const retrievability = Math.pow(1 + elapsedDays / (9 * card.stability), -1);
  return Math.max(0, Math.min(1, retrievability));
}

// ─── Forecast utility ──────────────────────────────────────────────────────

export interface ForecastDay {
  date: string;
  dueCards: number;
  newCards: number;
  learningCards: number;
  reviewCards: number;
}

export function generateForecast(
  cards: Card[],
  days: number = 30,
  newPerDay: number = 20
): ForecastDay[] {
  const forecast: ForecastDay[] = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];

    let dueCards = 0;
    let newCards = 0;
    let learningCards = 0;
    let reviewCards = 0;

    for (const card of cards) {
      const cardDue = new Date(card.dueAt);
      if (cardDue.toISOString().split('T')[0] <= dateStr) {
        if (card.state === 'new') {
          newCards++;
        } else if (card.state === 'learning' || card.state === 'relearning') {
          learningCards++;
        } else {
          reviewCards++;
        }
        dueCards++;
      }
    }

    // Cap new cards
    newCards = Math.min(newCards, newPerDay);

    forecast.push({ date: dateStr, dueCards, newCards, learningCards, reviewCards });
  }

  return forecast;
}

// ─── Leech detection ───────────────────────────────────────────────────────

export function isLeech(card: Card, threshold: number = 8): boolean {
  return card.lapses >= threshold;
}

// ─── Overdue detection ─────────────────────────────────────────────────────

export function isOverdue(card: Card, now?: Date): boolean {
  if (card.state === 'new') return false;
  const currentTime = now || new Date();
  return new Date(card.dueAt) < currentTime;
}

export function getOverdueDays(card: Card, now?: Date): number {
  if (card.state === 'new') return 0;
  const currentTime = now || new Date();
  const dueDate = new Date(card.dueAt);
  const diff = (currentTime.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, diff);
}
