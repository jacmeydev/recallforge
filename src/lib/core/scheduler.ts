// ============================================================================
// RecallForge — FSRS scheduling (ts-fsrs)
// ============================================================================

import {
  fsrs,
  generatorParameters,
  Rating as FsrsRating,
  State,
  type Card as FsrsCard,
  type FSRS,
  type Grade,
  type StepUnit,
} from 'ts-fsrs';
import { formatInterval } from './time';
import type { CardRow, CardState, Rating, StudySettings } from './types';

const GRADES: Record<Rating, Grade> = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy,
};

const TO_STATE: Record<CardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const FROM_STATE: Record<State, CardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

const schedulerCache = new Map<string, FSRS>();

export function createScheduler(settings: StudySettings): FSRS {
  const key = JSON.stringify(settings);
  const cached = schedulerCache.get(key);
  if (cached) return cached;
  if (schedulerCache.size > 100) schedulerCache.clear();
  const scheduler = buildScheduler(settings);
  schedulerCache.set(key, scheduler);
  return scheduler;
}

function buildScheduler(settings: StudySettings): FSRS {
  return fsrs(
    generatorParameters({
      request_retention: settings.desiredRetention,
      maximum_interval: settings.maximumInterval,
      enable_fuzz: settings.enableFuzz,
      learning_steps: settings.learningSteps as StepUnit[],
      relearning_steps: settings.relearningSteps as StepUnit[],
      ...(settings.fsrsWeights.length > 0 ? { w: settings.fsrsWeights } : {}),
    })
  );
}

type SchedulingFields = Pick<
  CardRow,
  | 'state'
  | 'due_at'
  | 'stability'
  | 'difficulty'
  | 'elapsed_days'
  | 'scheduled_days'
  | 'reps'
  | 'lapses'
  | 'learning_steps'
  | 'last_review_at'
>;

function toFsrsCard(card: SchedulingFields): FsrsCard {
  return {
    due: new Date(card.due_at),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: TO_STATE[card.state] ?? State.New,
    last_review: card.last_review_at ? new Date(card.last_review_at) : undefined,
  };
}

export interface ScheduledOutcome {
  card: SchedulingFields;
  interval: string;
}

export function previewOutcomes(
  card: SchedulingFields,
  settings: StudySettings,
  now: Date
): Record<Rating, { dueAt: string; interval: string }> {
  const preview = createScheduler(settings).repeat(toFsrsCard(card), now);
  const result = {} as Record<Rating, { dueAt: string; interval: string }>;
  for (const rating of Object.keys(GRADES) as Rating[]) {
    const due = preview[GRADES[rating]].card.due;
    result[rating] = { dueAt: due.toISOString(), interval: formatInterval(due.getTime() - now.getTime()) };
  }
  return result;
}

export function schedule(card: SchedulingFields, rating: Rating, settings: StudySettings, now: Date): ScheduledOutcome {
  const next = createScheduler(settings).next(toFsrsCard(card), now, GRADES[rating]).card;
  return {
    card: {
      state: FROM_STATE[next.state],
      due_at: next.due.toISOString(),
      stability: next.stability,
      difficulty: next.difficulty,
      elapsed_days: next.elapsed_days,
      scheduled_days: next.scheduled_days,
      reps: next.reps,
      lapses: next.lapses,
      learning_steps: next.learning_steps,
      last_review_at: (next.last_review ?? now).toISOString(),
    },
    interval: formatInterval(next.due.getTime() - now.getTime()),
  };
}

export function retrievability(card: SchedulingFields, settings: StudySettings, now: Date): number | null {
  if (card.state === 'new' || !card.last_review_at || card.stability <= 0) return null;
  const value = createScheduler(settings).get_retrievability(toFsrsCard(card), now, false);
  return Math.round(value * 1000) / 1000;
}
