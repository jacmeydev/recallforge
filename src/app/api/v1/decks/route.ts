import { createDeck, listDecks } from '@/lib/core/decks';
import { readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** GET /api/v1/decks — decks with card and due counts. */
export const GET = route(({ user }) => ({ decks: listDecks(user.id) }));

/** POST /api/v1/decks — { name, description? } */
export const POST = route(async ({ req, user }) => ({ deck: createDeck(user.id, await readJson(req)) }), { status: 201 });
