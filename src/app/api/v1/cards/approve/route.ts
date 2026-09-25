import { approveCards } from '@/lib/core/cards';
import { readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** POST /api/v1/cards/approve — { ids? , documentId?, deck? } moves drafts into the study queue. */
export const POST = route(async ({ req, user }) => approveCards(user.id, await readJson(req)));
