export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Sync Push API (client → server)
// ============================================================================
// Receives syncQueue items from the client and applies them to the server DB.
// Each operation is idempotent (upsert for create/update, soft-delete for delete).
// Uses raw SQL for dynamic table access to avoid Drizzle type narrowing issues.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { sqlite } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';
import { logger } from '@/lib/server/logger';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';
import { repairMissingServerNoteTypes } from '@/lib/server/note-type-repair';
import { computeEffectiveReviewTiming, replayCardsForUser } from '@/lib/server/review-replay';
import {
  toServerRecord,
  JSON_COLS,
  SQLITE_TABLE,
} from '@/lib/sync/transform';

let migrated = false;

const LWW_TABLES = new Set([
  'decks',
  'presets',
  'noteTypes',
  'notes',
  'cards',
  'curriculumPrograms',
  'curriculumSubjects',
  'curriculumModules',
  'curriculumChapters',
  'curriculumTopics',
  'curriculumLinks',
  'notificationPreferences',
  'userGamification',
]);

const APPEND_ONLY_TABLES = new Set(['reviewLogs', 'cardCommands', 'activityEvents']);

const CARD_DERIVED_FIELDS = new Set([
  'dueAt',
  'state',
  'stability',
  'difficulty',
  'retrievability',
  'elapsedDays',
  'scheduledDays',
  'reps',
  'lapses',
  'learningSteps',
  'lastReviewAt',
  'updatedAt',
]);

