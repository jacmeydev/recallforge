'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, GitMerge, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  LOCAL_USER_ID,
  commitLocalUserMerge,
  discardLocalUserData,
  getLocalUserMergePreview,
  type LocalUserMergePreview,
} from '@/lib/services/local-merge-service';
import { exportAllData } from '@/lib/services/import-export-service';

interface LocalMergeDialogProps {
  targetUserId: string | null;
  onResolved?: () => Promise<void> | void;
}

function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function LocalMergeDialog({ targetUserId, onResolved }: LocalMergeDialogProps) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [action, setAction] = useState<'merge' | 'discard' | 'export' | null>(null);
  const [preview, setPreview] = useState<LocalUserMergePreview | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      if (!targetUserId || dismissed) {
        setOpen(false);
        setPreview(null);
        return;
      }

      setLoadingPreview(true);
      setError('');
      try {
        const nextPreview = await getLocalUserMergePreview(targetUserId);
        if (cancelled) return;
        setPreview(nextPreview);
        setOpen(nextPreview.hasLocalData);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'No se pudo preparar el merge local.');
      } finally {
        if (!cancelled) {
          setLoadingPreview(false);
        }
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [dismissed, targetUserId]);

  const duplicateSummary = useMemo(() => {
    if (!preview || preview.duplicateExamples.length === 0) return null;
    return preview.duplicateExamples
      .map((example) => `${example.noteId} -> ${example.matchedNoteId} (${example.reason})`)
      .join(', ');
  }, [preview]);

  if (!targetUserId) return null;

  const handleMerge = async () => {
    setAction('merge');
    setError('');
    setSuccess('');
    try {
      const result = await commitLocalUserMerge(targetUserId);
      if (typeof window !== 'undefined' && navigator.onLine) {
        try {
          const { fullSync } = await import('@/lib/sync');
          await fullSync(targetUserId);
        } catch {
          // Sync remains pending in queue; the user still keeps merged local data.
        }
      }
      await onResolved?.();
      setSuccess(`Merge completado. Backup ${result.backupId ? 'creado' : 'omitido'} y ${result.syncOperationsQueued} operaciones listas para sync.`);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar el merge local.');
    } finally {
      setAction(null);
    }
  };

  const handleDiscard = async () => {
    setAction('discard');
    setError('');
    setSuccess('');
    try {
      const result = await discardLocalUserData(targetUserId);
      await onResolved?.();
      setSuccess(`Coleccion local descartada. Se guardo un backup previo (${result.backupId}).`);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descartar la coleccion local.');
    } finally {
      setAction(null);
    }
  };

  const handleExport = async () => {
    setAction('export');
    setError('');
    try {
      const data = await exportAllData(LOCAL_USER_ID);
      downloadTextFile(data, `recallforge-local-user-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar la coleccion local.');
    } finally {
      setAction(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!action) setOpen(nextOpen); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Merge local pendiente</DialogTitle>
            <DialogDescription>
              Encontramos una coleccion offline en este navegador. Antes de seguir, elige si quieres fusionarla con tu cuenta o descartarla.
            </DialogDescription>
          </DialogHeader>

          {loadingPreview ? (
            <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analizando coleccion local...
            </div>
          ) : preview ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium">Contenido local</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {preview.localCounts.notes} notas, {preview.localCounts.cards} tarjetas, {preview.localCounts.reviewLogs} reviews,
                    {` `}{preview.localCounts.cardCommands} comandos y {preview.localCounts.auxiliaryRecords} registros auxiliares.
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium">Plan estimado</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {preview.mergeCounts.notesToCreate} notas nuevas, {preview.mergeCounts.notesToMerge} duplicados a fusionar,
                    {` `}{preview.mergeCounts.reviewLogsToReplay} reviews a reaplicar y {preview.mergeCounts.cardCommandsToReplay} comandos a migrar.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                <p>
                  Estructura: {preview.mergeCounts.deckCreates} decks nuevos / {preview.mergeCounts.deckReuses} reutilizados,
                  {` `}{preview.mergeCounts.noteTypeCreates} tipos nuevos / {preview.mergeCounts.noteTypeReuses} reutilizados,
                  {` `}{preview.mergeCounts.presetCreates} presets nuevos / {preview.mergeCounts.presetReuses} reutilizados.
                </p>
                <p className="mt-2">
                  Curriculo: {preview.mergeCounts.curriculumCreates} nodos por crear y {preview.mergeCounts.curriculumReuses} por reutilizar.
                </p>
              </div>

              {duplicateSummary && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Ejemplos de duplicados detectados</p>
                  <p className="mt-2 break-words">{duplicateSummary}</p>
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              {success && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700">
                  {success}
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={Boolean(action) || loadingPreview}
              >
                {action === 'export' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Exportar antes
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDismissed(true);
                  setOpen(false);
                }}
                disabled={Boolean(action)}
              >
                Ahora no
              </Button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="destructive"
                onClick={handleDiscard}
                disabled={Boolean(action) || loadingPreview}
              >
                {action === 'discard' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Descartar local
              </Button>
              <Button
                onClick={handleMerge}
                disabled={Boolean(action) || loadingPreview}
              >
                {action === 'merge' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
                Fusionar con mi cuenta
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {success && !open && (
        <div className="fixed bottom-4 right-4 z-40 max-w-sm rounded-lg border bg-background p-4 text-sm shadow-lg">
          {success}
        </div>
      )}
    </>
  );
}
