import { getAccount } from '@/lib/core/users';
import { route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** GET /api/v1/account */
export const GET = route(({ user }) => ({ account: getAccount(user.id) }));
