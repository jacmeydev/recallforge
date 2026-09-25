import { beforeEach, describe, expect, it } from 'vitest';
import { addCards, deleteCards, getCard, searchCards, updateCard } from '@/lib/core/cards';
import { deleteDeck, listDecks, updateDeck } from '@/lib/core/decks';
import { AppError } from '@/lib/core/errors';
import { getSettings, updateSettings } from '@/lib/core/settings';
import { getStats } from '@/lib/core/stats';
import { gradeCard, nextCard, resetCard, revealCard } from '@/lib/core/study';
import { studyDay } from '@/lib/core/time';
import { findUserByApiKey, rotateApiKey, verifyCredentials } from '@/lib/core/users';
import { createTestUser, DAY, MINUTE, useFreshDatabase } from './helpers';

const T0 = new Date('2026-03-02T15:00:00.000Z');

async function userWithCards(cards: Array<{ front: string; back: string; tags?: string[] }>, deck = 'Cardiología') {
  const { user } = await createTestUser();
  const result = addCards(user.id, { deck, cards });
  return { userId: user.id, ids: result.created.map((c) => c.id) };
}

beforeEach(() => {
  useFreshDatabase();
});

describe('cards and decks', () => {
  it('creates decks on demand, keeps order and skips duplicate fronts', async () => {
    const { user } = await createTestUser();
    const first = addCards(user.id, {
      deck: 'Farmacología',
      cards: [
        { front: '¿Mecanismo de acción de los IECA?', back: 'Inhiben la enzima convertidora de angiotensina', tags: ['cardio', ' cardio ', 'hta'] },
        { front: 'Antídoto de la heparina', back: 'Sulfato de protamina' },
      ],
    });
    expect(first.decksCreated).toEqual(['Farmacología']);
    expect(first.created).toHaveLength(2);

    const second = addCards(user.id, {
      deck: 'farmacología',
      cards: [
        { front: '  antídoto de la   HEPARINA ', back: 'Protamina' },
        { front: 'Antídoto de la warfarina', back: 'Vitamina K', deck: 'Hematología' },
      ],
    });
    expect(second.skipped).toEqual([
      expect.objectContaining({ index: 0, reason: 'duplicate front in deck', existingCardId: first.created[1].id }),
    ]);
    expect(second.created.map((c) => c.deck)).toEqual(['Hematología']);

    const card = getCard(user.id, first.created[0].id);
    expect(card.tags).toEqual(['cardio', 'hta']);
    expect(card.state).toBe('new');

    const decks = listDecks(user.id);
    expect(decks.map((d) => [d.name, d.counts.total, d.counts.new])).toEqual([
      ['Farmacología', 2, 2],
      ['Hematología', 1, 1],
    ]);
  });

  it('requires a deck for every card', async () => {
    const { user } = await createTestUser();
    expect(() => addCards(user.id, { cards: [{ front: 'Q', back: 'A' }] })).toThrow(AppError);
  });

  it('updates, moves, suspends, searches and deletes cards', async () => {
    const { userId, ids } = await userWithCards([
      { front: 'Receptor beta_1: localización principal', back: 'Corazón', tags: ['farmaco::adrenergicos'] },
      { front: 'Ley de Frank-Starling', back: 'A mayor precarga, mayor volumen sistólico' },
    ]);

    const moved = updateCard(userId, ids[1], { deck: 'Fisiología', back: 'Mayor precarga → mayor gasto', suspended: true });
    expect(moved.deck.name).toBe('Fisiología');
    expect(moved.suspended).toBe(true);

    expect(searchCards(userId, { query: 'beta_1' }).cards.map((c) => c.id)).toEqual([ids[0]]);
    expect(searchCards(userId, { query: 'beta%' }).total).toBe(0);
    expect(searchCards(userId, { tag: 'farmaco' }).total).toBe(1);
    expect(searchCards(userId, { state: 'suspended' }).cards[0].id).toBe(ids[1]);

    expect(deleteCards(userId, [ids[0], 'missing'])).toEqual({ deleted: [ids[0]], notFound: ['missing'] });
    expect(() => getCard(userId, ids[0])).toThrow(/not found/);
  });

  it('renames and deletes decks with their cards', async () => {
    const { userId, ids } = await userWithCards([{ front: 'Q', back: 'A' }]);
    const renamed = updateDeck(userId, 'Cardiología', { name: 'Cardio' });
    expect(renamed.name).toBe('Cardio');
    expect(deleteDeck(userId, 'cardio').deletedCards).toBe(1);
    expect(() => getCard(userId, ids[0])).toThrow(/not found/);
  });

  it('isolates users from each other', async () => {
    const a = await userWithCards([{ front: 'Q', back: 'A' }]);
    const { user: other } = await createTestUser();
    expect(() => getCard(other.id, a.ids[0])).toThrow(/not found/);
    expect(nextCard(other.id, {}, T0).card).toBeNull();
    expect(listDecks(other.id)).toEqual([]);
  });
});

