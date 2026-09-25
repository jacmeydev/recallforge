import { deleteCards, getCard, updateCard } from '@/lib/core/cards';
import { notFound } from '@/lib/core/errors';
import { readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/** GET /api/v1/cards/:id — full card, including the answer. */
export const GET = route<Params>(({ user, params }) => ({ card: getCard(user.id, params.id) }));

/** PATCH /api/v1/cards/:id — { front?, back?, explanation?, source?, tags?, deck?, suspended? } */
export const PATCH = route<Params>(async ({ req, user, params }) => ({
  card: updateCard(user.id, params.id, await readJson(req)),
}));

/** DELETE /api/v1/cards/:id */
export const DELETE = route<Params>(({ user, params }) => {
  const result = deleteCards(user.id, [params.id]);
  if (result.deleted.length === 0) throw notFound('Card', params.id);
  return { deleted: params.id };
});
