// ============================================================================
// RecallForge — Auto-Sync Manager Hook
// ============================================================================
// Provides automatic sync: pull on init/focus/online, debounced push on
// queueSync changes. Updates store with real sync status.
// ============================================================================

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/lib/store';

const DEBOUNCE_PUSH_MS = 2_000;
const PULL_COOLDOWN_MS = 30_000; // don't pull more often than every 30s

/**
 * Manages automatic sync lifecycle for an authenticated user.
 * Must be called once in the app shell after initialization.
 */
export function useSyncManager(userId: string | null) {
  const setSyncStatus = useAppStore((s) => s.setSyncStatus);
  const setPendingSyncCount = useAppStore((s) => s.setPendingSyncCount);

  const lockRef = useRef(false);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPullRef = useRef(0);
  const mountedRef = useRef(true);

  // ── Core: guarded sync execution ──────────────────────────────────────

  const runSync = useCallback(
    async (mode: 'full' | 'push' | 'pull') => {
      if (!userId || userId === 'local-user' || lockRef.current) return;

      lockRef.current = true;
      setSyncStatus('syncing');

      try {
        const sync = await import('@/lib/sync');
        const { getPendingSyncCount } = sync;

        if (mode === 'push' || mode === 'full') {
          await sync.pushChanges(userId);
        }
        if (mode === 'pull' || mode === 'full') {
          lastPullRef.current = Date.now();
          const pullResult = await sync.pullChanges();

          // Refresh Zustand store from Dexie so UI reflects pulled data
          if (mountedRef.current && (pullResult.recordsUpserted > 0 || pullResult.recordsDeleted > 0)) {
            try {
              const { getDecksWithCounts } = await import('@/lib/services/deck-service');
              const { getNoteTypes } = await import('@/lib/services/notetype-service');
              const { db } = await import('@/lib/db');

              const [decks, noteTypes, presets] = await Promise.all([
                getDecksWithCounts(userId),
                getNoteTypes(userId),
                db.presets.where('userId').equals(userId).toArray(),
              ]);

              if (mountedRef.current) {
                const store = useAppStore.getState();
                store.setDecks(decks);
                store.setNoteTypes(noteTypes);
                store.setPresets(presets);
              }
            } catch (refreshErr) {
              console.error('Sync: store refresh after pull failed:', refreshErr);
              // Data IS in Dexie even if store refresh failed.
              // Emit event so pages can self-heal by re-querying Dexie.
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event('recallforge:sync-pull-completed'));
              }
            }
          }
        }

        if (mountedRef.current) {
          const count = await getPendingSyncCount();
          setPendingSyncCount(count);
          setSyncStatus('idle');
          // Always notify that sync completed so pages can re-query
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('recallforge:sync-pull-completed'));
          }
        }
      } catch (err) {
        console.error(`Sync ${mode} failed:`, err);
        if (mountedRef.current) setSyncStatus('error');
      } finally {
        lockRef.current = false;
      }
    },
    [userId, setSyncStatus, setPendingSyncCount]
  );

  // ── Debounced push (called when syncQueue changes) ────────────────────

  const schedulePush = useCallback(() => {
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(() => {
      runSync('push');
    }, DEBOUNCE_PUSH_MS);
  }, [runSync]);

  // ── Pull with cooldown ────────────────────────────────────────────────

  const pullIfCooldownElapsed = useCallback(() => {
    if (Date.now() - lastPullRef.current < PULL_COOLDOWN_MS) return;
    runSync('pull');
  }, [runSync]);

  // ── Lifecycle ─────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    if (!userId || userId === 'local-user') {
      setSyncStatus('idle');
      return;
    }

    // 1. Initial pull on mount
    runSync('full');

    // 2. Listen for visibility change (tab focus)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        pullIfCooldownElapsed();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // 3. Listen for online event
    const onOnline = () => {
      setSyncStatus('idle');
      runSync('full');
    };
    const onOffline = () => {
      setSyncStatus('offline');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // 4. Set initial offline state
    if (!navigator.onLine) {
      setSyncStatus('offline');
    }

    // 5. Listen for sync-queue-changed custom event
    const onQueueChanged = () => {
      // Update pending count immediately
      import('@/lib/sync').then(({ getPendingSyncCount }) =>
        getPendingSyncCount().then((c) => {
          if (mountedRef.current) setPendingSyncCount(c);
        })
      );
      schedulePush();
    };
    window.addEventListener('recallforge:sync-queue-changed', onQueueChanged);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('recallforge:sync-queue-changed', onQueueChanged);
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    };
  }, [userId, runSync, pullIfCooldownElapsed, schedulePush, setSyncStatus, setPendingSyncCount]);
}
