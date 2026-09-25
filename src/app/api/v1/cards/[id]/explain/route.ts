import { explainCard } from '@/lib/core/explain';
import { route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** GET /api/v1/cards/:id/explain — card, exact source excerpt and context, recent attempts and related cards. */
export const GET = route<{ id: string }>(({ user, params }) => explainCard(user.id, params.id));
