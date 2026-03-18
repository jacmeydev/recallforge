export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Sync Status API
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { serverDb } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';
import * as schema from '@/lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

let migrated = false;

export async function GET(req: NextRequest) {
  if (!migrated) { runMigrations(); migrated = true; }

  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { user } = authResult;

  // Count records per table
  const counts: Record<string, number> = {};

  const tablesToCount = [
    { name: 'decks', table: schema.decks },
    { name: 'notes', table: schema.notes },
    { name: 'cards', table: schema.cards },
    { name: 'reviewLogs', table: schema.reviewLogs },
    { name: 'activityEvents', table: schema.activityEvents },
  ];

  for (const { name, table } of tablesToCount) {
    const [result] = await serverDb
      .select({ count: sql<number>`count(*)` })
      .from(table)
      .where(eq((table as typeof schema.decks).userId, user.id));
    counts[name] = result?.count ?? 0;
  }

  // Get sync cursor for this user
  const cursors = await serverDb
    .select()
    .from(schema.syncCursors)
    .where(eq(schema.syncCursors.userId, user.id));

  return NextResponse.json({
    userId: user.id,
    serverCounts: counts,
    syncCursors: cursors.map(c => ({
      deviceId: c.deviceId,
      lastSyncedAt: c.lastSyncedAt,
    })),
    serverTime: new Date().toISOString(),
  });
}
