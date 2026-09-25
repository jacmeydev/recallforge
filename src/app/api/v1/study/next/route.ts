import { nextCard } from '@/lib/core/study';
import { queryParams, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** GET /api/v1/study/next?deck=&tag=&mode=normal|exam — next card to ask (question only). */
export const GET = route(({ req, user }) => nextCard(user.id, queryParams(req)));
