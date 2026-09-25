import { resetCard } from '@/lib/core/study';
import { route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** POST /api/v1/cards/:id/reset — forget the card's progress (history is kept). */
export const POST = route<{ id: string }>(({ user, params }) => ({ card: resetCard(user.id, params.id) }));
