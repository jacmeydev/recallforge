import { optimizeScheduler } from '@/lib/core/optimizer';
import { readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** POST /api/v1/settings/optimize — { apply?: boolean } fit FSRS to your own review history. */
export const POST = route(async ({ req, user }) => {
  const body = await readJson(req);
  return optimizeScheduler(user.id, { apply: body.apply !== false });
});
