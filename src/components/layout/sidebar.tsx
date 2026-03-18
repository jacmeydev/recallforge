'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Library,
  BookOpen,
  Search,
  BarChart3,
  Brain,
  Settings,
  ChevronLeft,
  ChevronRight,
  Plus,
  Cloud,
  CloudOff,
  Menu,
  FileText,
  FileBarChart,
  Upload,
  Trophy,
  Shield,
  GraduationCap,
  Cpu,
  Bot,
  Sparkles,
  RefreshCw,
  LogIn,
  LogOut,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/lib/store';
import { useSession, signOut } from 'next-auth/react';

const navItems = [
  { href: '/dashboard', label: 'Inicio', icon: LayoutDashboard },
  { href: '/decks', label: 'Mazos', icon: Library },
  { href: '/browser', label: 'Explorador', icon: Search },
  { href: '/notetypes', label: 'Tipos de Nota', icon: FileText },
  { href: '/gamification', label: 'Progreso', icon: Trophy },
  { href: '/rescue', label: 'Rescate', icon: Shield },
  { href: '/stats', label: 'Estadísticas', icon: BarChart3 },
  { href: '/atlas', label: 'Atlas de Memoria', icon: Brain },
  { href: '/curriculum', label: 'Currículo', icon: GraduationCap },
  { href: '/summaries', label: 'Resúmenes', icon: FileBarChart },
  { href: '/ai-import', label: 'Importar IA', icon: Upload },
  { href: '/agent-console', label: 'Consola Agent', icon: Bot },
  { href: '/copilot', label: 'Copilot', icon: Sparkles },
  { href: '/optimizer', label: 'Optimizador', icon: Cpu },
  { href: '/settings', label: 'Ajustes', icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { sidebarOpen, toggleSidebar, setSidebarOpen, syncStatus, pendingSyncCount } = useAppStore();
  const [isCompactLayout, setIsCompactLayout] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const updateLayoutMode = (event: MediaQueryList | MediaQueryListEvent) => {
      setIsCompactLayout(event.matches);
      if (event.matches) {
        setSidebarOpen(false);
      }
    };

    updateLayoutMode(mediaQuery);

    const handleChange = (event: MediaQueryListEvent) => updateLayoutMode(event);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [setSidebarOpen]);

  return (
    <>
      {/* Mobile overlay */}
      {isCompactLayout && sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={toggleSidebar}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-full flex-col border-r bg-sidebar-background transition-all duration-200',
          isCompactLayout ? 'w-72 max-w-[85vw] shadow-xl' : (sidebarOpen ? 'w-64' : 'w-16'),
          isCompactLayout && !sidebarOpen && '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
            RF
          </div>
          {sidebarOpen && (
            <span className="font-semibold text-foreground tracking-tight">
              RecallForge
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7"
            onClick={toggleSidebar}
          >
            {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>

        {/* Quick Add */}
        <div className="px-3 py-2">
          <Link href="/notes/add">
            <Button
              variant="default"
              className={cn('w-full gap-2', !sidebarOpen && 'px-0')}
              size={sidebarOpen ? 'default' : 'icon'}
            >
              <Plus className="h-4 w-4" />
              {sidebarOpen && 'Agregar Nota'}
            </Button>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {navItems.map((item) => {
            const isActive = pathname?.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-primary'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {sidebarOpen && item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Sync status */}
        <div className="border-t p-3 space-y-2">
          {/* User / Auth */}
          <UserAuthSection sidebarOpen={sidebarOpen} />

          {/* Sync indicator */}
          <SyncIndicator sidebarOpen={sidebarOpen} syncStatus={syncStatus} pendingSyncCount={pendingSyncCount} />
        </div>
      </aside>
    </>
  );
}

function UserAuthSection({ sidebarOpen }: { sidebarOpen: boolean }) {
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;

  if (!sidebarOpen) {
    return (
      <Link href={isLoggedIn ? '#' : '/login'} className="flex items-center justify-center rounded-lg px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
        <User className="h-3.5 w-3.5" />
      </Link>
    );
  }

  if (!isLoggedIn) {
    return (
      <Link href="/login" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
        <LogIn className="h-3.5 w-3.5" />
        <span>Iniciar sesión</span>
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted-foreground">
      <User className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate flex-1">{session.user?.name || session.user?.email}</span>
      <button onClick={() => signOut({ callbackUrl: '/login' })} className="hover:text-destructive" title="Cerrar sesión">
        <LogOut className="h-3 w-3" />
      </button>
    </div>
  );
}

function SyncIndicator({ sidebarOpen, syncStatus, pendingSyncCount }: {
  sidebarOpen: boolean;
  syncStatus: string;
  pendingSyncCount: number;
}) {
  const { data: session } = useSession();
  const { setSyncStatus, setPendingSyncCount } = useAppStore();

  const handleSync = async () => {
    if (syncStatus === 'syncing' || !session?.user?.id) return;
    setSyncStatus('syncing');
    try {
      const { fullSync, getPendingSyncCount } = await import('@/lib/sync');
      await fullSync(session.user.id);
      const count = await getPendingSyncCount();
      setPendingSyncCount(count);
      setSyncStatus('idle');

      // Refresh Zustand store so UI reflects synced data
      try {
        const { getDecksWithCounts } = await import('@/lib/services/deck-service');
        const { getNoteTypes } = await import('@/lib/services/notetype-service');
        const { db } = await import('@/lib/db');
        const store = (await import('@/lib/store')).useAppStore.getState();

        const [decks, noteTypes, presets] = await Promise.all([
          getDecksWithCounts(session.user.id),
          getNoteTypes(session.user.id),
          db.presets.where('userId').equals(session.user.id).toArray(),
        ]);

        store.setDecks(decks);
        store.setNoteTypes(noteTypes);
        store.setPresets(presets);
      } catch (refreshErr) {
        console.error('Store refresh after manual sync failed:', refreshErr);
      }

      // Notify pages to re-query Dexie
      window.dispatchEvent(new Event('recallforge:sync-pull-completed'));
    } catch (err) {
      console.error('Manual sync failed:', err);
      setSyncStatus('error');
    }
  };

  const isActivelySyncing = syncStatus === 'syncing';
  const canSync = !!session?.user?.id && !isActivelySyncing;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors',
        syncStatus === 'error' ? 'text-destructive' : 'text-muted-foreground',
        canSync && 'cursor-pointer hover:bg-accent hover:text-foreground'
      )}
      onClick={canSync ? handleSync : undefined}
      title={canSync ? 'Clic para sincronizar' : undefined}
    >
      {syncStatus === 'offline' ? (
        <CloudOff className="h-3.5 w-3.5 shrink-0" />
      ) : isActivelySyncing ? (
        <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : (
        <Cloud className="h-3.5 w-3.5 shrink-0" />
      )}
      {sidebarOpen && (
        <span>
          {isActivelySyncing && 'Sincronizando...'}
          {!isActivelySyncing && syncStatus === 'idle' && pendingSyncCount > 0 && `${pendingSyncCount} pendientes`}
          {!isActivelySyncing && syncStatus === 'idle' && pendingSyncCount === 0 && 'Sincronizado'}
          {!isActivelySyncing && syncStatus === 'offline' && 'Sin conexión'}
          {!isActivelySyncing && syncStatus === 'error' && 'Error de sync'}
        </span>
      )}
    </div>
  );
}

export function MobileHeader() {
  const { toggleSidebar } = useAppStore();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/60 lg:hidden">
      <Button variant="ghost" size="icon" onClick={toggleSidebar}>
        <Menu className="h-5 w-5" />
      </Button>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-xs">
          RF
        </div>
        <span className="truncate font-semibold text-sm">RecallForge</span>
      </div>
    </header>
  );
}
