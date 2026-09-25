import { badRequest } from '@/lib/core/errors';
import { revealCard } from '@/lib/core/study';
import { readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** POST /api/v1/study/reveal — { cardId } → answer, explanation, outcomes per rating, recent attempts. */
export const POST = route(async ({ req, user }) => {
  const { cardId } = await readJson(req);
  if (typeof cardId !== 'string' || !cardId) throw badRequest('cardId is required');
  return revealCard(user.id, cardId);
});
