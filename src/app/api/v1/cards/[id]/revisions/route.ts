import { listRevisions } from '@/lib/core/cards';
import { route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** GET /api/v1/cards/:id/revisions — every content change (who, when, why, before and after), newest first. */
export const GET = route<{ id: string }>(({ user, params }) => ({ revisions: listRevisions(user.id, params.id) }));
