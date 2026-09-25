import { badRequest } from '@/lib/core/errors';
import { correctLastReview } from '@/lib/core/study';
import { readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/study/correct — { cardId, rating, reason? }
 * "My answer was right": replaces the rating of the card's last review and reschedules it as if graded that way.
 */
export const POST = route(async ({ req, user }) => {
  const { cardId, ...input } = await readJson(req);
  if (typeof cardId !== 'string' || !cardId) throw badRequest('cardId is required');
  return { result: correctLastReview(user.id, cardId, input) };
});
