import { getSettings, updateSettings } from '@/lib/core/settings';
import { readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** GET /api/v1/settings */
export const GET = route(({ user }) => ({ settings: getSettings(user.id) }));

/** PATCH /api/v1/settings — any subset of the settings fields. */
export const PATCH = route(async ({ req, user }) => ({ settings: updateSettings(user.id, await readJson(req)) }));
