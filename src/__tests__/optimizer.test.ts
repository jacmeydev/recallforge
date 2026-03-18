import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  convertReviewLogsToFSRSItems,
  serializeFSRSItems,
  isOptimizerAvailable,
} from '@/lib/services/optimizer-service';
import type { ReviewLog } from '@/types';

// Helper to create a minimal review log
function makeLog(overrides: Partial<ReviewLog> & { cardId: string; reviewedAt: string; rating: ReviewLog['rating'] }): ReviewLog {
  const { cardId, reviewedAt, rating, ...rest } = overrides;
  return {
    id: Math.random().toString(36).slice(2),
    userId: 'user-1',
    cardId,
    reviewedAt,
    rating,
    previousState: 'new',
    nextState: 'learning',
    previousDueAt: reviewedAt,
    nextDueAt: reviewedAt,
    previousStability: 0,
    nextStability: 1,
    previousDifficulty: 5,
    nextDifficulty: 5,
    responseTimeMs: 3000,
    wasManualReschedule: false,
    wasFilteredDeck: false,
    sessionId: null,
    deviceId: null,
    syncStatus: 'pending',
    ...rest,
  };
}

describe('Optimizer Service — convertReviewLogsToFSRSItems', () => {
  it('returns empty for cards with fewer than 2 reviews', () => {
    const logsByCard = new Map([
      ['card-1', [makeLog({ cardId: 'card-1', reviewedAt: '2024-01-01T00:00:00Z', rating: 'good' })]],
    ]);
    const items = convertReviewLogsToFSRSItems(logsByCard);
    expect(items).toHaveLength(0);
  });

  it('creates 1 item for a card with exactly 2 reviews', () => {
    const logsByCard = new Map([
      ['card-1', [
        makeLog({ cardId: 'card-1', reviewedAt: '2024-01-01T00:00:00Z', rating: 'good' }),
        makeLog({ cardId: 'card-1', reviewedAt: '2024-01-02T00:00:00Z', rating: 'easy' }),
      ]],
    ]);
    const items = convertReviewLogsToFSRSItems(logsByCard);
    expect(items).toHaveLength(1);
    expect(items[0].reviews).toHaveLength(2);
    expect(items[0].reviews[0].rating).toBe(3); // good
    expect(items[0].reviews[0].delta_t).toBe(0); // first review
    expect(items[0].reviews[1].rating).toBe(4); // easy
    expect(items[0].reviews[1].delta_t).toBe(1); // 1 day later
  });

  it('creates cumulative items for cards with 3+ reviews', () => {
    const logsByCard = new Map([
      ['card-1', [
        makeLog({ cardId: 'card-1', reviewedAt: '2024-01-01T00:00:00Z', rating: 'again' }),
        makeLog({ cardId: 'card-1', reviewedAt: '2024-01-03T00:00:00Z', rating: 'hard' }),
        makeLog({ cardId: 'card-1', reviewedAt: '2024-01-10T00:00:00Z', rating: 'good' }),
      ]],
    ]);
    const items = convertReviewLogsToFSRSItems(logsByCard);
    // 3 reviews → 2 cumulative items: [r1,r2] and [r1,r2,r3]
    expect(items).toHaveLength(2);

    // First item: [review1, review2]
    expect(items[0].reviews).toHaveLength(2);
    expect(items[0].reviews[0]).toEqual({ rating: 1, delta_t: 0 });
    expect(items[0].reviews[1]).toEqual({ rating: 2, delta_t: 2 });

    // Second item: [review1, review2, review3]
    expect(items[1].reviews).toHaveLength(3);
    expect(items[1].reviews[2]).toEqual({ rating: 3, delta_t: 7 });
  });

  it('handles multiple cards', () => {
    const logsByCard = new Map([
      ['card-1', [
        makeLog({ cardId: 'card-1', reviewedAt: '2024-01-01T00:00:00Z', rating: 'good' }),
        makeLog({ cardId: 'card-1', reviewedAt: '2024-01-02T00:00:00Z', rating: 'good' }),
      ]],
      ['card-2', [
        makeLog({ cardId: 'card-2', reviewedAt: '2024-01-01T00:00:00Z', rating: 'easy' }),
        makeLog({ cardId: 'card-2', reviewedAt: '2024-01-05T00:00:00Z', rating: 'again' }),
        makeLog({ cardId: 'card-2', reviewedAt: '2024-01-06T00:00:00Z', rating: 'good' }),
      ]],
    ]);
    const items = convertReviewLogsToFSRSItems(logsByCard);
    // card-1: 1 item, card-2: 2 items
    expect(items).toHaveLength(3);
  });

  it('sorts reviews chronologically', () => {
    const logsByCard = new Map([
      ['card-1', [
        // Provided out of order
        makeLog({ cardId: 'card-1', reviewedAt: '2024-01-05T00:00:00Z', rating: 'easy' }),
        makeLog({ cardId: 'card-1', reviewedAt: '2024-01-01T00:00:00Z', rating: 'again' }),
      ]],
    ]);
    const items = convertReviewLogsToFSRSItems(logsByCard);
    expect(items[0].reviews[0].rating).toBe(1); // again (earliest)
    expect(items[0].reviews[1].rating).toBe(4); // easy (later)
    expect(items[0].reviews[1].delta_t).toBe(4); // 4 days
  });

  it('maps ratings correctly', () => {
    const logsByCard = new Map([
      ['card-1', [
        makeLog({ cardId: 'card-1', reviewedAt: '2024-01-01T00:00:00Z', rating: 'again' }),
        makeLog({ cardId: 'card-1', reviewedAt: '2024-01-02T00:00:00Z', rating: 'hard' }),
        makeLog({ cardId: 'card-1', reviewedAt: '2024-01-03T00:00:00Z', rating: 'good' }),
        makeLog({ cardId: 'card-1', reviewedAt: '2024-01-04T00:00:00Z', rating: 'easy' }),
      ]],
    ]);
    const items = convertReviewLogsToFSRSItems(logsByCard);
    const lastItem = items[items.length - 1]; // The one with all 4 reviews
    expect(lastItem.reviews.map(r => r.rating)).toEqual([1, 2, 3, 4]);
  });
});

