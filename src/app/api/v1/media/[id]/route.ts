import { getMedia } from '@/lib/core/media';
import { route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** GET /api/v1/media/:id — the image itself (cached: media never changes). */
export const GET = route<{ id: string }>(({ user, params }) => {
  const media = getMedia(user.id, params.id);
  return new Response(new Uint8Array(media.data), {
    headers: {
      'Content-Type': media.mimeType,
      'Cache-Control': 'private, max-age=31536000, immutable',
      // SVGs could carry scripts: never let them run.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
