import { beforeEach, describe, expect, it } from 'vitest';
import { addCards, getCard } from '@/lib/core/cards';
import { optimizeScheduler } from '@/lib/core/optimizer';
import { getSettings } from '@/lib/core/settings';
import { gradeCard } from '@/lib/core/study';
import { createTestUser, DAY, useFreshDatabase } from './helpers';

beforeEach(() => {
  useFreshDatabase();
});

/** A learner who forgets faster than the FSRS defaults assume. */
function simulate(userId: string, ids: string[], days: number) {
  let seed = 42;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const start = new Date('2026-01-01T10:00:00Z').getTime();
  for (let day = 0; day < days; day++) {
    const now = new Date(start + day * DAY);
    for (const id of ids) {
      const card = getCard(userId, id);
      if (card.state !== 'new' && new Date(card.dueAt).getTime() > now.getTime()) continue;
      if (card.state === 'new' && day > ids.indexOf(id) / 10) {
        /* introduce ~10 new cards per day */
      } else if (card.state === 'new') continue;
      const elapsed = card.lastReviewAt ? (now.getTime() - new Date(card.lastReviewAt).getTime()) / DAY : 0;
      const recall = card.state === 'new' ? 0.6 : Math.exp(-elapsed / Math.max(1, card.stability * 0.4));
      gradeCard(userId, id, { rating: random() < recall ? 'good' : 'again' }, 'api', now);
    }
  }
}

describe('personal FSRS parameters', () => {
  it('refuses with too little history', async () => {
    const { user } = await createTestUser();
    await expect(optimizeScheduler(user.id)).rejects.toThrow(/at least 200 reviews/);
  });

  it('fits parameters to the learner history and applies them only if they predict it better', async () => {
    const { user } = await createTestUser();
    const { created } = addCards(user.id, {
      deck: 'Sim',
      cards: Array.from({ length: 120 }, (_, i) => ({ front: `Pregunta simulada número ${i}`, back: `Respuesta ${i}` })),
    });
    simulate(user.id, created.map((c) => c.id), 60);
    const result = await optimizeScheduler(user.id);
    expect(result.reviews).toBeGreaterThan(200);
    expect(result.parameters.length).toBeGreaterThanOrEqual(19);
    expect(result.after.logLoss).toBeLessThanOrEqual(result.before.logLoss);
    expect(result.applied).toBe(true);
    expect(getSettings(user.id).fsrsWeights).toHaveLength(result.parameters.length);
    // The scheduler keeps working with the personal parameters.
    expect(() => gradeCard(user.id, created[0].id, { rating: 'good' })).not.toThrow();
  }, 120_000);
});
