import { badRequest } from '@/lib/core/errors';
import { importData } from '@/lib/core/import';
import { route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/import — multipart (file, deck?, draft?) or raw body (JSON export, CSV or TSV; ?deck=&draft=true).
 * A RecallForge export is merged (existing ids are kept); CSV/TSV lines become new cards.
 */
export const POST = route(async ({ req, user }) => {
  const url = new URL(req.url);
  if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof Blob)) throw badRequest('Send the file in the "file" field');
    const deck = form.get('deck');
    return importData(user.id, await file.text(), {
      deck: typeof deck === 'string' && deck.trim() ? deck : undefined,
      draft: form.get('draft') === 'true',
    });
  }
  return importData(user.id, await req.text(), {
    deck: url.searchParams.get('deck') || undefined,
    draft: url.searchParams.get('draft') === 'true',
  });
});
