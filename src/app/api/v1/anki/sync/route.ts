import { syncWithAnki } from '@/lib/core/anki-sync';
import { readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** POST /api/v1/anki/sync — { deck?, url?, key?, dryRun? } two-way sync with Anki desktop through AnkiConnect. */
export const POST = route(async ({ req, user }) => {
  const body = await readJson(req);
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  return syncWithAnki(user.id, { deck: text(body.deck), url: text(body.url), key: text(body.key), dryRun: body.dryRun === true });
});
