import { NextResponse } from 'next/server';
import { exportCardsTsv, exportUserData } from '@/lib/core/export';
import { route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/export — full JSON backup (subjects, documents, cards with FSRS state, reviews, edit history).
 * GET /api/v1/export?format=tsv&deck= — cards as tab-separated text that Anki and spreadsheets import.
 */
export const GET = route(({ req, user }) => {
  const url = new URL(req.url);
  const date = new Date().toISOString().slice(0, 10);
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