describe('Optimizer Service — serializeFSRSItems', () => {
  it('serializes items to flat arrays', () => {
    const items = [
      { reviews: [{ rating: 1, delta_t: 0 }, { rating: 3, delta_t: 1 }] },
      { reviews: [{ rating: 4, delta_t: 0 }, { rating: 2, delta_t: 5 }, { rating: 3, delta_t: 3 }] },
    ];

    const { ratings, deltats, lengths } = serializeFSRSItems(items);

    expect(Array.from(lengths)).toEqual([2, 3]);
    expect(Array.from(ratings)).toEqual([1, 3, 4, 2, 3]);
    expect(Array.from(deltats)).toEqual([0, 1, 0, 5, 3]);
  });

  it('returns typed arrays', () => {
    const items = [
      { reviews: [{ rating: 3, delta_t: 0 }, { rating: 3, delta_t: 1 }] },
    ];

    const { ratings, deltats, lengths } = serializeFSRSItems(items);

    expect(ratings).toBeInstanceOf(Uint32Array);
    expect(deltats).toBeInstanceOf(Uint32Array);
    expect(lengths).toBeInstanceOf(Uint32Array);
  });

  it('handles empty input', () => {
    const { ratings, deltats, lengths } = serializeFSRSItems([]);
    expect(ratings).toHaveLength(0);
    expect(deltats).toHaveLength(0);
    expect(lengths).toHaveLength(0);
  });
});

describe('Optimizer Service — isOptimizerAvailable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns available: false outside browser', () => {
    // In Node (vitest), window is undefined
    const result = isOptimizerAvailable();
    expect(result.available).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('explains that remote HTTP origins need HTTPS for SharedArrayBuffer', () => {
    vi.stubGlobal('window', {
      isSecureContext: false,
      location: {
        hostname: '172.29.186.40',
        origin: 'http://172.29.186.40:3030',
      },
    });

    const result = isOptimizerAvailable();
    expect(result.available).toBe(false);
    expect(result.reason).toContain('HTTPS');
    expect(result.reason).toContain('iPad/Safari');
  });
});