describe('study protocol', () => {
  it('asks the question without the answer, reveals it, then reschedules and logs the attempt', async () => {
    const { userId, ids } = await userWithCards([{ front: '¿Qué nervio inerva el diafragma?', back: 'El nervio frénico (C3-C5)' }]);

    const next = nextCard(userId, {}, T0);
    expect(next.card).toMatchObject({ id: ids[0], front: '¿Qué nervio inerva el diafragma?', state: 'new' });
    expect(next.card).not.toHaveProperty('back');
    expect(next.remaining).toEqual({ learning: 0, review: 0, new: 1 });

    const revealed = revealCard(userId, ids[0], T0);
    expect(revealed.card.back).toBe('El nervio frénico (C3-C5)');
    expect(Object.keys(revealed.outcomes)).toEqual(['again', 'hard', 'good', 'easy']);
    expect(new Date(revealed.outcomes.easy.dueAt).getTime()).toBeGreaterThan(new Date(revealed.outcomes.again.dueAt).getTime());
    expect(revealed.recentAttempts).toEqual([]);

    const graded = gradeCard(userId, ids[0], { rating: 'again', answer: 'El vago', feedback: 'Confundió vago con frénico' }, 'agent', T0);
    expect(graded).toMatchObject({ previousState: 'new', state: 'learning', interval: '1m' });

    const again = revealCard(userId, ids[0], T0);
    expect(again.recentAttempts).toEqual([
      { reviewedAt: T0.toISOString(), rating: 'again', answer: 'El vago', feedback: 'Confundió vago con frénico' },
    ]);
  });

  it('brings a failed card back within the same session thanks to learn-ahead', async () => {
    const { userId, ids } = await userWithCards([{ front: 'Q1', back: 'A1' }]);
    gradeCard(userId, ids[0], { rating: 'again' }, 'api', T0);
    const next = nextCard(userId, {}, new Date(T0.getTime() + 5_000));
    expect(next.card?.id).toBe(ids[0]);
    expect(next.remaining).toEqual({ learning: 1, review: 0, new: 0 });
  });

  it('orders learning before reviews before new cards', async () => {
    const { userId, ids } = await userWithCards([
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
      { front: 'Q3', back: 'A3' },
    ]);
    gradeCard(userId, ids[0], { rating: 'easy' }, 'api', T0);
    const later = new Date(T0.getTime() + 60 * DAY);
    gradeCard(userId, ids[1], { rating: 'again' }, 'api', later);

    const at = new Date(later.getTime() + 2 * MINUTE);
    expect(nextCard(userId, {}, at).card?.id).toBe(ids[1]);
    gradeCard(userId, ids[1], { rating: 'easy' }, 'api', at);
    expect(nextCard(userId, {}, at).card?.id).toBe(ids[0]);
    gradeCard(userId, ids[0], { rating: 'good' }, 'api', at);
    expect(nextCard(userId, {}, at).card?.id).toBe(ids[2]);
  });

  it('enforces the daily new-card limit per study day and explains why the queue is empty', async () => {
    const { userId, ids } = await userWithCards([
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
      { front: 'Q3', back: 'A3' },
    ]);
    updateSettings(userId, { newCardsPerDay: 2 });
    gradeCard(userId, ids[0], { rating: 'easy' }, 'api', T0);
    gradeCard(userId, ids[1], { rating: 'easy' }, 'api', T0);

    const blocked = nextCard(userId, {}, T0);
    expect(blocked.card).toBeNull();
    expect(blocked.remaining.new).toBe(0);
    expect(blocked.message).toMatch(/new-card limit/);
    expect(blocked.nextDueAt).toBeTruthy();

    const tomorrow = nextCard(userId, {}, new Date(T0.getTime() + DAY));
    expect(tomorrow.card?.id).toBe(ids[2]);
  });

  it('accepts numeric ratings and rejects invalid ones', async () => {
    const { userId, ids } = await userWithCards([{ front: 'Q1', back: 'A1' }]);
    expect(gradeCard(userId, ids[0], { rating: 3 }, 'api', T0).rating).toBe('good');
    expect(() => gradeCard(userId, ids[0], { rating: 'perfect' }, 'api', T0)).toThrow(AppError);
  });

  it('filters the queue by deck and hierarchical tag', async () => {
    const { user } = await createTestUser();
    const { created } = addCards(user.id, {
      cards: [
        { front: 'Cardio Q', back: 'A', deck: 'Cardiología', tags: ['cardio::arritmias'] },
        { front: 'Neuro Q', back: 'A', deck: 'Neurología', tags: ['neuro'] },
      ],
    });
    expect(nextCard(user.id, { deck: 'Neurología' }, T0).card?.id).toBe(created[1].id);
    expect(nextCard(user.id, { tag: 'cardio' }, T0).card?.id).toBe(created[0].id);
    expect(nextCard(user.id, { tag: 'cardio::arritmias' }, T0).remaining.new).toBe(1);
    expect(() => nextCard(user.id, { deck: 'Nope' }, T0)).toThrow(/Deck not found/);
  });

  it('can reset a card to new', async () => {
    const { userId, ids } = await userWithCards([{ front: 'Q1', back: 'A1' }]);
    gradeCard(userId, ids[0], { rating: 'easy' }, 'api', T0);
    expect(resetCard(userId, ids[0], T0)).toMatchObject({ state: 'new', reps: 0 });
  });
});