function sanitizeCardUpdateData(
  data: Record<string, unknown>,
  shouldStripDerivedFields: boolean
): Record<string, unknown> {
  if (!shouldStripDerivedFields) return data;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!CARD_DERIVED_FIELDS.has(key)) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ─── POST handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const context = getRequestContext(req);
  const requestLogger = logger.withContext({ requestId: context.requestId, route: 'sync/push' });
  if (!migrated) { runMigrations(); migrated = true; }

  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { user } = authResult;

  try {
    const body = await req.json();
    const { operations } = body as {
      operations: Array<{
        operationId?: string;
        deviceId?: string;
        clientUpdatedAt?: string;
        table: string;
        operation: 'create' | 'update' | 'delete';
        recordId: string;
        data: Record<string, unknown>;
      }>;
    };

    if (!Array.isArray(operations)) {
      return withRequestContext(NextResponse.json({ error: 'operations array required' }, { status: 400 }), context);
    }

    if (operations.length > 500) {
      return withRequestContext(NextResponse.json({ error: 'Maximum 500 operations per request' }, { status: 400 }), context);
    }

    const db = sqlite;
    const results: Array<{ recordId: string; status: 'ok' | 'error'; error?: string; duplicate?: boolean }> = [];
    const replayCardIds = new Set<string>();
    const cardsWithReviewsInBatch = new Set(
      operations
        .filter((op) => op.table === 'reviewLogs' && op.operation !== 'delete')
        .map((op) => (typeof op.data.cardId === 'string' ? op.data.cardId : ''))
        .filter((cardId) => cardId.length > 0)
    );

    for (const op of operations) {
      try {
        if ((op.table === 'reviewLogs' || op.table === 'cardCommands') && op.operation !== 'delete' && typeof op.data.cardId === 'string') {
          replayCardIds.add(op.data.cardId);
        }

        const operationId = op.operationId || `${user.id}:${op.table}:${op.recordId}:${op.operation}`;
        const deviceId = op.deviceId || context.deviceId || req.headers.get('x-device-id') || 'default';
        const clientUpdatedAt =
          op.clientUpdatedAt ||
          (typeof op.data.updatedAt === 'string' ? op.data.updatedAt : undefined) ||
          new Date().toISOString();

        const duplicateOperation = db.prepare(`
          SELECT id FROM sync_operations WHERE id = ? AND user_id = ? LIMIT 1
        `).get(operationId, user.id) as { id: string } | undefined;

        if (duplicateOperation) {
          results.push({ recordId: op.recordId, status: 'ok', duplicate: true });
          continue;
        }

        const sqliteTable = SQLITE_TABLE[op.table];
        const jsonCols = JSON_COLS[op.table];
        if (!sqliteTable || jsonCols === undefined) {
          results.push({ recordId: op.recordId, status: 'error', error: `Unknown table: ${op.table}` });
          continue;
        }

        if (APPEND_ONLY_TABLES.has(op.table) && op.operation === 'delete') {
          results.push({ recordId: op.recordId, status: 'error', error: `Delete is not allowed for append-only table ${op.table}` });
          continue;
        }

        if (op.operation === 'delete') {
          const deletedAt = new Date().toISOString();

          // Wrap cascade in transaction for atomicity
          db.transaction(() => {
            // Soft delete the record itself
            db.prepare(
              `UPDATE "${sqliteTable}" SET deleted_at = ? WHERE id = ? AND user_id = ?`
            ).run(deletedAt, op.recordId, user.id);

            // Cascade: when deleting a deck, also soft-delete its notes and cards
            if (op.table === 'decks') {
              const childNotes = db.prepare(
                `SELECT id FROM notes WHERE deck_id = ? AND user_id = ? AND deleted_at IS NULL`
              ).all(op.recordId, user.id) as Array<{ id: string }>;

              for (const note of childNotes) {
                db.prepare(
                  `UPDATE cards SET deleted_at = ? WHERE note_id = ? AND user_id = ? AND deleted_at IS NULL`
                ).run(deletedAt, note.id, user.id);
              }
              db.prepare(
                `UPDATE notes SET deleted_at = ? WHERE deck_id = ? AND user_id = ? AND deleted_at IS NULL`
              ).run(deletedAt, op.recordId, user.id);
            }

            // Cascade: when deleting a note, also soft-delete its cards
            if (op.table === 'notes') {
              db.prepare(
                `UPDATE cards SET deleted_at = ? WHERE note_id = ? AND user_id = ? AND deleted_at IS NULL`
              ).run(deletedAt, op.recordId, user.id);
            }

            db.prepare(`
              INSERT INTO sync_operations (id, user_id, device_id, table_name, operation, record_id, client_updated_at, received_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(operationId, user.id, deviceId, op.table, op.operation, op.recordId, clientUpdatedAt, deletedAt);
          })();

          results.push({ recordId: op.recordId, status: 'ok' });
        } else {
          if (APPEND_ONLY_TABLES.has(op.table)) {
            if (op.table === 'cardCommands' && op.operation !== 'create') {
              results.push({
                recordId: op.recordId,
                status: 'error',
                error: 'cardCommands only supports create operations',
              });
              continue;
            }

            const serverRecord = toServerRecord(op.data, user.id, jsonCols);
            serverRecord.id = op.recordId;
            serverRecord.user_id = user.id;
            if (op.table === 'reviewLogs') {
              const reviewCardId = typeof op.data.cardId === 'string' ? op.data.cardId : null;
              const normalizedTiming = computeEffectiveReviewTiming({
                clientReviewedAt: typeof op.data.clientReviewedAt === 'string'
                  ? op.data.clientReviewedAt
                  : typeof op.data.reviewedAt === 'string'
                    ? op.data.reviewedAt
                    : null,
                clockOffsetMs: typeof op.data.clockOffsetMs === 'number' ? op.data.clockOffsetMs : null,
                offsetMeasuredAt: typeof op.data.offsetMeasuredAt === 'string' ? op.data.offsetMeasuredAt : null,
                serverReceivedAt: new Date().toISOString(),
              });

              serverRecord.device_id = op.data.deviceId ?? deviceId;
              serverRecord.client_reviewed_at = normalizedTiming.clientReviewedAt;
              serverRecord.server_received_at = normalizedTiming.serverReceivedAt;
              serverRecord.effective_reviewed_at = normalizedTiming.effectiveReviewedAt;
              serverRecord.reviewed_at = normalizedTiming.reviewedAt;
              serverRecord.offset_measured_at = op.data.offsetMeasuredAt ?? null;
              serverRecord.time_source = normalizedTiming.timeSource;
              serverRecord.created_at =
                typeof op.data.createdAt === 'string'
                  ? op.data.createdAt
                  : normalizedTiming.serverReceivedAt;
              serverRecord.clock_offset_ms =
                typeof op.data.clockOffsetMs === 'number' ? op.data.clockOffsetMs : null;
              if (serverRecord.scheduler_context == null) {
                serverRecord.scheduler_context = JSON.stringify(op.data.schedulerContext ?? {});
              }

              if (reviewCardId) {
                const latest = db.prepare(`
                  SELECT COALESCE(effective_reviewed_at, server_received_at, client_reviewed_at, reviewed_at, created_at) AS effective_ts
                  FROM review_logs
                  WHERE user_id = ? AND card_id = ?
                  ORDER BY effective_ts DESC, id DESC
                  LIMIT 1
                `).get(user.id, reviewCardId) as { effective_ts: string | null } | undefined;

                if (normalizedTiming.clockCorrected) {
                  requestLogger.warn('Clock-corrected review log received', {
                    userId: user.id,
                    deviceId,
                    operationId,
                    cardId: reviewCardId,
                    reviewLogId: op.recordId,
                    clientReviewedAt: normalizedTiming.clientReviewedAt,
                    serverReceivedAt: normalizedTiming.serverReceivedAt,
                  });
                }

                if (latest?.effective_ts && latest.effective_ts > normalizedTiming.effectiveReviewedAt) {
                  requestLogger.warn('Out-of-order review log received', {
                    userId: user.id,
                    deviceId,
                    operationId,
                    cardId: reviewCardId,
                    reviewLogId: op.recordId,
                    previousEffectiveReviewedAt: latest.effective_ts,
                    nextEffectiveReviewedAt: normalizedTiming.effectiveReviewedAt,
                  });
                }
              }
            } else if (op.table === 'cardCommands') {
              const commandCardId = typeof op.data.cardId === 'string' ? op.data.cardId : null;
              const normalizedTiming = computeEffectiveReviewTiming({
                clientReviewedAt: typeof op.data.clientIssuedAt === 'string'
                  ? op.data.clientIssuedAt
                  : typeof op.data.effectiveAt === 'string'
                    ? op.data.effectiveAt
                    : clientUpdatedAt,
                clockOffsetMs: typeof op.data.clockOffsetMs === 'number' ? op.data.clockOffsetMs : null,
                offsetMeasuredAt: typeof op.data.offsetMeasuredAt === 'string' ? op.data.offsetMeasuredAt : null,
                serverReceivedAt: new Date().toISOString(),
              });

              serverRecord.device_id = op.data.deviceId ?? deviceId;
              serverRecord.client_issued_at = normalizedTiming.clientReviewedAt;
              serverRecord.server_received_at = normalizedTiming.serverReceivedAt;
              serverRecord.effective_at = normalizedTiming.effectiveReviewedAt;
              serverRecord.offset_measured_at = op.data.offsetMeasuredAt ?? null;
              serverRecord.time_source = normalizedTiming.timeSource;
              serverRecord.created_at =
                typeof op.data.createdAt === 'string'
                  ? op.data.createdAt
                  : normalizedTiming.serverReceivedAt;
              serverRecord.clock_offset_ms =
                typeof op.data.clockOffsetMs === 'number' ? op.data.clockOffsetMs : null;

              if (commandCardId) {
                const latest = db.prepare(`
                  SELECT COALESCE(effective_at, server_received_at, client_issued_at, created_at) AS effective_ts
                  FROM card_commands
                  WHERE user_id = ? AND card_id = ?
                  ORDER BY effective_ts DESC, id DESC
                  LIMIT 1
                `).get(user.id, commandCardId) as { effective_ts: string | null } | undefined;

                if (normalizedTiming.clockCorrected) {
                  requestLogger.warn('Clock-corrected card command received', {
                    userId: user.id,
                    deviceId,
                    operationId,
                    cardId: commandCardId,
                    commandId: op.recordId,
                    command: op.data.command,
                    clientIssuedAt: normalizedTiming.clientReviewedAt,
                    serverReceivedAt: normalizedTiming.serverReceivedAt,
                  });
                }

                if (latest?.effective_ts && latest.effective_ts > normalizedTiming.effectiveReviewedAt) {
                  requestLogger.warn('Out-of-order card command received', {
                    userId: user.id,
                    deviceId,
                    operationId,
                    cardId: commandCardId,
                    commandId: op.recordId,
                    command: op.data.command,
                    previousEffectiveAt: latest.effective_ts,
                    nextEffectiveAt: normalizedTiming.effectiveReviewedAt,
                  });
                }
              }
            }

            const cols = Object.keys(serverRecord).map((key) => `"${key}"`).join(', ');
            const placeholders = Object.keys(serverRecord).map(() => '?').join(', ');
            const values = Object.values(serverRecord).map((value) => value === undefined ? null : typeof value === 'boolean' ? (value ? 1 : 0) : value);

            let inserted = false;
            db.transaction(() => {
              const insertResult = db.prepare(`INSERT OR IGNORE INTO "${sqliteTable}" (${cols}) VALUES (${placeholders})`).run(...values);
              inserted = insertResult.changes > 0;
              db.prepare(`
                INSERT INTO sync_operations (id, user_id, device_id, table_name, operation, record_id, client_updated_at, received_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              `).run(operationId, user.id, deviceId, op.table, op.operation, op.recordId, clientUpdatedAt, new Date().toISOString());
            })();

            results.push({ recordId: op.recordId, status: 'ok', duplicate: !inserted });
            continue;
          }

          // Create or update — idempotent upsert
          const cardUpdatePairedWithReview =
            op.table === 'cards' &&
            op.operation === 'update' &&
            cardsWithReviewsInBatch.has(op.recordId);
          const sanitizedData = sanitizeCardUpdateData(op.data, cardUpdatePairedWithReview);
          const serverRecord = toServerRecord(sanitizedData, user.id, jsonCols);
          serverRecord['id'] = op.recordId;
          // Always enforce ownership
          serverRecord['user_id'] = user.id;

          // Validate column names to prevent SQL injection via crafted keys
          const validColName = /^[a-z_][a-z0-9_]*$/i;
          const entries = Object.entries(serverRecord).filter(([k]) => k !== 'id');
          const invalidCols = entries.filter(([k]) => !validColName.test(k));
          if (invalidCols.length > 0) {
            results.push({ recordId: op.recordId, status: 'error', error: `Invalid column names: ${invalidCols.map(([k]) => k).join(', ')}` });
            continue;
          }

          const existing = db.prepare(
            `SELECT id, updated_at, deleted_at FROM "${sqliteTable}" WHERE id = ? AND user_id = ? LIMIT 1`
          ).get(op.recordId, user.id) as { id: string; updated_at?: string | null; deleted_at?: string | null } | undefined;

          if (existing?.deleted_at) {
            results.push({
              recordId: op.recordId,
              status: 'error',
              error: `Conflict: ${op.table}/${op.recordId} is tombstoned and requires explicit undelete`,
            });
            continue;
          }

          if (existing && LWW_TABLES.has(op.table) && existing.updated_at && clientUpdatedAt < existing.updated_at) {
            results.push({
              recordId: op.recordId,
              status: 'error',
              error: `Conflict: stale update for ${op.table}/${op.recordId}`,
            });
            continue;
          }

          db.transaction(() => {
            if (existing && entries.length > 0) {
              const setClauses = entries.map(([k]) => `"${k}" = ?`).join(', ');
              const values = entries.map(([, v]) => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
              db.prepare(
                `UPDATE "${sqliteTable}" SET ${setClauses} WHERE id = ? AND user_id = ?`
              ).run(...values, op.recordId, user.id);
            } else {
              if (!existing) {
                const cols = Object.keys(serverRecord).map(k => `"${k}"`).join(', ');
                const placeholders = Object.keys(serverRecord).map(() => '?').join(', ');
                const values = Object.values(serverRecord).map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
                db.prepare(
                  `INSERT INTO "${sqliteTable}" (${cols}) VALUES (${placeholders})`
                ).run(...values);
              }
            }

            db.prepare(`
              INSERT INTO sync_operations (id, user_id, device_id, table_name, operation, record_id, client_updated_at, received_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(operationId, user.id, deviceId, op.table, op.operation, op.recordId, clientUpdatedAt, new Date().toISOString());
          })();

          results.push({ recordId: op.recordId, status: 'ok' });
        }
      } catch (err) {
        results.push({
          recordId: op.recordId,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const processed = results.filter(r => r.status === 'ok').length;
    const failed = results.filter(r => r.status === 'error').length;

    const repairedNoteTypes = repairMissingServerNoteTypes(user.id);

    const replaySummary = replayCardIds.size > 0
      ? replayCardsForUser(user.id, replayCardIds)
      : { replayedCards: 0, replayedLogs: 0 };

    // Update sync_cursors for this user/device
    if (processed > 0) {
      const deviceId = context.deviceId || req.headers.get('x-device-id') || 'default';
      const cursorId = `${user.id}:${deviceId}`;
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO sync_cursors (id, user_id, device_id, last_synced_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at
      `).run(cursorId, user.id, deviceId, now, now);
    }

    requestLogger.info('Sync push completed', {
      userId: user.id,
      deviceId: context.deviceId,
      processed,
      failed,
      operationCount: operations.length,
      replayedCards: replaySummary.replayedCards,
      replayedLogs: replaySummary.replayedLogs,
    });

    return withRequestContext(NextResponse.json({
      processed,
      failed,
      results,
      repairedNoteTypes,
      replay: replaySummary,
      serverNow: new Date().toISOString(),
    }), context);
  } catch (err) {
    requestLogger.error('Sync push error', { error: err instanceof Error ? err.message : 'Unknown' });
    return withRequestContext(
      NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
      context
    );
  }
}
