'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw, Wifi, WifiOff, X } from 'lucide-react';

// ─── PWA Install Prompt ───────────────────────────────────────────────────

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

export function ServiceWorkerRegistration() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [showOffline, setShowOffline] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  // Handle SW registration and updates
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations()
        .then(async (registrations) => {
          await Promise.all(registrations.map((registration) => registration.unregister()));
          if ('caches' in window) {
            const cacheKeys = await caches.keys();
            await Promise.all(
              cacheKeys
                .filter((key) => key.startsWith('recallforge-'))
                .map((key) => caches.delete(key))
            );
          }
          console.log('[SW] Disabled in development');
        })
        .catch((err) => console.warn('[SW] Cleanup failed:', err));
      return;
    }

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('[SW] Registered:', reg.scope);

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New version waiting to activate
                setWaitingWorker(newWorker);
                setUpdateAvailable(true);
              }
            });
          }
        });
      })
      .catch((err) => console.warn('[SW] Registration failed:', err));

    // Listen for messages from SW
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SYNC_REQUESTED') {
        console.log('[SW] Sync requested by service worker');
      }
    });
  }, []);

  // Handle PWA install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      // Only show if not already installed
      if (!window.matchMedia('(display-mode: standalone)').matches) {
        setShowInstall(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Online/offline detection
  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      setShowOffline(false);
    };
    const goOffline = () => {
      setIsOnline(false);
      setShowOffline(true);
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const handleUpdate = useCallback(() => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      setUpdateAvailable(false);
      window.location.reload();
    }
  }, [waitingWorker]);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('[PWA] Install outcome:', outcome);
    deferredPrompt = null;
    setShowInstall(false);
  }, []);

  return (
    <>
      {/* Update Available Banner */}
      {updateAvailable && (
        <div className="fixed bottom-4 left-4 right-4 z-[100] md:left-auto md:right-4 md:w-80">
          <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-lg">
            <RefreshCw className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Actualización disponible</p>
              <p className="text-xs text-muted-foreground">Reiniciá para aplicar</p>
            </div>
            <Button size="sm" onClick={handleUpdate}>
              Actualizar
            </Button>
          </div>
        </div>
      )}

      {/* Install Prompt Banner */}
      {showInstall && !updateAvailable && (
        <div className="fixed bottom-4 left-4 right-4 z-[100] md:left-auto md:right-4 md:w-80">
          <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-lg">
            <Download className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Instalar RecallForge</p>
              <p className="text-xs text-muted-foreground">Accedé rápido desde tu pantalla</p>
            </div>
            <Button size="sm" onClick={handleInstall}>
              Instalar
            </Button>
            <button onClick={() => setShowInstall(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Offline Indicator */}
      {showOffline && (
        <div className="fixed top-0 left-0 right-0 z-[100]">
          <div className="flex items-center justify-center gap-2 bg-amber-600 px-3 py-1.5 text-white text-xs">
            <WifiOff className="h-3.5 w-3.5" />
            <span>Sin conexión — los cambios se sincronizarán al reconectar</span>
            <button onClick={() => setShowOffline(false)} className="ml-2 hover:opacity-80">
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