describe('stats', () => {
  it('reports today, retention, streak, forecast and weak cards', async () => {
    const { userId, ids } = await userWithCards([
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
    ]);
    const yesterday = new Date(T0.getTime() - DAY);
    gradeCard(userId, ids[0], { rating: 'easy', durationMs: 30_000 }, 'api', yesterday);
    gradeCard(userId, ids[1], { rating: 'again', durationMs: 30_000 }, 'api', T0);
    gradeCard(userId, ids[1], { rating: 'good', durationMs: 30_000 }, 'api', new Date(T0.getTime() + 2 * MINUTE));

    const stats = getStats(userId, {}, new Date(T0.getTime() + 3 * MINUTE));
    expect(stats.today).toMatchObject({ reviews: 2, newCards: 1, again: 1, good: 1, accuracy: 0.5, minutes: 1 });
    expect(stats.streakDays).toBe(2);
    expect(stats.cards).toMatchObject({ total: 2, new: 0 });
    expect(stats.cards.review + stats.cards.learning).toBe(2);
    expect(stats.weakCards.map((c) => c.id)).toEqual([ids[1]]);
    expect(stats.forecast).toHaveLength(7);
    expect(stats.forecast.reduce((sum, day) => sum + day.due, 0)).toBeGreaterThanOrEqual(1);
    expect(stats.settings.newCardsPerDay).toBe(20);
  });
});

describe('settings, time and accounts', () => {
  it('validates settings patches', async () => {
    const { user } = await createTestUser();
    expect(updateSettings(user.id, { desiredRetention: 0.85, timezone: 'America/Bogota' })).toMatchObject({
      desiredRetention: 0.85,
      timezone: 'America/Bogota',
    });
    expect(() => updateSettings(user.id, { desiredRetention: 2 })).toThrow(AppError);
    expect(() => updateSettings(user.id, { timezone: 'Mars/Olympus' })).toThrow(AppError);
    expect(() => updateSettings(user.id, { unknown: true })).toThrow(AppError);
    expect(getSettings(user.id).learningSteps).toEqual(['1m', '10m']);
  });

  it('computes study days in the learner timezone with a rollover hour', () => {
    // 03:00 in Bogotá (UTC-5) still belongs to the previous study day when it starts at 04:00.
    const day = studyDay(new Date('2026-09-25T08:00:00Z'), 'America/Bogota', 4);
    expect(day.date).toBe('2026-09-24');
    expect(day.start.toISOString()).toBe('2026-09-24T09:00:00.000Z');
    expect(day.end.toISOString()).toBe('2026-09-25T09:00:00.000Z');
    // DST transition day in Madrid is 23 hours long.
    const madrid = studyDay(new Date('2026-03-29T12:00:00Z'), 'Europe/Madrid', 0);
    expect(madrid.end.getTime() - madrid.start.getTime()).toBe(23 * 3_600_000);
  });

  it('authenticates by password and rotatable API key', async () => {
    const { user, apiKey } = await createTestUser();
    expect(findUserByApiKey(apiKey)?.id).toBe(user.id);
    expect(await verifyCredentials(user.email.toUpperCase(), 'correct-horse-battery')).toMatchObject({ id: user.id });
    expect(await verifyCredentials(user.email, 'wrong-password')).toBeNull();
    const rotated = rotateApiKey(user.id);
    expect(findUserByApiKey(apiKey)).toBeNull();
    expect(findUserByApiKey(rotated.apiKey)?.id).toBe(user.id);
  });
});
