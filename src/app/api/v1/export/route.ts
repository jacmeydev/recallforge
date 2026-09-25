import { NextResponse } from 'next/server';
import { exportUserData } from '@/lib/core/export';
import { route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** GET /api/v1/export — every deck, card (with FSRS state) and review, as a JSON download. */
export const GET = route(({ user }) => {
  const date = new Date().toISOString().slice(0, 10);
  return NextResponse.json(exportUserData(user.id), {
    headers: { 'Content-Disposition': `attachment; filename="recallforge-${date}.json"` },
  });
});
