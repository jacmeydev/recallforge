export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Agent API: Summaries
// ============================================================================
// GET /api/agent/summaries?type=daily|personal&since=ISO&limit=30
// Returns daily/personal summaries for agent consumption.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { sqlite } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';

let migrated = false;
function ensureMigrated() { if (!migrated) { runMigrations(); migrated = true; } }

export async function GET(req: NextRequest) {
  ensureMigrated();

  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { user } = authResult;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'daily'; // daily | personal
  const since = searchParams.get('since') || '1970-01-01T00:00:00.000Z';
  const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10), 365);
  const format = searchParams.get('format') || 'json';

  if (type === 'personal') {
    const rows = sqlite.prepare(`
      SELECT * FROM personal_summaries
      WHERE user_id = ? AND generated_at > ?
      ORDER BY generated_at DESC LIMIT ?
    `).all(user.id, since, limit) as Record<string, unknown>[];

    const parsed = rows.map(r => ({
      ...r,
      subjectsAdvanced: parseJsonCol(r.subjects_advanced),
      subjectsAbandoned: parseJsonCol(r.subjects_abandoned),
      chaptersConsolidated: parseJsonCol(r.chapters_consolidated),
      topMasteryGains: parseJsonCol(r.top_mastery_gains),
    }));

    return formatResponse(parsed, format, user.id);
  }

  // Default: daily summaries
  const rows = sqlite.prepare(`
    SELECT * FROM daily_summaries
    WHERE user_id = ? AND generated_at > ?
    ORDER BY date DESC LIMIT ?
  `).all(user.id, since, limit) as Record<string, unknown>[];

  const parsed = rows.map(r => ({
    ...r,
    metrics: parseJsonCol(r.metrics),
  }));

  return formatResponse(parsed, format, user.id);
}

function parseJsonCol(val: unknown): unknown {
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

function formatResponse(data: Record<string, unknown>[], format: string, userId: string) {
  if (format === 'ndjson') {
    const ndjson = data.map(d => JSON.stringify(d)).join('\n');
    return new NextResponse(ndjson, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-Total-Count': String(data.length),
      },
    });
  }

  return NextResponse.json({
    summaries: data,
    count: data.length,
    userId,
  });
}
