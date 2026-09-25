// ============================================================================
// RecallForge — Per-user study settings
// ============================================================================

import { z } from 'zod';
import { getDb, nowIso } from './db';
import { badRequest, notFound } from './errors';
import { isValidTimezone } from './time';
import type { StudySettings } from './types';

export const DEFAULT_SETTINGS: StudySettings = {
  desiredRetention: 0.9,
  newCardsPerDay: 20,
  maxReviewsPerDay: 200,
  maximumInterval: 36500,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  dayStartHour: 4,
  learnAheadMinutes: 20,
  enableFuzz: true,
  fsrsWeights: [],
};

const step = z.string().regex(/^\d+(\.\d+)?[mhd]$/, 'Steps look like "1m", "10m", "1h" or "1d"');

export const SettingsPatchSchema = z
  .object({
    desiredRetention: z.number().min(0.7).max(0.99),
    newCardsPerDay: z.number().int().min(0).max(9999),
    maxReviewsPerDay: z.number().int().min(0).max(99999),
    maximumInterval: z.number().int().min(1).max(36500),
    learningSteps: z.array(step).max(10),
    relearningSteps: z.array(step).max(10),
    dayStartHour: z.number().int().min(0).max(23),
    learnAheadMinutes: z.number().int().min(0).max(1440),
    enableFuzz: z.boolean(),
    fsrsWeights: z.array(z.number()).max(21),
    timezone: z.string().refine(isValidTimezone, 'Unknown IANA timezone'),
  })
  .partial()
  .strict();

export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export interface UserSettings extends StudySettings {
  timezone: string;
}

function parseStored(raw: string | null | undefined): StudySettings {
  let stored: unknown = {};
  try {
    stored = raw ? JSON.parse(raw) : {};
  } catch {
    stored = {};
  }
  const parsed = SettingsPatchSchema.omit({ timezone: true }).safeParse(stored);
  return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

export function getSettings(userId: string): UserSettings {
  const row = getDb().prepare(`SELECT settings, timezone FROM users WHERE id = ?`).get(userId) as
    | { settings: string; timezone: string }
    | undefined;
  if (!row) throw notFound('User', userId);
  return { ...parseStored(row.settings), timezone: row.timezone || 'UTC' };
}

export function updateSettings(userId: string, patch: unknown): UserSettings {
  const parsed = SettingsPatchSchema.safeParse(patch);
  if (!parsed.success) throw badRequest('Invalid settings', parsed.error.issues);
  const { timezone, ...study } = parsed.data;
  const current = getSettings(userId);
  const { timezone: currentTimezone, ...currentStudy } = current;
  const next = { ...currentStudy, ...study };

  getDb()
    .prepare(`UPDATE users SET settings = ?, timezone = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(next), timezone ?? currentTimezone, nowIso(), userId);
  return { ...next, timezone: timezone ?? currentTimezone };
}
