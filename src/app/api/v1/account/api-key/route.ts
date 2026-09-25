import { rotateApiKey } from '@/lib/core/users';
import { route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** POST /api/v1/account/api-key — issue a new API key (the old one stops working). Web session only. */
export const POST = route(({ user }) => rotateApiKey(user.id), { sessionOnly: true });
