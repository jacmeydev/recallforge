import { badRequest } from '@/lib/core/errors';
import { importDocumentFile, importDocumentText, listDocuments } from '@/lib/core/documents';
import { MAX_FILE_BYTES } from '@/lib/core/extract';
import { queryParams, readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** GET /api/v1/documents?deck= — uploaded study material with card coverage. */
export const GET = route(({ req, user }) => {
  const { deck } = queryParams(req);
  return { documents: listDocuments(user.id, typeof deck === 'string' ? deck : undefined) };
});

/**
 * POST /api/v1/documents
 * - multipart/form-data: file (PDF, DOCX, PPTX, TXT, MD, HTML, CSV), title?, deck?
 * - application/json: { title, text, deck? } for text an agent already extracted
 */
export const POST = route(
  async ({ req, user }) => {
    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) throw badRequest('Send the document in a "file" field');
      if (file.size > MAX_FILE_BYTES) throw badRequest('The file is larger than 30 MB');
      const text = (key: string) => {
        const value = form.get(key);
        return typeof value === 'string' && value.trim() ? value : undefined;
      };
      const document = await importDocumentFile(
        user.id,
        { filename: file.name, data: new Uint8Array(await file.arrayBuffer()) },
        { title: text('title'), deck: text('deck') }
      );
      return { document };
    }
    return { document: importDocumentText(user.id, await readJson(req)) };
  },
  { status: 201 }
);
