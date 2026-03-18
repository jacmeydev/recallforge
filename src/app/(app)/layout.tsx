'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { AppSidebar, MobileHeader } from '@/components/layout/sidebar';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { ErrorBoundary } from '@/components/error-boundary';
import { LocalMergeDialog } from '@/components/local-merge-dialog';
import { useAppStore } from '@/lib/store';
import { useSyncManager } from '@/hooks/use-sync-manager';
import { cn } from '@/lib/utils';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { sidebarOpen, initialized, setInitialized } = useAppStore();
  const { data: session, status } = useSession();
  const lastWorkspaceRef = useRef<string | null>(null);

  // Auto-sync: pulls on init/focus/online, debounced push on queueSync
  const syncUserId = initialized ? (session?.user?.id || null) : null;
  useSyncManager(syncUserId);

  const loadWorkspace = useCallback(async (workspaceUserId: string) => {
    // Initialize default data
    const { seedDefaultNoteTypes, getNoteTypes } = await import('@/lib/services/notetype-service');
    const { getDecksWithCounts } = await import('@/lib/services/deck-service');
    const { db } = await import('@/lib/db');
    const { getDefaultPreset } = await import('@/lib/fsrs');

    // Pull from server FIRST so existing data arrives before seeding
    if (workspaceUserId !== 'local-user') {
      try {
        const { pullChanges } = await import('@/lib/sync');
        await pullChanges();
      } catch (pullErr) {
        console.warn('Initial pull failed (will seed defaults):', pullErr);
      }
    }

    // Seed note types only if none exist (from pull or prior sessions)
    await seedDefaultNoteTypes(workspaceUserId);

    // Seed default preset if none exists
    const presets = await db.presets.where('userId').equals(workspaceUserId).toArray();
    if (presets.length === 0) {
      const defaultPreset = getDefaultPreset();
      defaultPreset.userId = workspaceUserId;
      const { generateId, now } = await import('@/lib/utils');
      defaultPreset.id = generateId();
      defaultPreset.createdAt = now();
      defaultPreset.updatedAt = now();
      await db.presets.add(defaultPreset);
    }

    const [decks, noteTypes, updatedPresets] = await Promise.all([
      getDecksWithCounts(workspaceUserId),
      getNoteTypes(workspaceUserId),
      db.presets.where('userId').equals(workspaceUserId).toArray(),
    ]);

    const store = useAppStore.getState();
    store.setDecks(decks);
    store.setNoteTypes(noteTypes);
    store.setPresets(updatedPresets);
    store.setUser({
      id: workspaceUserId,
      email: session?.user?.email || 'local@recallforge.app',
      name: session?.user?.name || 'Usuario Local',
      locale: 'es',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      theme: 'system',
      studyPreferences: {
        showNextIntervals: true,
        simpleMode: false,
        autoplayAudio: true,
        doubleScrollProtection: true,
        focusModeDefault: false,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }, [session?.user?.email, session?.user?.name]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Wait for session check to complete (but don't block if it fails)
      if (status === 'loading') return;

      try {
        const userId = session?.user?.id || 'local-user';
        if (initialized && lastWorkspaceRef.current === userId) {
          return;
        }

        await loadWorkspace(userId);
        if (cancelled) return;

        lastWorkspaceRef.current = userId;
        setInitialized(true);
      } catch (err) {
        console.error('Failed to initialize RecallForge:', err);
        if (!cancelled) {
          setInitialized(true); // Still mark as initialized to show UI
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [initialized, loadWorkspace, session?.user?.id, setInitialized, status]);

  const handleLocalMergeResolved = useCallback(async () => {
    if (!session?.user?.id) return;
    await loadWorkspace(session.user.id);
    lastWorkspaceRef.current = session.user.id;
  }, [loadWorkspace, session?.user?.id]);

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-background">
      <AppSidebar />
      <main
        className={cn(
          'h-[100dvh] w-full overflow-x-hidden overflow-y-auto transition-all duration-200',
          sidebarOpen ? 'lg:pl-64' : 'lg:pl-16'
        )}
      >
        <MobileHeader />
        <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] sm:p-5 md:p-6 md:pb-8 lg:p-8">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </div>
      </main>
      <MobileBottomNav />
      <LocalMergeDialog
        targetUserId={initialized ? (session?.user?.id || null) : null}
        onResolved={handleLocalMergeResolved}
      />
    </div>
  );
}
