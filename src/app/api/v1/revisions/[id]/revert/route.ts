import { revertRevision } from '@/lib/core/cards';
import { route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** POST /api/v1/revisions/:id/revert — restore the card content from before that change (recorded as a new revision). */
export const POST = route<{ id: string }>(({ user, params }) => ({ card: revertRevision(user.id, params.id) }));
