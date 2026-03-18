export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Sync Pull API (server → client)
// ============================================================================
// Returns all records updated since `lastSyncedAt` for the authenticated user.
// Client merges these into local Dexie using last-write-wins on updatedAt.
// Uses raw SQL for dynamic table access.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { sqlite } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';
import { logger } from '@/lib/server/logger';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';
import { repairMissingServerNoteTypes } from '@/lib/server/note-type-repair';
import { toClientRecord, JSON_COLS, BOOL_COLS, SQLITE_TABLE } from '@/lib/sync/transform';

let migrated = false;

// Tables that have updatedAt + deletedAt (support soft-delete sync)
const HAS_UPDATED_AND_DELETED = new Set([
  'decks', 'presets', 'noteTypes', 'notes', 'cards',
  'curriculumPrograms', 'curriculumSubjects', 'curriculumModules', 'curriculumChapters', 'curriculumTopics',
]);

// Tables that have updatedAt but no deletedAt
const HAS_UPDATED_ONLY = new Set(['userGamification', 'notificationPreferences']);

// Tables with only createdAt (append-only)
const CREATED_ONLY = new Set([
  'reviewLogs', 'cardCommands', 'activityEvents', 'dailySummaries', 'personalSummaries',
]);

// Tables with createdAt + deletedAt but no updatedAt
const CREATED_AND_DELETED = new Set([
  'curriculumLinks',
]);

export async function GET(req: NextRequest) {
  const context = getRequestContext(req);
  const requestLogger = logger.withContext({ requestId: context.requestId, route: 'sync/pull' });
  if (!migrated) { runMigrations(); migrated = true; }

  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { user } = authResult;

  // Repair historic imports from pre-noteType sync builds before returning
  // data to the client, so the next pull can hydrate study-ready note types.
  repairMissingServerNoteTypes(user.id);

  const { searchParams } = new URL(req.url);
  const since = searchParams.get('since') || '1970-01-01T00:00:00.000Z';
  const tableFilter = searchParams.get('tables')?.split(',') || Object.keys(SQLITE_TABLE);

  const db = sqlite;
  const changes: Record<string, { upserts: Record<string, unknown>[]; deletes: string[] }> = {};
  const syncTimestamp = new Date().toISOString();

  for (const tableName of tableFilter) {
    const sqliteTable = SQLITE_TABLE[tableName];
    const jsonCols = JSON_COLS[tableName];
    if (!sqliteTable || jsonCols === undefined) continue;

    try {
      let upserts: Record<string, unknown>[] = [];
      let deletes: string[] = [];
      const boolCols = BOOL_COLS[tableName] || [];

      if (HAS_UPDATED_AND_DELETED.has(tableName)) {
        // Get non-deleted records updated since cursor
        const records = db.prepare(
          `SELECT * FROM "${sqliteTable}" WHERE user_id = ? AND updated_at > ? AND deleted_at IS NULL`
        ).all(user.id, since) as Record<string, unknown>[];

        upserts = records.map(r => toClientRecord(r, jsonCols, boolCols));

        // Get soft-deleted records since cursor
        const deleted = db.prepare(
          `SELECT id FROM "${sqliteTable}" WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at > ?`
        ).all(user.id, since) as Array<{ id: string }>;

        deletes = deleted.map(d => d.id);
      } else if (HAS_UPDATED_ONLY.has(tableName)) {
        const records = db.prepare(
          `SELECT * FROM "${sqliteTable}" WHERE user_id = ? AND updated_at > ?`
        ).all(user.id, since) as Record<string, unknown>[];

        upserts = records.map(r => toClientRecord(r, jsonCols, boolCols));
      } else if (CREATED_ONLY.has(tableName)) {
        // Append-only tables: use createdAt / generatedAt / ts as cursor
        let timeCol = 'created_at';
        if (tableName === 'activityEvents') timeCol = 'ts';
        if (tableName === 'dailySummaries' || tableName === 'personalSummaries') timeCol = 'generated_at';

        const records = db.prepare(
          `SELECT * FROM "${sqliteTable}" WHERE user_id = ? AND "${timeCol}" > ?`
        ).all(user.id, since) as Record<string, unknown>[];

        upserts = records.map(r => toClientRecord(r, jsonCols, boolCols));
      } else if (CREATED_AND_DELETED.has(tableName)) {
        // Tables with created_at + deleted_at but no updated_at
        const records = db.prepare(
          `SELECT * FROM "${sqliteTable}" WHERE user_id = ? AND created_at > ? AND deleted_at IS NULL`
        ).all(user.id, since) as Record<string, unknown>[];

        upserts = records.map(r => toClientRecord(r, jsonCols, boolCols));

        const deleted = db.prepare(
          `SELECT id FROM "${sqliteTable}" WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at > ?`
        ).all(user.id, since) as Array<{ id: string }>;

        deletes = deleted.map(d => d.id);
      }

      if (upserts.length > 0 || deletes.length > 0) {
        changes[tableName] = { upserts, deletes };
      }
    } catch (err) {
      console.error(`Sync pull error for ${tableName}:`, err);
    }
  }

  // Update sync_cursors for this user/device
  const deviceId = context.deviceId || req.headers.get('x-device-id') || 'default';
  const cursorId = `${user.id}:${deviceId}`;
  db.prepare(`
    INSERT INTO sync_cursors (id, user_id, device_id, last_synced_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at
  `).run(cursorId, user.id, deviceId, syncTimestamp, syncTimestamp);

  requestLogger.info('Sync pull completed', {
    userId: user.id,
    deviceId,
    since,
    tables: Object.keys(changes),
  });

  return withRequestContext(NextResponse.json({
    changes,
    syncTimestamp,
    serverNow: syncTimestamp,
    userId: user.id,
  }), context);
}
