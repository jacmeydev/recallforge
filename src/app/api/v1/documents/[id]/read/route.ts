import { readDocument } from '@/lib/core/documents';
import { queryParams, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** GET /api/v1/documents/:id/read?fromPart=0&maxChars=15000 — text of consecutive parts. */
export const GET = route<{ id: string }>(({ req, user, params }) =>
  readDocument(user.id, params.id, queryParams(req, ['fromPart', 'maxChars']))
);
