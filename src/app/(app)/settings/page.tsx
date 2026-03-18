'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Settings as SettingsIcon,
  Moon,
  Sun,
  Download,
  Upload,
  Trash2,
  Database,
  Shield,
  Save,
  RotateCcw,
  UserX,
  Key,
  Copy,
  Eye,
  EyeOff,
  Bell,
  BellOff,
  Clock,
} from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useAppStore } from '@/lib/store';
import { db, clearAllLocalData } from '@/lib/db';
import { exportAllData, importFromJSON, createBackup, listBackups, restoreBackup } from '@/lib/services/import-export-service';
import { exportEventsNDJSON } from '@/lib/events';
import type { SchedulingPreset, BackupSnapshot } from '@/types';

type BackupSummary = Omit<BackupSnapshot, 'data'>;

interface HealthSnapshot {
  status: string;
  timestamp: string;
  db?: {
    status?: string;
    sizeBytes?: number;
    users?: number;
  };
  schema?: {
    schemaVersion?: string | null;
    replayBacklog?: number;
    pendingCount?: number;
  };
  observability?: {
    totals?: {
      totalRequests?: number;
      totalErrors?: number;
      errorRate?: number;
    };
    namedMetrics?: Array<{
      name: string;
      lastValue: number;
    }>;
  };
}

