import { badRequest } from '@/lib/core/errors';
import { saveMedia } from '@/lib/core/media';
import { readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/media — multipart { file } or JSON { filename, contentBase64 }.
 * Returns { media: { id, markdown } }: put `markdown` in a card to show the image.
 */
export const POST = route(
  async ({ req, user }) => {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) throw badRequest('Send the image in the "file" field');
      return { media: saveMedia(user.id, { filename: file.name, data: new Uint8Array(await file.arrayBuffer()), mimeType: file.type }) };
    }
    const { filename, contentBase64 } = await readJson(req);
    if (typeof filename !== 'string' || typeof contentBase64 !== 'string') throw badRequest('filename and contentBase64 are required');
    return { media: saveMedia(user.id, { filename, data: new Uint8Array(Buffer.from(contentBase64, 'base64')) }) };
  },
  { status: 201 }
);
