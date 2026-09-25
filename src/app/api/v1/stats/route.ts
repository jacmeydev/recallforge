import { getStats } from '@/lib/core/stats';
import { queryParams, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** GET /api/v1/stats?deck=&tag= */
export const GET = route(({ req, user }) => getStats(user.id, queryParams(req)));
