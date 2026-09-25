import { deleteDocument, getDocument, updateDocument } from '@/lib/core/documents';
import { readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/** GET /api/v1/documents/:id — metadata and outline (parts with card counts). */
export const GET = route<Params>(({ user, params }) => ({ document: getDocument(user.id, params.id) }));

/** PATCH /api/v1/documents/:id — { title?, deck? } */
export const PATCH = route<Params>(async ({ req, user, params }) => ({
  document: updateDocument(user.id, params.id, await readJson(req)),
}));

/** DELETE /api/v1/documents/:id?deleteCards=true — cards made from it are kept unless deleteCards=true. */
export const DELETE = route<Params>(({ req, user, params }) =>
  deleteDocument(user.id, params.id, new URL(req.url).searchParams.get('deleteCards') === 'true')
);
