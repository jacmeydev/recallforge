import { NextResponse } from 'next/server';
import { exportApkg } from '@/lib/core/anki';
import { exportCardsTsv, exportUserData } from '@/lib/core/export';
import { route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/export — full JSON backup (subjects, documents, cards with FSRS state, reviews, edit history).
 * GET /api/v1/export?format=tsv&deck= — cards as tab-separated text that Anki and spreadsheets import.
 * GET /api/v1/export?format=apkg&deck= — an Anki package (cloze, images, scheduling) for Anki, AnkiDroid and AnkiMobile.
 */
export const GET = route(async ({ req, user }) => {
  const url = new URL(req.url);
  const date = new Date().toISOString().slice(0, 10);
  if (url.searchParams.get('format') === 'apkg') {
    const data = await exportApkg(user.id, { deck: url.searchParams.get('deck') || undefined });
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="recallforge-${date}.apkg"` },
    });
  }
  if (url.searchParams.get('format') === 'tsv') {
    return new Response(exportCardsTsv(user.id, url.searchParams.get('deck') || undefined), {
      headers: {
        'Content-Type': 'text/tab-separated-values; charset=utf-8',
        'Content-Disposition': `attachment; filename="recallforge-${date}.txt"`,
      },
    });
  }
  return NextResponse.json(exportUserData(user.id), {
    headers: { 'Content-Disposition': `attachment; filename="recallforge-${date}.json"` },
  });
});
