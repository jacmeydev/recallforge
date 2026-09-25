import { undoLastReview } from '@/lib/core/study';
import { readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** POST /api/v1/study/undo — { cardId? } restores the card as it was before its last review. */
export const POST = route(async ({ req, user }) => {
  const { cardId } = await readJson(req);
  return undoLastReview(user.id, typeof cardId === 'string' && cardId ? cardId : undefined);
});
