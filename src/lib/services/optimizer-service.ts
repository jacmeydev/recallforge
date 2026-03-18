// ============================================================================
// RecallForge — FSRS Optimizer Service
// ============================================================================
// Uses fsrs-browser (WASM port of fsrs-rs) to train personalized FSRS
// parameters from the user's review history. This is the real optimizer,
// not a placeholder.
//
// LIBRARY DECISION RECORD:
// ────────────────────────────────────────────────────────────────────────
// Library:   fsrs-browser v5.2.0
// Purpose:   Train FSRS parameters (the W weights) from user review logs
// Why:       Official WASM port of fsrs-rs (the same optimizer Anki uses).
//            Runs entirely in the browser — no server needed. Compatible
//            with our local-first architecture (Dexie + IndexedDB).
// Alt:       @open-spaced-repetition/binding (Node-only, not browser)
//            py-fsrs/fsrs-rs (external service, not needed yet)
//            Manual implementation (violates ecosystem reuse rule)
// Limits:    Requires SharedArrayBuffer → Cross-Origin-Isolation headers
//            (COOP/COEP). WASM binary is ~1.6 MB. Training large datasets
//            (>100k reviews) may take several seconds.
// Runs in:   Browser only (WASM + Web Worker for non-blocking training)
// ============================================================================

import { db } from '@/lib/db';
import { generateId, now } from '@/lib/utils';
import { EventEmitters } from '@/lib/events';
import type {
  ReviewLog,
  Card,
  SchedulingPreset,
  OptimizationRun,
  JSONObject,
} from '@/types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FSRSReview {
  rating: number;  // 1=Again, 2=Hard, 3=Good, 4=Easy
  delta_t: number; // days since last review (0 for first)
}

interface FSRSItem {
  reviews: FSRSReview[];
}

export interface OptimizerProgress {
  itemsProcessed: number;
  itemsTotal: number;
  phase: 'extracting' | 'converting' | 'training' | 'done' | 'error';
  message?: string;
}

export interface OptimizerResult {
  parameters: number[];
  reviewLogCount: number;
  cardCount: number;
  trainingTimeMs: number;
}

interface FsrsBrowserModule {
  default: () => Promise<unknown>;
  Fsrs: new () => {
    computeParameters(
      ratings: Uint32Array,
      deltats: Uint32Array,
      lengths: Uint32Array,
      progress: null,
      enableShortTerm: boolean,
    ): Float32Array;
    free(): void;
  };
}

const FSRS_BROWSER_ASSET_PATH = '/vendor/fsrs-browser/fsrs_browser.js';
let fsrsBrowserModulePromise: Promise<FsrsBrowserModule> | null = null;

function getFsrsBrowserModuleUrl(): string {
  if (typeof window === 'undefined') {
    throw new Error('fsrs-browser solo puede cargarse en el navegador');
  }
  return new URL(FSRS_BROWSER_ASSET_PATH, window.location.origin).toString();
}

async function loadFsrsBrowserModule(): Promise<FsrsBrowserModule> {
  if (!fsrsBrowserModulePromise) {
    fsrsBrowserModulePromise = (async () => {
      const moduleUrl = getFsrsBrowserModuleUrl();
      const mod = await import(/* webpackIgnore: true */ moduleUrl) as FsrsBrowserModule;
      await mod.default();
      return mod;
    })().catch((error) => {
      fsrsBrowserModulePromise = null;
      throw error;
    });
  }

  return fsrsBrowserModulePromise;
}

// ─── Review log → FSRSItem conversion ───────────────────────────────────────

const RATING_MAP: Record<string, number> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

/**
 * Converts review logs grouped by card into FSRSItem format.
 * Each card with N reviews produces N-1 FSRSItems (cumulative windows).
 * This matches the format fsrs-rs/fsrs-browser expects for training.
 */
