// ============================================================================
// RecallForge — Personal FSRS parameters
// ============================================================================
// FSRS ships with parameters fitted on millions of learners. With a few
// hundred reviews of your own (including an imported Anki history), the
// official optimizer (fsrs-rs, the same one Anki uses) fits parameters to how
// *you* forget. They are only applied when they predict your history better
// than the current ones, and the result says by how much.
// ============================================================================

import { getDb } from './db';
import { badRequest } from './errors';
import { getSettings, updateSettings } from './settings';
import { studyDay } from './time';
import type { Rating } from './types';

const RATING: Record<Rating, number> = { again: 1, hard: 2, good: 3, easy: 4 };
/** Below this many reviews the defaults are better than anything we could fit. */
export const MIN_REVIEWS_TO_OPTIMIZE = 200;

export interface OptimizeResult {
  reviews: number;
  cards: number;
  /** Log loss and RMSE of the parameters in use before, and of the new ones (lower is better). */
  before: { logLoss: number; rmse: number };
  after: { logLoss: number; rmse: number };
  parameters: number[];
  applied: boolean;
  message: string;
}

type Binding = typeof import('@open-spaced-repetition/binding');

async function loadBinding(): Promise<Binding> {
  try {
    return await import('@open-spaced-repetition/binding');
  } catch {
    throw badRequest('The FSRS optimizer is not available on this platform');
  }
}

export async function optimizeScheduler(userId: string, options: { apply?: boolean } = {}): Promise<OptimizeResult> {
  const settings = getSettings(userId);
  const logs = getDb()
    .prepare(
      `SELECT card_id, reviewed_at, rating FROM review_logs
       WHERE user_id = ? AND mode != 'practice' ORDER BY card_id, reviewed_at`
    )
    .all(userId) as Array<{ card_id: string; reviewed_at: string; rating: Rating }>;
  if (logs.length < MIN_REVIEWS_TO_OPTIMIZE) {
    throw badRequest(
      `Personalising the scheduler needs at least ${MIN_REVIEWS_TO_OPTIMIZE} reviews (you have ${logs.length}). Keep studying, or import your Anki history.`
    );
  }

  const binding = await loadBinding();
  const dayNumber = (iso: string) => {
    const date = studyDay(new Date(iso), settings.timezone, settings.dayStartHour).date;
    return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  };

  // One training item per review after the first: the card's history up to that review.
  const items: InstanceType<Binding['FSRSBindingItem']>[] = [];
  let cards = 0;
  for (let i = 0; i < logs.length; ) {
    let j = i;
    while (j < logs.length && logs[j].card_id === logs[i].card_id) j++;
    const reviews: InstanceType<Binding['FSRSBindingReview']>[] = [];
    let previous: number | null = null;
    for (let k = i; k < j; k++) {
      const day = dayNumber(logs[k].reviewed_at);
      reviews.push(new binding.FSRSBindingReview(RATING[logs[k].rating], previous === null ? 0 : day - previous));
      previous = day;
      if (reviews.length >= 2) {
        const item = new binding.FSRSBindingItem([...reviews]);
        if (item.longTermReviewCnt() > 0) items.push(item);
      }
    }
    if (j - i >= 2) cards++;
    i = j;
  }
  if (items.length < 50) {
    throw badRequest('Not enough repeated reviews across days yet to personalise the scheduler. Keep studying for a few more days.');
  }

  const parameters = await binding.computeParameters(items, { enableShortTerm: true });
  const current = settings.fsrsWeights.length ? new binding.FSRSBinding(settings.fsrsWeights) : new binding.FSRSBinding();
  const before = current.evaluate(items);
  const after = new binding.FSRSBinding(parameters).evaluate(items);
  const better = after.logLoss < before.logLoss;
  const applied = better && options.apply !== false;
  if (applied) updateSettings(userId, { fsrsWeights: parameters.map((p) => Math.round(p * 10000) / 10000) });

  const round = (v: number) => Math.round(v * 10000) / 10000;
  const gain = before.logLoss > 0 ? Math.round(((before.logLoss - after.logLoss) / before.logLoss) * 100) : 0;
  return {
    reviews: logs.length,
    cards,
    before: { logLoss: round(before.logLoss), rmse: round(before.rmseBins) },
    after: { logLoss: round(after.logLoss), rmse: round(after.rmseBins) },
    parameters,
    applied,
    message: better
      ? `${applied ? 'Applied' : 'Found'} personal parameters: they predict your memory ${gain}% better (log loss ${round(before.logLoss)} → ${round(after.logLoss)}).`
      : 'Your current parameters already predict your memory as well as a new fit; nothing changed.',
  };
}
