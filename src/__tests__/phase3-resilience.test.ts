// ============================================================================
// RecallForge — Phase 3 Local-First Resilience Tests
// ============================================================================
// Tests that the local-first architecture is preserved: queueSync works even
// when sync fails, push handles network errors gracefully, offline mode works.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

// ─── queueSync event dispatch ──────────────────────────────────────────────

describe('queueSync event dispatch', () => {
  it('dispatches recallforge:sync-queue-changed event on window', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    // Import real module — fake-indexeddb provides IndexedDB for Dexie
    const { db, queueSync } = await import('@/lib/db');

    // Spy on the syncQueue.add to avoid actual DB writes
    const addSpy = vi.spyOn(db.syncQueue, 'add').mockResolvedValue(undefined as unknown as string);

    await queueSync('decks', 'deck-1', 'create', { name: 'Test Deck' });

    // Check that event was dispatched
    const syncEvents = dispatchSpy.mock.calls.filter(
      ([event]) => event instanceof Event && event.type === 'recallforge:sync-queue-changed'
    );
    expect(syncEvents.length).toBeGreaterThanOrEqual(1);

    addSpy.mockRestore();
    dispatchSpy.mockRestore();
  });
});

// ─── pushChanges network error handling ────────────────────────────────────

describe('pushChanges network resilience', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('increments retries on network failure without crashing', async () => {
    const mockItems = [
      {
        id: 'sq-1',
        table: 'decks',
        recordId: 'deck-1',
        operation: 'create' as const,
        data: { name: 'Test' },
        createdAt: '2025-01-01T00:00:00.000Z',
        retries: 0,
      },
    ];
    const mockUpdate = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/lib/db', () => ({
      db: {
        syncQueue: {
          orderBy: () => ({ toArray: () => Promise.resolve(mockItems) }),
          update: mockUpdate,
        },
      },
    }));
    vi.doMock('@/lib/events', () => ({
      EventEmitters: {
        syncStarted: vi.fn().mockResolvedValue(undefined),
        syncCompleted: vi.fn().mockResolvedValue(undefined),
      },
    }));

    // Mock fetch to simulate network error
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

    const { pushChanges } = await import('@/lib/sync');
    const result = await pushChanges('test-user');

    expect(result.failed).toBe(1);
    expect(result.errors).toContain('Network offline');
    // Retry count should have been incremented
    expect(mockUpdate).toHaveBeenCalledWith('sq-1', expect.objectContaining({
      retries: 1,
      lastError: 'Network offline',
    }));

    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns 0 processed when queue is empty', async () => {
    vi.doMock('@/lib/db', () => ({
      db: {
        syncQueue: {
          orderBy: () => ({ toArray: () => Promise.resolve([]) }),
        },
      },
    }));
    vi.doMock('@/lib/events', () => ({
      EventEmitters: {
        syncStarted: vi.fn().mockResolvedValue(undefined),
        syncCompleted: vi.fn().mockResolvedValue(undefined),
      },
    }));

    const { pushChanges } = await import('@/lib/sync');
    const result = await pushChanges('test-user');

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);

    vi.restoreAllMocks();
  });
});

// ─── pullChanges network error handling ────────────────────────────────────

describe('pullChanges network resilience', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('throws on network failure (caller should handle)', async () => {
    vi.doMock('@/lib/db', () => ({
      db: {
        syncQueue: { orderBy: () => ({ toArray: () => Promise.resolve([]) }) },
      },
    }));
    vi.doMock('@/lib/events', () => ({
      EventEmitters: {
        syncStarted: vi.fn().mockResolvedValue(undefined),
        syncCompleted: vi.fn().mockResolvedValue(undefined),
      },
    }));

    // Mock localStorage
    const mockStorage: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => { mockStorage[k] = v; },
    });

    // Mock fetch to simulate network error
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));

    const { pullChanges } = await import('@/lib/sync');

    await expect(pullChanges()).rejects.toThrow('fetch failed');

    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });
});

// ─── Sync status store contract ────────────────────────────────────────────

describe('Sync status store contract', () => {
  it('useAppStore has setSyncStatus and setPendingSyncCount', async () => {
    const { useAppStore } = await import('@/lib/store');
    const state = useAppStore.getState();

    expect(typeof state.setSyncStatus).toBe('function');
    expect(typeof state.setPendingSyncCount).toBe('function');
    expect(state.syncStatus).toBe('idle');
    expect(state.pendingSyncCount).toBe(0);
  });

  it('setSyncStatus updates state correctly', async () => {
    const { useAppStore } = await import('@/lib/store');

    useAppStore.getState().setSyncStatus('syncing');
    expect(useAppStore.getState().syncStatus).toBe('syncing');

    useAppStore.getState().setSyncStatus('error');
    expect(useAppStore.getState().syncStatus).toBe('error');

    useAppStore.getState().setSyncStatus('offline');
    expect(useAppStore.getState().syncStatus).toBe('offline');

    useAppStore.getState().setSyncStatus('idle');
    expect(useAppStore.getState().syncStatus).toBe('idle');
  });

  it('setPendingSyncCount updates state correctly', async () => {
    const { useAppStore } = await import('@/lib/store');

    useAppStore.getState().setPendingSyncCount(5);
    expect(useAppStore.getState().pendingSyncCount).toBe(5);

    useAppStore.getState().setPendingSyncCount(0);
    expect(useAppStore.getState().pendingSyncCount).toBe(0);
  });
});
