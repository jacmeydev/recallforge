import { deleteDeck, listDecks, resolveDeck, updateDeck } from '@/lib/core/decks';
import { decodeParam, readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/** GET /api/v1/decks/:idOrName */
export const GET = route<Params>(({ user, params }) => {
  const deck = resolveDeck(user.id, decodeParam(params.id));
  return { deck: listDecks(user.id).find((d) => d.id === deck.id) };
});

/** PATCH /api/v1/decks/:idOrName — { name?, description? } */
export const PATCH = route<Params>(async ({ req, user, params }) => ({
  deck: updateDeck(user.id, decodeParam(params.id), await readJson(req)),
}));

/** DELETE /api/v1/decks/:idOrName — deletes the deck and all its cards. */
export const DELETE = route<Params>(({ user, params }) => deleteDeck(user.id, decodeParam(params.id)));
