export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Agent API: Activity Events
// ============================================================================
// GET  /api/agent/events?since=ISO&limit=100&type=card_reviewed
// POST /api/agent/events  (ingest events from agents)
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { sqlite } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';
import { logger } from '@/lib/server/logger';

let migrated = false;
function ensureMigrated() { if (!migrated) { runMigrations(); migrated = true; } }

export async function GET(req: NextRequest) {
  ensureMigrated();

  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { user } = authResult;

  const { searchParams } = new URL(req.url);
  const since = searchParams.get('since') || '1970-01-01T00:00:00.000Z';
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 1000);
  const type = searchParams.get('type'); // optional filter
  const format = searchParams.get('format') || 'json'; // json or ndjson

  let query = `SELECT * FROM activity_events WHERE user_id = ? AND ts > ?`;
  const params: unknown[] = [user.id, since];

  if (type) {
    // Support prefix-based filtering: if type ends with '_', use LIKE for prefix match
    if (type.endsWith('_')) {
      query += ` AND type LIKE ?`;
      params.push(type + '%');
    } else {
      query += ` AND type = ?`;
      params.push(type);
    }
  }

  query += ` ORDER BY ts DESC LIMIT ?`;
  params.push(limit);

  const events = sqlite.prepare(query).all(...params) as Record<string, unknown>[];

  // Parse JSON payload
  const parsed = events.map(e => ({
    ...e,
    payload: typeof e.payload === 'string' ? JSON.parse(e.payload as string) : e.payload,
  }));

  if (format === 'ndjson') {
    const ndjson = parsed.map(e => JSON.stringify(e)).join('\n');
    return new NextResponse(ndjson, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-Total-Count': String(parsed.length),
      },
    });
  }

  return NextResponse.json({
    events: parsed,
    count: parsed.length,
    userId: user.id,
  });
}

export async function POST(req: NextRequest) {
  ensureMigrated();

  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { user } = authResult;

  const body = await req.json();
  const { events } = body as {
    events: Array<{
      id: string;
      ts: string;
      type: string;
      entityType: string;
      entityId: string;
      sessionId?: string;
      source?: string;
      payload?: Record<string, unknown>;
    }>;
  };

  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: 'events array required' }, { status: 400 });
  }

  if (events.length > 500) {
    return NextResponse.json({ error: 'Maximum 500 events per request' }, { status: 400 });
  }

  // Validate each event has required fields
  for (const event of events) {
    if (!event.id || !event.ts || !event.type || !event.entityType || !event.entityId) {
      return NextResponse.json(
        { error: 'Each event must have id, ts, type, entityType, and entityId' },
        { status: 400 }
      );
    }
  }

  const stmt = sqlite.prepare(`
    INSERT OR IGNORE INTO activity_events (id, user_id, ts, type, entity_type, entity_id, session_id, source, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  for (const event of events) {
    try {
      stmt.run(
        event.id, user.id, event.ts, event.type, event.entityType, event.entityId,
        event.sessionId || null, event.source || 'agent',
        JSON.stringify(event.payload || {})
      );
      inserted++;
    } catch {
      // Ignore duplicates (INSERT OR IGNORE)
    }
  }

  return NextResponse.json({ inserted, total: events.length });
}