export default function SettingsPage() {
  const { user, presets, setPresets } = useAppStore();
  const safePresets = Array.isArray(presets) ? presets : [];
  const [activeTab, setActiveTab] = useState('scheduling');
  const [darkMode, setDarkMode] = useState(false);
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Notification preferences state (Phase 7)
  const [notifPrefs, setNotifPrefs] = useState({
    enabled: true,
    studyReminders: true,
    streakAlerts: true,
    dailySummary: false,
    quietStart: '22:00',
    quietEnd: '08:00',
    reminderTime: '09:00',
  });
  const [notifLoaded, setNotifLoaded] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>('default');

  // Edit state for scheduling preset
  const defaultPreset = safePresets[0];
  const [presetForm, setPresetForm] = useState({
    desiredRetention: defaultPreset?.desiredRetention ?? 0.9,
    maximumInterval: defaultPreset?.maximumInterval ?? 36500,
    newCards: defaultPreset?.dailyLimits?.newCards ?? 20,
    reviews: defaultPreset?.dailyLimits?.reviews ?? 200,
    learningSteps: defaultPreset?.learningSteps?.join(', ') ?? '1, 10',
    relearningSteps: defaultPreset?.relearningSteps?.join(', ') ?? '10',
    buryNewSiblings: defaultPreset?.buryNewSiblings ?? true,
    buryReviewSiblings: defaultPreset?.buryReviewSiblings ?? true,
  });

  useEffect(() => {
    if (!defaultPreset) return;
    setPresetForm({
      desiredRetention: defaultPreset.desiredRetention ?? 0.9,
      maximumInterval: defaultPreset.maximumInterval ?? 36500,
      newCards: defaultPreset.dailyLimits?.newCards ?? 20,
      reviews: defaultPreset.dailyLimits?.reviews ?? 200,
      learningSteps: Array.isArray(defaultPreset.learningSteps) ? defaultPreset.learningSteps.join(', ') : '1, 10',
      relearningSteps: Array.isArray(defaultPreset.relearningSteps) ? defaultPreset.relearningSteps.join(', ') : '10',
      buryNewSiblings: defaultPreset.buryNewSiblings ?? true,
      buryReviewSiblings: defaultPreset.buryReviewSiblings ?? true,
    });
  }, [defaultPreset]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    async function loadBackups() {
      if (!user) return;
      const list = await listBackups(user.id);
      setBackups(list);
    }
    loadBackups();
  }, [user]);

  // Load notification preferences (Phase 7)
  useEffect(() => {
    if (activeTab === 'notifications' && !notifLoaded) {
      // Check browser notification support
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setNotifPermission(Notification.permission);
      } else {
        setNotifPermission('unsupported');
      }

      fetch('/api/notifications/preferences')
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setNotifPrefs(data); })
        .catch(() => {})
        .finally(() => setNotifLoaded(true));
    }
  }, [activeTab, notifLoaded]);

  const showMessage = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleSavePreset = async () => {
    if (!user || !defaultPreset) return;
    setSaving(true);

    try {
      const updated: SchedulingPreset = {
        ...defaultPreset,
        desiredRetention: presetForm.desiredRetention,
        maximumInterval: presetForm.maximumInterval,
        dailyLimits: {
          newCards: presetForm.newCards,
          reviews: presetForm.reviews,
        },
        learningSteps: presetForm.learningSteps.split(',').map((s) => parseInt(s.trim())).filter((n) => !isNaN(n)),
        relearningSteps: presetForm.relearningSteps.split(',').map((s) => parseInt(s.trim())).filter((n) => !isNaN(n)),
        buryNewSiblings: presetForm.buryNewSiblings,
        buryReviewSiblings: presetForm.buryReviewSiblings,
        updatedAt: new Date().toISOString(),
      };

      await db.presets.put(updated);
      setPresets([updated, ...safePresets.slice(1)]);
      showMessage('¡Configuración guardada!');
    } catch (err) {
      console.error('Failed to save preset:', err);
      showMessage('Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleExportJSON = async () => {
    if (!user) return;
    const data = await exportAllData(user.id);
    const blob = new Blob([data], { type: 'application/json' });
    downloadBlob(blob, `recallforge-export-${new Date().toISOString().slice(0, 10)}.json`);
    showMessage('¡Exportación completa!');
  };

  const handleExportTelemetry = async () => {
    if (!user) return;
    const data = await exportEventsNDJSON(user.id);
    const blob = new Blob([data], { type: 'application/x-ndjson' });
    downloadBlob(blob, `recallforge-telemetry-${new Date().toISOString().slice(0, 10)}.ndjson`);
    showMessage('¡Telemetría exportada!');
  };

  const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!user || !e.target.files?.[0]) return;

    const file = e.target.files[0];
    const text = await file.text();

    try {
      const result = await importFromJSON(user.id, text, { duplicateHandling: 'skip' });
      showMessage(`Importados ${result.notesCreated} notas, ${result.cardsCreated} tarjetas`);
    } catch (err) {
      console.error('Import failed:', err);
      showMessage('Error en la importación');
    }
  };

  const handleCreateBackup = async () => {
    if (!user) return;
    await createBackup(user.id);
    const list = await listBackups(user.id);
    setBackups(list);
    showMessage('¡Respaldo creado!');
  };

  const handleRestoreBackup = async (backupId: string) => {
    if (!user) return;
    if (!confirm('Esto reemplazará todos tus datos actuales. ¿Continuar?')) return;
    await restoreBackup(user.id, backupId);
    showMessage('¡Respaldo restaurado! Recarga la página.');
  };

  const handleClearData = async () => {
    if (!confirm('Esto eliminará permanentemente TODOS los datos locales. No se puede deshacer. ¿Continuar?')) return;
    if (!confirm('¿Estás seguro? TODOS los datos se perderán.')) return;
    await clearAllLocalData();
    showMessage('Datos borrados. Recarga la página.');
  };

  const [clearingServerData, setClearingServerData] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyPreview, setApiKeyPreview] = useState<string | null>(null);
  const [apiKeyLastRotatedAt, setApiKeyLastRotatedAt] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [healthSnapshot, setHealthSnapshot] = useState<HealthSnapshot | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  useEffect(() => {
    if (activeTab === 'account' && apiKeyPreview === null && !loadingAccount) {
      setLoadingAccount(true);
      fetch('/api/auth/account')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data) return;
          setHasApiKey(Boolean(data.hasApiKey));
          setApiKeyPreview(data.apiKeyPreview ?? null);
          setApiKeyLastRotatedAt(data.apiKeyLastRotatedAt ?? null);
        })
        .catch(() => {})
        .finally(() => setLoadingAccount(false));
    }
  }, [activeTab, apiKeyPreview, loadingAccount]);

  useEffect(() => {
    if ((activeTab === 'account' || activeTab === 'backups') && !loadingHealth && !healthSnapshot) {
      setLoadingHealth(true);
      fetch('/api/health')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) {
            setHealthSnapshot(data);
          }
        })
        .catch(() => {})
        .finally(() => setLoadingHealth(false));
    }
  }, [activeTab, loadingHealth, healthSnapshot]);

  const handleCopyApiKey = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      showMessage('API Key copiada al portapapeles');
    }
  };

  const handleRotateApiKey = async () => {
    setLoadingAccount(true);
    try {
      const res = await fetch('/api/auth/api-key/rotate', { method: 'POST' });
      if (!res.ok) {
        showMessage('No se pudo rotar la API Key');
        return;
      }

      const data = await res.json() as {
        apiKey?: string;
        apiKeyPreview?: string;
        apiKeyLastRotatedAt?: string;
      };

      setApiKey(data.apiKey ?? null);
      setApiKeyPreview(data.apiKeyPreview ?? null);
      setApiKeyLastRotatedAt(data.apiKeyLastRotatedAt ?? null);
      setHasApiKey(Boolean(data.apiKeyPreview));
      setShowApiKey(true);
      showMessage('API Key rotada. Guárdala ahora: solo se muestra una vez.');
    } catch {
      showMessage('No se pudo rotar la API Key');
    } finally {
      setLoadingAccount(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirm('¿Estás seguro de que deseas eliminar tu cuenta? Se borrarán TODOS tus datos del servidor y no podrás recuperarlos.')) return;
    if (!confirm('Esta acción es IRREVERSIBLE. ¿Confirmas que deseas eliminar tu cuenta permanentemente?')) return;
    setDeletingAccount(true);
    try {
      const res = await fetch('/api/auth/account', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        showMessage(data.error || 'Error al eliminar la cuenta');
        return;
      }
      await clearAllLocalData();
      await signOut({ callbackUrl: '/login' });
    } catch {
      showMessage('Error al eliminar la cuenta');
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleClearServerData = async () => {
    if (!confirm('Esto borrará mazos, notas, tarjetas, historial y drafts del servidor, pero mantendrá tu cuenta.')) return;
    if (!confirm('Para evitar que vuelvan a aparecer en este navegador, también se limpiará el almacenamiento local actual. ¿Continuar?')) return;

    setClearingServerData(true);
    try {
      const res = await fetch('/api/auth/account/data', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Error al borrar datos del servidor' }));
        showMessage(data.error || 'Error al borrar datos del servidor');
        return;
      }

      await clearAllLocalData();
      setPresets([]);
      setBackups([]);
      setHealthSnapshot(null);
      showMessage('Datos del servidor borrados. Este navegador se recargará para empezar limpio.');
      window.setTimeout(() => {
        window.location.reload();
      }, 700);
    } catch {
      showMessage('Error al borrar datos del servidor');
    } finally {
      setClearingServerData(false);
    }
  };

  const handleSaveNotifPrefs = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notifPrefs),
      });
      if (res.ok) {
        showMessage('¡Preferencias de notificación guardadas!');
      } else {
        showMessage('Error al guardar');
      }
    } catch {
      showMessage('Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestNotifPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    setNotifPermission(permission);
    if (permission === 'granted') {
      showMessage('¡Notificaciones activadas!');
      // Register push subscription if SW is available
      const reg = await navigator.serviceWorker?.ready;
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const key = sub.getKey('p256dh');
          const auth = sub.getKey('auth');
          if (key && auth) {
            await fetch('/api/notifications/subscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                endpoint: sub.endpoint,
                keys: {
                  p256dh: btoa(String.fromCharCode(...new Uint8Array(key))),
                  auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
                },
              }),
            });
          }
        }
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <SettingsIcon className="h-6 w-6" />
          Ajustes
        </h1>
        {message && (
          <Badge variant="success" className="max-w-full self-start text-left">
            {message}
          </Badge>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl p-1 sm:grid-cols-3 lg:inline-flex lg:w-auto lg:grid-cols-none">
          <TabsTrigger value="scheduling" className="w-full">
            Programación
          </TabsTrigger>
          <TabsTrigger value="notifications" className="w-full">
            Notificaciones
          </TabsTrigger>
          <TabsTrigger value="appearance" className="w-full">
            Apariencia
          </TabsTrigger>
          <TabsTrigger value="account" className="w-full">
            Cuenta
          </TabsTrigger>
          <TabsTrigger value="data" className="w-full">
            Datos
          </TabsTrigger>
          <TabsTrigger value="backups" className="w-full">
            Respaldos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scheduling" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Programación FSRS</CardTitle>
              <CardDescription>Configura los parámetros del algoritmo de repetición espaciada</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Desired Retention */}
              <div className="space-y-2">
                <Label>Retención Deseada</Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    value={presetForm.desiredRetention}
                    onChange={(e) => setPresetForm((p) => ({ ...p, desiredRetention: parseFloat(e.target.value) || 0.9 }))}
                    min={0.7}
                    max={0.99}
                    step={0.01}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">
                    Objetivo: {(presetForm.desiredRetention * 100).toFixed(0)}% probabilidad de recuerdo
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Mayor retención = intervalos más cortos = más repasos. Recomendado: 0.85-0.95
                </p>
              </div>

              {/* Max Interval */}
              <div className="space-y-2">
                <Label>Intervalo Máximo (días)</Label>
                <Input
                  type="number"
                  value={presetForm.maximumInterval}
                  onChange={(e) => setPresetForm((p) => ({ ...p, maximumInterval: parseInt(e.target.value) || 36500 }))}
                  className="w-32"
                  min={1}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* New Cards Per Day */}
                <div className="space-y-2">
                  <Label>Nuevas Tarjetas / Día</Label>
                  <Input
                    type="number"
                    value={presetForm.newCards}
                    onChange={(e) => setPresetForm((p) => ({ ...p, newCards: parseInt(e.target.value) || 20 }))}
                    min={0}
                    max={9999}
                  />
                </div>

                {/* Reviews Per Day */}
                <div className="space-y-2">
                  <Label>Repasos / Día</Label>
                  <Input
                    type="number"
                    value={presetForm.reviews}
                    onChange={(e) => setPresetForm((p) => ({ ...p, reviews: parseInt(e.target.value) || 200 }))}
                    min={0}
                    max={9999}
                  />
                </div>
              </div>

              {/* Learning Steps */}
              <div className="space-y-2">
                <Label>Pasos de Aprendizaje (minutos, separados por coma)</Label>
                <Input
                  value={presetForm.learningSteps}
                  onChange={(e) => setPresetForm((p) => ({ ...p, learningSteps: e.target.value }))}
                  placeholder="1, 10"
                />
              </div>

              {/* Relearning Steps */}
              <div className="space-y-2">
                <Label>Pasos de Reaprendizaje (minutos, separados por coma)</Label>
                <Input
                  value={presetForm.relearningSteps}
                  onChange={(e) => setPresetForm((p) => ({ ...p, relearningSteps: e.target.value }))}
                  placeholder="10"
                />
              </div>

              {/* Bury Siblings */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="buryNewSiblings"
                    checked={presetForm.buryNewSiblings}
                    onChange={(e) => setPresetForm((p) => ({ ...p, buryNewSiblings: e.target.checked }))}
                    className="rounded"
                  />
                  <Label htmlFor="buryNewSiblings">Enterrar hermanas nuevas hasta el día siguiente</Label>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="buryReviewSiblings"
                    checked={presetForm.buryReviewSiblings}
                    onChange={(e) => setPresetForm((p) => ({ ...p, buryReviewSiblings: e.target.checked }))}
                    className="rounded"
                  />
                  <Label htmlFor="buryReviewSiblings">Enterrar hermanas de repaso hasta el día siguiente</Label>
                </div>
              </div>

              <Button onClick={handleSavePreset} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Guardando...' : 'Guardar Ajustes'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab (Phase 7) */}
        <TabsContent value="notifications" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Notificaciones
              </CardTitle>
              <CardDescription>Configurá cuándo y cómo RecallForge te recuerda estudiar</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Browser Permission */}
              {notifPermission !== 'granted' && notifPermission !== 'unsupported' && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 p-4">
                  <div className="flex items-center gap-3">
                    <BellOff className="h-5 w-5 text-amber-600 shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">Notificaciones del navegador</p>
                      <p className="text-xs text-muted-foreground">
                        Permití notificaciones para recibir recordatorios de estudio
                      </p>
                    </div>
                    <Button size="sm" onClick={handleRequestNotifPermission}>
                      Permitir
                    </Button>
                  </div>
                </div>
              )}

              {notifPermission === 'unsupported' && (
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Las notificaciones push no están disponibles en este navegador.
                    Las notificaciones in-app seguirán funcionando.
                  </p>
                </div>
              )}

              {/* Master Toggle */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Notificaciones activas</Label>
                  <p className="text-xs text-muted-foreground">Activar o desactivar todas las notificaciones</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifPrefs.enabled}
                  onChange={(e) => setNotifPrefs(p => ({ ...p, enabled: e.target.checked }))}
                  className="rounded h-5 w-5"
                />
              </div>

              {notifPrefs.enabled && (
                <>
                  {/* Reminder Types */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Tipos de recordatorio</Label>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm">Recordatorios de estudio</p>
                          <p className="text-xs text-muted-foreground">Aviso cuando hay tarjetas pendientes</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={notifPrefs.studyReminders}
                          onChange={(e) => setNotifPrefs(p => ({ ...p, studyReminders: e.target.checked }))}
                          className="rounded h-5 w-5"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm">Alertas de racha</p>
                          <p className="text-xs text-muted-foreground">Aviso cuando tu racha está en riesgo</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={notifPrefs.streakAlerts}
                          onChange={(e) => setNotifPrefs(p => ({ ...p, streakAlerts: e.target.checked }))}
                          className="rounded h-5 w-5"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm">Resumen diario</p>
                          <p className="text-xs text-muted-foreground">Resumen con tu progreso del día</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={notifPrefs.dailySummary}
                          onChange={(e) => setNotifPrefs(p => ({ ...p, dailySummary: e.target.checked }))}
                          className="rounded h-5 w-5"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Schedule */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      Horarios
                    </Label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs">Hora de recordatorio</Label>
                        <Input
                          type="time"
                          value={notifPrefs.reminderTime}
                          onChange={(e) => setNotifPrefs(p => ({ ...p, reminderTime: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Silencio desde</Label>
                        <Input
                          type="time"
                          value={notifPrefs.quietStart}
                          onChange={(e) => setNotifPrefs(p => ({ ...p, quietStart: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Silencio hasta</Label>
                        <Input
                          type="time"
                          value={notifPrefs.quietEnd}
                          onChange={(e) => setNotifPrefs(p => ({ ...p, quietEnd: e.target.value }))}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      No recibirás notificaciones durante las horas de silencio
                    </p>
                  </div>
                </>
              )}

              <Button onClick={handleSaveNotifPrefs} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Guardando...' : 'Guardar Notificaciones'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Tema</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3">
                <Button
                  variant={!darkMode ? 'default' : 'outline'}
                  onClick={() => setDarkMode(false)}
                >
                  <Sun className="h-4 w-4 mr-2" />
                  Claro
                </Button>
                <Button
                  variant={darkMode ? 'default' : 'outline'}
                  onClick={() => setDarkMode(true)}
                >
                  <Moon className="h-4 w-4 mr-2" />
                  Oscuro
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="account" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Estado del sistema
              </CardTitle>
              <CardDescription>
                Señales rápidas de salud, migraciones y observabilidad del backend.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingHealth && !healthSnapshot ? (
                <p className="text-sm text-muted-foreground">Cargando estado del sistema...</p>
              ) : !healthSnapshot ? (
                <p className="text-sm text-muted-foreground">No se pudo cargar el estado del sistema.</p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatusMetric
                      label="Servicio"
                      value={healthSnapshot.status === 'ok' ? 'OK' : 'Degraded'}
                      tone={healthSnapshot.status === 'ok' ? 'success' : 'alert'}
                    />
                    <StatusMetric
                      label="DB"
                      value={healthSnapshot.db?.status === 'ok' ? 'OK' : 'Error'}
                      tone={healthSnapshot.db?.status === 'ok' ? 'success' : 'alert'}
                    />
                    <StatusMetric
                      label="Replay backlog"
                      value={healthSnapshot.schema?.replayBacklog ?? 0}
                      tone={(healthSnapshot.schema?.replayBacklog ?? 0) > 0 ? 'alert' : 'success'}
                    />
                    <StatusMetric
                      label="Error rate"
                      value={`${Math.round((healthSnapshot.observability?.totals?.errorRate ?? 0) * 100)}%`}
                      tone={(healthSnapshot.observability?.totals?.errorRate ?? 0) > 0.05 ? 'alert' : 'default'}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Schema: {healthSnapshot.schema?.schemaVersion || 'sin versión'} · Requests observados: {healthSnapshot.observability?.totals?.totalRequests ?? 0}
                  </div>
                  {Array.isArray(healthSnapshot.observability?.namedMetrics) && healthSnapshot.observability!.namedMetrics!.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {healthSnapshot.observability!.namedMetrics!.slice(0, 4).map((metric) => (
                        <Badge key={metric.name} variant="outline">
                          {metric.name}: {metric.lastValue}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                API Key
              </CardTitle>
              <CardDescription>
                Usa esta clave para acceder a la API del agente (UniBot/OpenClaw)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingAccount ? (
                <p className="text-sm text-muted-foreground">Cargando...</p>
              ) : hasApiKey || apiKeyPreview || apiKey ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm font-mono break-all">
                      {showApiKey && apiKey
                        ? apiKey
                        : apiKeyPreview || 'API Key configurada'}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowApiKey(!showApiKey)}
                      title={showApiKey ? 'Ocultar' : 'Mostrar'}
                      disabled={!apiKey}
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={handleCopyApiKey} title="Copiar" disabled={!apiKey}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={handleRotateApiKey} disabled={loadingAccount}>
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Rotar API Key
                    </Button>
                    {!apiKey && (
                      <Badge variant="secondary">Solo vista previa por seguridad</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Envíala en el header <code className="text-xs">Authorization: Bearer tu-api-key</code>
                  </p>
                  {apiKeyLastRotatedAt && (
                    <p className="text-xs text-muted-foreground">
                      Última rotación: {new Date(apiKeyLastRotatedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">No se encontró API Key</p>
                  <Button variant="outline" size="sm" onClick={handleRotateApiKey} disabled={loadingAccount}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Generar API Key
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Exportar e Importar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <Button variant="outline" onClick={handleExportJSON}>
                  <Download className="h-4 w-4 mr-2" />
                  Exportar JSON
                </Button>
                <Button variant="outline" onClick={handleExportTelemetry}>
                  <Download className="h-4 w-4 mr-2" />
                  Exportar Telemetría
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Importar JSON</Label>
                <Input
                  type="file"
                  accept=".json"
                  onChange={handleImportJSON}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-red-200 dark:border-red-900">
            <CardHeader>
              <CardTitle className="text-red-500">Zona de Peligro</CardTitle>
              <CardDescription>Estas acciones son destructivas e irreversibles</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-red-100 dark:border-red-900/50 p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Borrar solo datos locales</p>
                  <p className="text-xs text-muted-foreground">
                    Elimina mazos, notas, tarjetas e historial del navegador. Tu cuenta del servidor no se ve afectada.
                  </p>
                </div>
                <Button variant="destructive" size="sm" className="shrink-0" onClick={handleClearData}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Borrar solo local
                </Button>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-red-100 dark:border-red-900/60 p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Borrar datos del servidor</p>
                  <p className="text-xs text-muted-foreground">
                    Elimina el contenido sincronizado de tu cuenta y también limpia este navegador para evitar que reaparezca aquí. Si otro navegador ya tenía una copia local, debes borrarla allí también.
                  </p>
                </div>
                <Button variant="destructive" size="sm" className="shrink-0" onClick={handleClearServerData} disabled={clearingServerData}>
                  <Database className="h-4 w-4 mr-2" />
                  {clearingServerData ? 'Borrando...' : 'Borrar servidor'}
                </Button>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">Eliminar mi cuenta</p>
                  <p className="text-xs text-muted-foreground">
                    Elimina permanentemente tu cuenta y todos tus datos del servidor. Esta acción no se puede deshacer.
                  </p>
                </div>
                <Button variant="destructive" size="sm" className="shrink-0" onClick={handleDeleteAccount} disabled={deletingAccount}>
                  <UserX className="h-4 w-4 mr-2" />
                  {deletingAccount ? 'Eliminando...' : 'Eliminar cuenta'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="backups" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Respaldos Locales
              </CardTitle>
              <CardDescription>
                Los respaldos se guardan en el IndexedDB de tu navegador
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={handleCreateBackup}>
                <Shield className="h-4 w-4 mr-2" />
                Crear Respaldo Ahora
              </Button>

              {backups.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin respaldos aún</p>
              ) : (
                <div className="space-y-2">
                  {backups.map((backup) => (
                    <div
                      key={backup.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {new Date(backup.createdAt).toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatBackupSize(backup)}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRestoreBackup(backup.id)}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />
                        Restaurar
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {healthSnapshot && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Checklist de resiliencia</CardTitle>
                <CardDescription>Te ayuda a ver rápido si el sistema está en buen estado antes de tocar datos.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <HealthChecklistItem
                  ok={healthSnapshot.status === 'ok'}
                  label="Servicio web saludable"
                />
                <HealthChecklistItem
                  ok={healthSnapshot.db?.status === 'ok'}
                  label="Base SQLite accesible"
                />
                <HealthChecklistItem
                  ok={(healthSnapshot.schema?.pendingCount ?? 0) === 0}
                  label="Sin migraciones pendientes"
                />
                <HealthChecklistItem
                  ok={(healthSnapshot.schema?.replayBacklog ?? 0) === 0}
                  label="Sin backlog de replay FSRS"
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatBackupSize(backup: BackupSummary): string {
  const size = backup.metadata?.size;
  if (typeof size === 'number' && Number.isFinite(size)) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return 'Tamano desconocido';
}

function StatusMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'alert' | 'success';
}) {
  const className =
    tone === 'alert'
      ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20'
        : '';

  return (
    <div className={`rounded-lg border p-3 text-center ${className}`}>
      <p className="text-xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function HealthChecklistItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      <span>{label}</span>
    </div>
  );
}
