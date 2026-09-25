import { getProgressMap } from '@/lib/core/progress';
import { queryParams, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** GET /api/v1/progress?days=182 — subject mastery tree, review heatmap and document coverage. */
export const GET = route(({ req, user }) => {
  const { days } = queryParams(req, ['days']);
  return getProgressMap(user.id, { days: typeof days === 'number' ? days : undefined });
});
