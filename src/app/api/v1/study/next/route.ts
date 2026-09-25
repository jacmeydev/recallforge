import { nextCard } from '@/lib/core/study';
import { queryParams, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/study/next?deck=&tag=&mode=normal|exam|quick&format=recall|typing|multiple_choice|true_false
 * Next card to ask (question only, plus choices or a statement for the practice formats).
 */
export const GET = route(({ req, user }) => nextCard(user.id, queryParams(req)));
