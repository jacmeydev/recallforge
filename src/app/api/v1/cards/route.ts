import { addCards, searchCards } from '@/lib/core/cards';
import { queryParams, readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** GET /api/v1/cards?query=&deck=&tag=&state=&limit=&offset= */
export const GET = route(({ req, user }) => searchCards(user.id, queryParams(req, ['limit', 'offset'])));

/** POST /api/v1/cards — { deck?, cards: [{ front, back, explanation?, source?, tags?, deck? }], allowDuplicates? } */
export const POST = route(async ({ req, user }) => addCards(user.id, await readJson(req)), { status: 201 });
