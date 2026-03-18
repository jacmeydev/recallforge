// ============================================================================
// RecallForge — Sync Service (Local-first)
// ============================================================================
// Connects local Dexie syncQueue to the real backend.
// Push: batches pending syncQueue items → POST /api/sync/push
// Pull: fetches changes since last sync → GET /api/sync/pull → merges into Dexie
// ============================================================================

import { db } from '@/lib/db';
import { EventEmitters } from '@/lib/events';
import { captureServerClock } from '@/lib/sync/clock';
import { getClientDeviceId } from '@/lib/sync/device';
import type { SyncQueueItem } from '@/types';

const SYNC_PUSH_URL = '/api/sync/push';
const SYNC_PULL_URL = '/api/sync/pull';
const MAX_BATCH_SIZE = 50;
const LAST_SYNCED_KEY = 'recallforge:lastSyncedAt';

// ─── Get pending sync items ──────────────────────────────────────────────

export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  return db.syncQueue.orderBy('createdAt').toArray();
}

export async function getPendingSyncCount(): Promise<number> {
  return db.syncQueue.count();
}

// ─── Push: send local changes to server ──────────────────────────────────

export async function pushChanges(
  userId: string
): Promise<{ processed: number; failed: number; errors: string[] }> {
  const items = await getPendingSyncItems();
  if (items.length === 0) return { processed: 0, failed: 0, errors: [] };

  let totalProcessed = 0;
  let totalFailed = 0;
  const errors: string[] = [];

  await EventEmitters.syncStarted(userId);

  // Process in batches
  const deviceId = getClientDeviceId();
  for (let i = 0; i < items.length; i += MAX_BATCH_SIZE) {
    const batch = items.slice(i, i + MAX_BATCH_SIZE);

    const operations = batch.map(item => ({
      operationId: item.operationId || item.id,
      deviceId: item.deviceId || deviceId,
      clientUpdatedAt: item.clientUpdatedAt || item.createdAt,
      table: item.table,
      operation: item.operation,
      recordId: item.recordId,
      data: item.data as Record<string, unknown>,
    }));

    try {
      const response = await fetch(SYNC_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': deviceId,
        },
        body: JSON.stringify({ operations }),
      });

      if (response.ok) {
        const result = await response.json() as {
          processed: number;
          failed: number;
          results: Array<{ recordId: string; status: 'ok' | 'error'; error?: string }>;
          serverNow?: string;
        };
        captureServerClock(result.serverNow);

        // Remove successfully synced items from queue
        for (const r of result.results) {
          if (r.status === 'ok') {
            const item = batch.find(b => b.recordId === r.recordId);
            if (item) await db.syncQueue.delete(item.id);
            totalProcessed++;
          } else {
            const item = batch.find(b => b.recordId === r.recordId);
            if (item) {
              await db.syncQueue.update(item.id, {
                retries: item.retries + 1,
                lastError: r.error || 'Server error',
              });
            }
            totalFailed++;
            errors.push(`${r.recordId}: ${r.error}`);
          }
        }
      } else {
        // Entire batch failed — increment retries on all items
        for (const item of batch) {
          await db.syncQueue.update(item.id, {
            retries: item.retries + 1,
            lastError: `HTTP ${response.status}`,
          });
        }
        totalFailed += batch.length;
        errors.push(`Batch failed: HTTP ${response.status}`);
      }
    } catch (err) {
      for (const item of batch) {
        await db.syncQueue.update(item.id, {
          retries: item.retries + 1,
          lastError: err instanceof Error ? err.message : 'Network error',
        });
      }
      totalFailed += batch.length;
      errors.push(err instanceof Error ? err.message : 'Network error');
    }
  }

  await EventEmitters.syncCompleted(userId, {
    processed: totalProcessed,
    failed: totalFailed,
    total: items.length,
  });

  return { processed: totalProcessed, failed: totalFailed, errors };
}

// ─── Pull: fetch server changes into local Dexie ─────────────────────────

// Map of table name → Dexie table reference
function getDexieTable(name: string) {
  const map: Record<string, typeof db.decks> = {
    decks: db.decks as never,
    presets: db.presets as never,
    noteTypes: db.noteTypes as never,
    notes: db.notes as never,
    cards: db.cards as never,
    reviewLogs: db.reviewLogs as never,
    cardCommands: db.cardCommands as never,
    tags: db.tags as never,
    flags: db.flags as never,
    savedSearches: db.savedSearches as never,
    filteredDecks: db.filteredDecks as never,
    mediaAssets: db.mediaAssets as never,
    studySessions: db.studySessions as never,
    activityEvents: db.activityEvents as never,
    dailySummaries: db.dailySummaries as never,
    xpLedger: db.xpLedger as never,
    userGamification: db.userGamification as never,
    quests: db.quests as never,
    curriculumPrograms: db.curriculumPrograms as never,
    curriculumSubjects: db.curriculumSubjects as never,
    curriculumModules: db.curriculumModules as never,
    curriculumChapters: db.curriculumChapters as never,
    curriculumTopics: db.curriculumTopics as never,
    curriculumLinks: db.curriculumLinks as never,
    personalSummaries: db.personalSummaries as never,
    optimizationRuns: db.optimizationRuns as never,
  };
  return map[name];
}

