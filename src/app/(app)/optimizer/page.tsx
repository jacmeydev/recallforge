'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Cpu,
  Play,
  Check,
  X,
  RotateCcw,
  Clock,
  FileStack,
  AlertTriangle,
  CheckCircle2,
  Info,
} from 'lucide-react';
import type { SchedulingPreset, OptimizationRun } from '@/types';
import {
  isOptimizerAvailable,
  runOptimizer,
  saveOptimizationRun,
  applyOptimizedParameters,
  discardOptimizationRun,
  getOptimizationHistory,
  resetToDefaultParameters,
  type OptimizerProgress,
} from '@/lib/services/optimizer-service';

// Default FSRS-6.0 parameters (21 weights from ts-fsrs)
const DEFAULT_W = [
  0.2172, 1.1771, 3.2602, 16.1507,
  7.0114, 0.57, 2.0966, 0.0069,
  1.5261, 0.112, 1.0178, 1.849,
  0.1133, 0.3127, 2.2934, 0.2191,
  3.0004, 0.7536, 0.3332, 0.1437,
  0.2,
];

export default function OptimizerPage() {
  const { user, presets } = useAppStore();

  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<OptimizerProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizationRun | null>(null);
  const [history, setHistory] = useState<OptimizationRun[]>([]);

  const selectedPreset = presets.find((p) => p.id === selectedPresetId);

  // Auto-select first preset
  useEffect(() => {
    if (presets.length > 0 && !selectedPresetId) {
      setSelectedPresetId(presets[0].id);
    }
    setLoading(false);
  }, [presets, selectedPresetId]);

  // Load history when preset changes
  const loadHistory = useCallback(async () => {
    if (!user || !selectedPresetId) return;
    const runs = await getOptimizationHistory(user.id, selectedPresetId);
    setHistory(runs);
  }, [user, selectedPresetId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const availability = isOptimizerAvailable();

  const handleOptimize = async () => {
    if (!user || !selectedPreset) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);

    try {
      const optimizerResult = await runOptimizer(
        user.id,
        selectedPreset.id,
        setProgress,
      );

      const run = await saveOptimizationRun(
        user.id,
        selectedPreset.id,
        optimizerResult,
        selectedPreset.fsrsParameters.length > 0
          ? selectedPreset.fsrsParameters
          : DEFAULT_W,
        selectedPreset.desiredRetention,
      );

      setResult(run);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setRunning(false);
    }
  };

  const handleApply = async (runId: string) => {
    if (!user) return;
    try {
      await applyOptimizedParameters(user.id, runId);
      setResult(null);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al aplicar');
    }
  };

  const handleDiscard = async (runId: string) => {
    try {
      await discardOptimizationRun(runId);
      setResult(null);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al descartar');
    }
  };

  const handleReset = async () => {
    if (!user || !selectedPresetId) return;
    if (!confirm('¿Restablecer los parámetros FSRS a los valores por defecto?')) return;
    try {
      await resetToDefaultParameters(user.id, selectedPresetId);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al restablecer');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-pulse text-muted-foreground">Cargando optimizador...</div>
      </div>
    );
  }

  const currentParams = selectedPreset?.fsrsParameters?.length
    ? selectedPreset.fsrsParameters
    : DEFAULT_W;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Cpu className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Optimizador FSRS</h1>
          <p className="text-sm text-muted-foreground">
            Entrena parámetros personalizados a partir de tu historial de repasos
          </p>
        </div>
      </div>

      {/* Availability check */}
      {!availability.available && (
        <Card className="border-destructive">
          <CardContent className="space-y-3 py-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <span className="text-destructive">{availability.reason}</span>
            </div>
            <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Cómo probar el optimizador</p>
              <p>
                En esta computadora funciona con <code>http://localhost:3030</code>. En iPad o Safari por IP local
                necesitas abrir RecallForge con <strong>HTTPS</strong> o usar un preview desplegado.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preset selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Preset de Programación</CardTitle>
          <CardDescription>
            Selecciona el preset cuyos parámetros quieres optimizar
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <Button
                key={p.id}
                variant={selectedPresetId === p.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedPresetId(p.id)}
              >
                {p.name}
              </Button>
            ))}
          </div>

          {selectedPreset && (
            <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Retención deseada</span>
                <span className="font-mono">{(selectedPreset.desiredRetention * 100).toFixed(0)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Parámetros</span>
                <Badge variant={selectedPreset.fsrsParameters.length > 0 ? 'default' : 'secondary'}>
                  {selectedPreset.fsrsParameters.length > 0 ? 'Personalizados' : 'Por defecto'}
                </Badge>
              </div>
              {selectedPreset.optimizerMetadata &&
                typeof selectedPreset.optimizerMetadata === 'object' &&
                'lastOptimizedAt' in selectedPreset.optimizerMetadata && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Última optimización</span>
                    <span className="text-xs">
                      {new Date(selectedPreset.optimizerMetadata.lastOptimizedAt as string).toLocaleDateString('es-ES', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Current parameters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Parámetros Actuales (W)</CardTitle>
            {selectedPreset?.fsrsParameters?.length ? (
              <Button variant="ghost" size="sm" onClick={handleReset}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Restablecer
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1.5 font-mono text-xs">
            {currentParams.map((w, i) => (
              <div
                key={i}
                className="rounded bg-muted px-1.5 py-1 text-center"
                title={`W[${i}]`}
              >
                {w.toFixed(4)}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Run optimizer */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ejecutar Optimización</CardTitle>
          <CardDescription>
            Analiza tu historial de repasos y calcula los parámetros FSRS óptimos para ti.
            Se necesitan al menos 100 repasos en 10+ tarjetas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Progress */}
          {running && progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{progress.message}</span>
                {progress.phase === 'training' && progress.itemsTotal > 0 && (
                  <span className="font-mono text-xs">
                    {progress.itemsProcessed}/{progress.itemsTotal}
                  </span>
                )}
              </div>
              <Progress
                value={
                  progress.phase === 'extracting'
                    ? 10
                    : progress.phase === 'converting'
                      ? 30
                      : progress.phase === 'training'
                        ? progress.itemsTotal > 0
                          ? 30 + (progress.itemsProcessed / progress.itemsTotal) * 60
                          : 50
                        : 100
                }
              />
            </div>
          )}

          {/* Trigger button */}
          <Button
            onClick={handleOptimize}
            disabled={running || !availability.available || !selectedPreset}
            className="w-full gap-2"
          >
            {running ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Entrenando...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Optimizar Parámetros
              </>
            )}
          </Button>

          {/* Result (pending apply/discard) */}
          {result && !result.applied && !result.discardedAt && (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="font-medium">Optimización Completada</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <FileStack className="h-4 w-4 text-muted-foreground" />
                  <span>{result.reviewLogCount.toLocaleString()} repasos analizados</span>
                </div>
                <div className="flex items-center gap-2">
                  <FileStack className="h-4 w-4 text-muted-foreground" />
                  <span>{result.cardCount.toLocaleString()} tarjetas</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>{(result.trainingTimeMs / 1000).toFixed(1)}s entrenamiento</span>
                </div>
              </div>

              {/* Parameter comparison */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Nuevos parámetros (W)</p>
                <div className="grid grid-cols-7 gap-1.5 font-mono text-xs">
                  {result.optimizedParameters.map((w, i) => {
                    const prev = result.previousParameters[i] ?? 0;
                    const diff = w - prev;
                    return (
                      <div
                        key={i}
                        className={`rounded px-1.5 py-1 text-center ${
                          Math.abs(diff) > 0.1
                            ? diff > 0
                              ? 'bg-green-100 dark:bg-green-900/30'
                              : 'bg-red-100 dark:bg-red-900/30'
                            : 'bg-muted'
                        }`}
                        title={`W[${i}]: ${prev.toFixed(4)} → ${w.toFixed(4)} (${diff >= 0 ? '+' : ''}${diff.toFixed(4)})`}
                      >
                        {w.toFixed(4)}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  className="flex-1 gap-1"
                  onClick={() => handleApply(result.id)}
                >
                  <Check className="h-4 w-4" />
                  Aplicar
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 gap-1"
                  onClick={() => handleDiscard(result.id)}
                >
                  <X className="h-4 w-4" />
                  Descartar
                </Button>
              </div>
            </div>
          )}

          {/* Info note */}
          <div className="flex items-start gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3 text-xs text-muted-foreground">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
            <div className="space-y-1">
              <p>
                La optimización usa <strong>fsrs-browser</strong> (WASM), el mismo motor que Anki.
                Entrena los {DEFAULT_W.length} parámetros W del modelo FSRS-6.0 a partir de tus repasos reales.
              </p>
              <p>Cuantos más repasos tengas, mejor será la personalización.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Optimization history */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Historial de Optimizaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {history.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {new Date(run.createdAt).toLocaleDateString('es-ES', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {run.applied && (
                        <Badge variant="default" className="text-xs">Aplicado</Badge>
                      )}
                      {run.discardedAt && (
                        <Badge variant="secondary" className="text-xs">Descartado</Badge>
                      )}
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>{run.reviewLogCount.toLocaleString()} repasos</span>
                      <span>{run.cardCount.toLocaleString()} tarjetas</span>
                      <span>{(run.trainingTimeMs / 1000).toFixed(1)}s</span>
                    </div>
                  </div>

                  <div className="flex gap-1">
                    {!run.applied && !run.discardedAt && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleApply(run.id)}
                          title="Aplicar"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDiscard(run.id)}
                          title="Descartar"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