export function convertReviewLogsToFSRSItems(
  logsByCard: Map<string, ReviewLog[]>
): FSRSItem[] {
  const items: FSRSItem[] = [];

  for (const [, logs] of logsByCard) {
    if (logs.length < 2) continue; // Need at least 2 reviews for training

    // Sort chronologically
    const sorted = logs.sort(
      (a, b) => new Date(a.reviewedAt).getTime() - new Date(b.reviewedAt).getTime()
    );

    // Build reviews array with delta_t in days
    const reviews: FSRSReview[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const log = sorted[i];
      const rating = RATING_MAP[log.rating] || 3;

      let delta_t = 0;
      if (i > 0) {
        const prev = new Date(sorted[i - 1].reviewedAt);
        const curr = new Date(log.reviewedAt);
        delta_t = Math.max(0, Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)));
      }

      reviews.push({ rating, delta_t });
    }

    // Create cumulative items: [r1,r2], [r1,r2,r3], etc.
    for (let len = 2; len <= reviews.length; len++) {
      items.push({ reviews: reviews.slice(0, len) });
    }
  }

  return items;
}

/**
 * Serialize FSRSItems into flat arrays for fsrs-browser's computeParameters.
 */
export function serializeFSRSItems(items: FSRSItem[]): {
  ratings: Uint32Array;
  deltats: Uint32Array;
  lengths: Uint32Array;
} {
  const lengths = new Uint32Array(items.map((item) => item.reviews.length));
  const ratings = new Uint32Array(
    items.flatMap((item) => item.reviews.map((r) => r.rating))
  );
  const deltats = new Uint32Array(
    items.flatMap((item) => item.reviews.map((r) => r.delta_t))
  );
  return { ratings, deltats, lengths };
}

// ─── Extract review data from DB ────────────────────────────────────────────

export async function extractReviewData(userId: string): Promise<{
  logsByCard: Map<string, ReviewLog[]>;
  totalLogs: number;
  totalCards: number;
}> {
  const allLogs = await db.reviewLogs
    .where('userId')
    .equals(userId)
    .toArray();

  // Filter out manual reschedules
  const logs = allLogs.filter((l) => !l.wasManualReschedule);

  // Group by cardId
  const logsByCard = new Map<string, ReviewLog[]>();
  for (const log of logs) {
    const existing = logsByCard.get(log.cardId) || [];
    existing.push(log);
    logsByCard.set(log.cardId, existing);
  }

  return {
    logsByCard,
    totalLogs: logs.length,
    totalCards: logsByCard.size,
  };
}

// ─── Check if optimizer can run ─────────────────────────────────────────────

export function isOptimizerAvailable(): {
  available: boolean;
  reason?: string;
} {
  if (typeof window === 'undefined') {
    return { available: false, reason: 'Solo funciona en el navegador' };
  }
  if (!window.isSecureContext) {
    const host = window.location.hostname;
    const usingLocalhost =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.localhost');
    return {
      available: false,
      reason: usingLocalhost
        ? 'El navegador no está en un contexto seguro. Abre RecallForge desde un origen HTTPS o reinicia el entorno local.'
        : `Este navegador está entrando por ${window.location.origin}, que no es un contexto seguro para SharedArrayBuffer. En iPad/Safari sobre red local usa HTTPS o un preview desplegado.`,
    };
  }
  if (!('crossOriginIsolated' in window) || !crossOriginIsolated) {
    return {
      available: false,
      reason: 'Falta Cross-Origin Isolation (COOP/COEP) para SharedArrayBuffer. Reinicia el servidor y verifica que los headers de aislamiento estén presentes.',
    };
  }
  return { available: true };
}

// ─── Run optimizer (main entry point) ───────────────────────────────────────

