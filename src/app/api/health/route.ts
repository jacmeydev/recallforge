import { NextResponse } from 'next/server';
import { getDb } from '@/lib/core/db';

export const dynamic = 'force-dynamic';

const startedAt = Date.now();

/** GET /api/health — unauthenticated liveness + database check. */
export function GET() {
  let database: 'ok' | 'error' = 'error';
  try {
    database = (getDb().prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1 ? 'ok' : 'error';
  } catch {
    database = 'error';
  }
  return NextResponse.json(
    {
      status: database === 'ok' ? 'ok' : 'degraded',
      service: 'recallforge',
      version: '2.0.0',
      database,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    },
    { status: database === 'ok' ? 200 : 503 }
  );
}
