import { badRequest } from '@/lib/core/errors';
import { gradeCard, nextCard } from '@/lib/core/study';
import { readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/study/grade
 * { cardId, rating: again|hard|good|easy|1-4, answer?, feedback?, durationMs?, deck?, tag? }
 * Reschedules the card and returns the next question for the same deck/tag filter.
 */
export const POST = route(async ({ req, user, via }) => {
  const { cardId, deck, tag, ...grade } = await readJson(req);
  if (typeof cardId !== 'string' || !cardId) throw badRequest('cardId is required');
  const result = gradeCard(user.id, cardId, grade, via === 'session' ? 'web' : 'api');
  return { result, next: nextCard(user.id, { deck, tag }) };
});
