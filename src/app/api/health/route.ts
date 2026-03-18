export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Health Check API
// ============================================================================
// GET /api/health — Returns service status, DB connectivity, uptime.
// Unprotected endpoint for monitoring and load balancers.
// ============================================================================

import { NextResponse } from 'next/server';
import { sqlite } from '@/lib/server/db';
import { getSchemaStatus, runMigrations } from '@/lib/server/db/migrate';
import { getObservabilitySnapshot, recordRouteObservation } from '@/lib/server/observability';

let migrated = false;
const startedAt = Date.now();

export async function GET() {
  const requestStartedAt = Date.now();
  if (!migrated) { runMigrations(); migrated = true; }

  let dbStatus: 'ok' | 'error' = 'error';
  let dbSizeBytes = 0;
  let userCount = 0;

  try {
    // Quick DB connectivity check
    const row = sqlite.prepare('SELECT 1 as ok').get() as { ok: number } | undefined;
    if (row?.ok === 1) dbStatus = 'ok';

    // DB stats
    const pageCount = sqlite.pragma('page_count') as Array<{ page_count: number }>;
    const pageSize = sqlite.pragma('page_size') as Array<{ page_size: number }>;
    dbSizeBytes = (pageCount[0]?.page_count || 0) * (pageSize[0]?.page_size || 0);

    const usersRow = sqlite.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number } | undefined;
    userCount = usersRow?.count || 0;
  } catch {
    // DB not ready yet — that's ok for health check
  }

  const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
  const schema = getSchemaStatus(sqlite);
  const observability = getObservabilitySnapshot();
  const response = NextResponse.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    service: 'recallforge',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: uptimeSeconds,
    db: {
      status: dbStatus,
      sizeBytes: dbSizeBytes,
      users: userCount,
    },
    schema,
    observability,
    env: process.env.NODE_ENV || 'development',
  });

  recordRouteObservation({
    route: 'health',
    method: 'GET',
    status: response.status,
    durationMs: Date.now() - requestStartedAt,
  });

  return response;
}