export async function pullChanges(): Promise<{
  tablesUpdated: string[];
  recordsUpserted: number;
  recordsDeleted: number;
}> {
  const since = localStorage.getItem(LAST_SYNCED_KEY) || '1970-01-01T00:00:00.000Z';
  const deviceId = getClientDeviceId();

  try {
    const response = await fetch(`${SYNC_PULL_URL}?since=${encodeURIComponent(since)}`, {
      headers: {
        'x-device-id': deviceId,
      },
    });
    if (!response.ok) {
      throw new Error(`Pull failed: HTTP ${response.status}`);
    }

    const data = await response.json() as {
      changes: Record<string, { upserts: Record<string, unknown>[]; deletes: string[] }>;
      syncTimestamp: string;
      serverNow?: string;
    };
    captureServerClock(data.serverNow ?? data.syncTimestamp);

    let totalUpserted = 0;
    let totalDeleted = 0;
    const tablesUpdated: string[] = [];

    for (const [tableName, tableChanges] of Object.entries(data.changes)) {
      const dexieTable = getDexieTable(tableName);
      if (!dexieTable) continue;

      tablesUpdated.push(tableName);

      // Upsert records (last-write-wins: server updatedAt > local updatedAt → accept)
      if (tableChanges.upserts.length > 0) {
        await dexieTable.bulkPut(tableChanges.upserts as never[]);
        totalUpserted += tableChanges.upserts.length;
      }

      // Delete records that were soft-deleted on server
      if (tableChanges.deletes.length > 0) {
        await dexieTable.bulkDelete(tableChanges.deletes);
        totalDeleted += tableChanges.deletes.length;
      }
    }

    // Update sync cursor
    localStorage.setItem(LAST_SYNCED_KEY, data.syncTimestamp);

    return { tablesUpdated, recordsUpserted: totalUpserted, recordsDeleted: totalDeleted };
  } catch (err) {
    console.error('Pull sync error:', err);
    throw err;
  }
}

// ─── Full sync: push then pull ───────────────────────────────────────────

export async function fullSync(userId: string): Promise<{
  push: { processed: number; failed: number; errors: string[] };
  pull: { tablesUpdated: string[]; recordsUpserted: number; recordsDeleted: number };
}> {
  // Ensure all local records are queued for sync (catches records
  // created before the queueSync bug was fixed)
  await ensureLocalDataQueued(userId);

  const pushResult = await pushChanges(userId);
  const pullResult = await pullChanges();
  return { push: pushResult, pull: pullResult };
}

// ─── Ensure all local Dexie records are in syncQueue ─────────────────────
// One-time reconciliation: for each local deck/note/card, check if there's
// already a pending syncQueue entry. If not, queue a 'create' operation
// so it gets pushed to the server.

async function ensureLocalDataQueued(userId: string): Promise<void> {
  const RECONCILE_KEY = 'recallforge:reconciled:v2';
  if (typeof window !== 'undefined' && localStorage.getItem(RECONCILE_KEY)) return;

  const tables = ['decks', 'noteTypes', 'notes', 'cards'] as const;
  const tableMap = {
    decks: db.decks,
    noteTypes: db.noteTypes,
    notes: db.notes,
    cards: db.cards,
  };

  const pendingItems = await db.syncQueue.toArray();
  const pendingIds = new Set(pendingItems.map(i => i.recordId));

  let queued = 0;
  for (const tableName of tables) {
    const dexieTable = tableMap[tableName] as typeof db.decks;
    const records = await dexieTable.where('userId').equals(userId).toArray();
    for (const record of records) {
      if (!pendingIds.has(record.id)) {
        const { queueSync } = await import('@/lib/db');
        await queueSync(tableName, record.id, 'create', record as unknown as Record<string, unknown>);
        queued++;
      }
    }
  }

  if (typeof window !== 'undefined') {
    localStorage.setItem(RECONCILE_KEY, new Date().toISOString());
  }

  if (queued > 0) {
    console.log(`[Sync] Reconciled ${queued} local records into syncQueue`);
  }
}

// ─── Legacy compat ───────────────────────────────────────────────────────

/** @deprecated Use pushChanges() instead */
export async function processSyncQueue(
  userId: string,
  _apiEndpoint?: string
): Promise<{ processed: number; failed: number; errors: string[] }> {
  return pushChanges(userId);
}

// ─── Clear sync queue ────────────────────────────────────────────────────

export async function clearSyncQueue(): Promise<void> {
  await db.syncQueue.clear();
}

// ─── Remove failed items ────────────────────────────────────────────────

export async function removeFailedItems(maxRetries: number = 5): Promise<number> {
  const items = await db.syncQueue
    .filter(i => i.retries >= maxRetries)
    .toArray();

  for (const item of items) {
    await db.syncQueue.delete(item.id);
  }

  return items.length;
}

// ─── Online status detection ────────────────────────────────────────────

export function getOnlineStatus(): boolean {
  if (typeof navigator !== 'undefined') {
    return navigator.onLine;
  }
  return true;
}

export function onOnlineStatusChange(callback: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const onOnline = () => callback(true);
  const onOffline = () => callback(false);

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