export async function runOptimizer(
  userId: string,
  presetId: string,
  onProgress?: (progress: OptimizerProgress) => void,
  enableShortTerm: boolean = true,
): Promise<OptimizerResult> {
  const report = (progress: OptimizerProgress) => onProgress?.(progress);

  // Phase 1: Extract
  report({ itemsProcessed: 0, itemsTotal: 0, phase: 'extracting', message: 'Extrayendo historial de repasos...' });
  const { logsByCard, totalLogs, totalCards } = await extractReviewData(userId);

  if (totalLogs < 100) {
    throw new Error(`Se necesitan al menos 100 repasos para optimizar (tienes ${totalLogs}). Sigue estudiando.`);
  }

  const cardsWithEnoughData = [...logsByCard.entries()].filter(([, logs]) => logs.length >= 2).length;
  if (cardsWithEnoughData < 10) {
    throw new Error(`Se necesitan al menos 10 tarjetas con 2+ repasos (tienes ${cardsWithEnoughData}).`);
  }

  // Phase 2: Convert
  report({ itemsProcessed: 0, itemsTotal: 0, phase: 'converting', message: 'Convirtiendo a formato FSRS...' });
  const items = convertReviewLogsToFSRSItems(logsByCard);
  const { ratings, deltats, lengths } = serializeFSRSItems(items);

  // Phase 3: Train via fsrs-browser WASM
  report({ itemsProcessed: 0, itemsTotal: items.length, phase: 'training', message: 'Entrenando parámetros FSRS...' });

  const startTime = performance.now();

  // Load fsrs-browser from public assets so webpack does not bundle its
  // wasm-bindgen worker graph into the app chunk runtime.
  const { Fsrs } = await loadFsrsBrowserModule();

  const fsrs = new Fsrs();
  let parameters: Float32Array;
  try {
    parameters = fsrs.computeParameters(
      ratings,
      deltats,
      lengths,
      null, // progress — we handle our own
      enableShortTerm,
    );
  } finally {
    fsrs.free();
  }

  const trainingTimeMs = Math.round(performance.now() - startTime);

  report({ itemsProcessed: items.length, itemsTotal: items.length, phase: 'done', message: `Optimización completada en ${(trainingTimeMs / 1000).toFixed(1)}s` });

  return {
    parameters: Array.from(parameters),
    reviewLogCount: totalLogs,
    cardCount: totalCards,
    trainingTimeMs,
  };
}

// ─── Save optimization result ───────────────────────────────────────────────

export async function saveOptimizationRun(
  userId: string,
  presetId: string,
  result: OptimizerResult,
  previousParameters: number[],
  previousRetention: number,
): Promise<OptimizationRun> {
  const run: OptimizationRun = {
    id: generateId(),
    userId,
    presetId,
    previousParameters,
    optimizedParameters: result.parameters,
    previousRetention,
    reviewLogCount: result.reviewLogCount,
    cardCount: result.cardCount,
    trainingTimeMs: result.trainingTimeMs,
    applied: false,
    createdAt: now(),
  };

  await db.optimizationRuns.add(run);
  return run;
}

// ─── Apply optimized parameters to preset ───────────────────────────────────

export async function applyOptimizedParameters(
  userId: string,
  runId: string,
): Promise<void> {
  const run = await db.optimizationRuns.get(runId);
  if (!run) throw new Error('Optimización no encontrada');

  const preset = await db.presets.get(run.presetId);
  if (!preset) throw new Error('Preset no encontrado');

  // Update preset with new parameters
  await db.presets.update(run.presetId, {
    fsrsParameters: run.optimizedParameters,
    optimizerMetadata: {
      lastOptimizedAt: now(),
      optimizationRunId: runId,
      reviewLogCount: run.reviewLogCount,
      cardCount: run.cardCount,
      trainingTimeMs: run.trainingTimeMs,
    },
    updatedAt: now(),
  });

  // Mark this run as applied
  await db.optimizationRuns.update(runId, { applied: true });

  // Emit event
  await EventEmitters.optimizerRun(userId, run.presetId, {
    runId,
    parametersCount: run.optimizedParameters.length,
    reviewLogCount: run.reviewLogCount,
  } as unknown as JSONObject);
}

// ─── Discard optimization result ────────────────────────────────────────────

export async function discardOptimizationRun(runId: string): Promise<void> {
  await db.optimizationRuns.update(runId, { discardedAt: now() });
}

// ─── Get optimization history ───────────────────────────────────────────────

export async function getOptimizationHistory(
  userId: string,
  presetId?: string,
): Promise<OptimizationRun[]> {
  let runs: OptimizationRun[];
  if (presetId) {
    runs = await db.optimizationRuns
      .where('[userId+presetId]')
      .equals([userId, presetId])
      .toArray();
  } else {
    runs = await db.optimizationRuns
      .where('userId')
      .equals(userId)
      .toArray();
  }
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── Get latest applied run for preset ──────────────────────────────────────

export async function getLatestAppliedRun(
  userId: string,
  presetId: string,
): Promise<OptimizationRun | undefined> {
  const runs = await db.optimizationRuns
    .where('[userId+presetId]')
    .equals([userId, presetId])
    .filter((r) => r.applied)
    .toArray();

  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

// ─── Reset to default parameters ────────────────────────────────────────────

export async function resetToDefaultParameters(
  userId: string,
  presetId: string,
): Promise<void> {
  await db.presets.update(presetId, {
    fsrsParameters: [],
    optimizerMetadata: {},
    updatedAt: now(),
  });
}
