import { beforeEach, describe, expect, it } from 'vitest';
import { addCards, getCard } from '@/lib/core/cards';
import { updateDeck } from '@/lib/core/decks';
import { AppError } from '@/lib/core/errors';
import { getProgressMap } from '@/lib/core/progress';
import { gradeCard, nextCard, undoLastReview } from '@/lib/core/study';
import { createTestUser, DAY, MINUTE, useFreshDatabase } from './helpers';

const T0 = new Date('2026-03-02T15:00:00.000Z');

beforeEach(() => {
  useFreshDatabase();
});

async function learner() {
  const { user } = await createTestUser();
  const { created } = addCards(user.id, {
    cards: [
      { front: 'Mecanismo de la penicilina', back: 'Inhibe la transpeptidasa', deck: 'Medicina::Farmacología' },
      { front: 'Antídoto de la heparina', back: 'Protamina', deck: 'Medicina::Farmacología' },
      { front: 'Nervio del deltoides', back: 'Axilar', deck: 'Medicina::Anatomía' },
      { front: 'Músculo que abduce 0-15°', back: 'Supraespinoso', deck: 'Medicina::Anatomía' },
    ],
  });
  return { userId: user.id, ids: created.map((c) => c.id) };
}

describe('progress map', () => {
  it('rolls mastery, coverage and counts up the subject tree and builds a study heatmap', async () => {
    const { userId, ids } = await learner();
    gradeCard(userId, ids[0], { rating: 'easy' }, 'api', new Date(T0.getTime() - 2 * DAY));
    gradeCard(userId, ids[1], { rating: 'easy' }, 'api', T0);

    const map = getProgressMap(userId, { days: 30 }, new Date(T0.getTime() + MINUTE));
    const bySubject = Object.fromEntries(map.subjects.map((s) => [s.name, s]));
    expect(bySubject['Medicina::Farmacología']).toMatchObject({ cards: 2, unseen: 0, coverage: 1 });
    expect(bySubject['Medicina::Farmacología'].mastery).toBeGreaterThan(0.9);
    expect(bySubject['Medicina::Anatomía']).toMatchObject({ cards: 2, unseen: 2, coverage: 0, mastery: 0, recall: null });
    expect(bySubject['Medicina']).toMatchObject({ cards: 4, unseen: 2, coverage: 0.5, depth: 0 });
    expect(bySubject['Medicina'].mastery).toBeCloseTo(bySubject['Medicina::Farmacología'].mastery / 2, 2);
    expect(map.overall).toMatchObject({ cards: 4, unseen: 2 });

    expect(map.heatmap.days).toHaveLength(30);
    expect(map.heatmap).toMatchObject({ totalReviews: 2, studiedDays: 2, streakDays: 1, maxReviews: 1 });
    expect(map.heatmap.to).toBe('2026-03-02');
  });

  it('predicts recall on exam day for subjects with an exam', async () => {
    const { userId, ids } = await learner();
    gradeCard(userId, ids[0], { rating: 'good' }, 'api', T0);
    updateDeck(userId, 'Medicina::Farmacología', { examDate: '2026-03-20' });
    expect(() => updateDeck(userId, 'Medicina', { examDate: '20/03/2026' })).toThrow(AppError);

    const map = getProgressMap(userId, {}, T0);
    const pharma = map.subjects.find((s) => s.name === 'Medicina::Farmacología')!;
    expect(pharma.exam).toMatchObject({ date: '2026-03-20', daysLeft: 18 });
    expect(pharma.exam!.predictedRecall).toBeLessThan(0.5);
    expect(map.subjects.find((s) => s.name === 'Medicina::Anatomía')!.exam).toBeNull();
  });
});

describe('exam mode', () => {
  it('asks the cards least likely to be remembered on exam day, ignoring limits and due dates', async () => {
    const { userId, ids } = await learner();
    expect(() => nextCard(userId, { deck: 'Medicina', mode: 'exam' }, T0)).toThrow(/exam date/);
    expect(() => nextCard(userId, { mode: 'exam' }, T0)).toThrow(/needs a deck/);

    updateDeck(userId, 'Medicina', { examDate: '2026-04-01' });
    gradeCard(userId, ids[2], { rating: 'easy' }, 'api', new Date(T0.getTime() - 3 * DAY));

    // Unseen cards come first even when the daily new-card limit is 0 and nothing is due.
    const first = nextCard(userId, { deck: 'Medicina::Anatomía', mode: 'exam' }, T0);
    expect(first.card?.id).toBe(ids[3]);
    expect(first.remaining).toMatchObject({ new: 1 });
    // The recently studied card is due long after the exam but still at risk by then: it is asked next.
    gradeCard(userId, ids[3], { rating: 'easy' }, 'api', T0);
    expect(nextCard(userId, { deck: 'Medicina::Anatomía', mode: 'exam' }, T0).card?.id).toBe(ids[2]);
  });
});

describe('undo and leeches', () => {
  it('restores the exact card state and removes the review', async () => {
    const { userId, ids } = await learner();
    const before = getCard(userId, ids[0]);
    gradeCard(userId, ids[0], { rating: 'again' }, 'api', T0);
    expect(getCard(userId, ids[0]).state).toBe('learning');

    const undone = undoLastReview(userId);
    expect(undone.undone).toMatchObject({ cardId: ids[0], rating: 'again' });
    const after = getCard(userId, ids[0]);
    expect(after).toMatchObject({ state: 'new', reps: 0, dueAt: before.dueAt, lastReviewAt: null });
    expect(() => undoLastReview(userId)).toThrow(/no review to undo/);
  });

  it('flags and tags cards that keep being forgotten', async () => {
    const { userId, ids } = await learner();
    let now = T0;
    gradeCard(userId, ids[0], { rating: 'easy' }, 'api', now);
    let result;
    for (let lapse = 1; lapse <= 4; lapse++) {
      now = new Date(now.getTime() + 30 * DAY);
      result = gradeCard(userId, ids[0], { rating: 'again' }, 'api', now);
      now = new Date(now.getTime() + 30 * DAY);
      gradeCard(userId, ids[0], { rating: 'easy' }, 'api', now);
      if (lapse < 4) expect(result.leech).toBe(false);
    }
    expect(result).toMatchObject({ lapses: 4, leech: true });
    expect(getCard(userId, ids[0]).tags).toContain('leech');
  });
});
