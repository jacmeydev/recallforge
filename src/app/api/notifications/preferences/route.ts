export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Notification Preferences API (Phase 7)
// GET: Get preferences | PUT: Update preferences
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { runMigrations } from '@/lib/server/db/migrate';
import {
  getNotificationPreferences,
  upsertNotificationPreferences,
} from '@/lib/server/notification-service';

let migrated = false;
function ensureMigrated() {
  if (!migrated) {
    runMigrations();
    migrated = true;
  }
}

export async function GET(req: NextRequest) {
  ensureMigrated();
  const auth = await authenticateRequest(req);
  if ('error' in auth) return auth.error;

  const prefs = getNotificationPreferences(auth.user.id);

  // Return defaults if no preferences exist yet
  if (!prefs) {
    return NextResponse.json({
      enabled: true,
      studyReminders: true,
      streakAlerts: true,
      dailySummary: false,
      quietStart: '22:00',
      quietEnd: '08:00',
      reminderTime: '09:00',
    });
  }

  return NextResponse.json({
    enabled: prefs.enabled,
    studyReminders: prefs.studyReminders,
    streakAlerts: prefs.streakAlerts,
    dailySummary: prefs.dailySummary,
    quietStart: prefs.quietStart,
    quietEnd: prefs.quietEnd,
    reminderTime: prefs.reminderTime,
  });
}

export async function PUT(req: NextRequest) {
  ensureMigrated();
  const auth = await authenticateRequest(req);
  if ('error' in auth) return auth.error;

  const body = await req.json();
  const allowed = ['enabled', 'studyReminders', 'streakAlerts', 'dailySummary', 'quietStart', 'quietEnd', 'reminderTime'];
  const update: Record<string, unknown> = {};

  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key];
  }

  // Validate time formats
  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const key of ['quietStart', 'quietEnd', 'reminderTime']) {
    if (update[key] && typeof update[key] === 'string' && !timeRegex.test(update[key] as string)) {
      return NextResponse.json({ error: `Invalid time format for ${key}` }, { status: 400 });
    }
  }

  const prefs = upsertNotificationPreferences(auth.user.id, update);

  return NextResponse.json({
    enabled: prefs.enabled,
    studyReminders: prefs.studyReminders,
    streakAlerts: prefs.streakAlerts,
    dailySummary: prefs.dailySummary,
    quietStart: prefs.quietStart,
    quietEnd: prefs.quietEnd,
    reminderTime: prefs.reminderTime,
  });
}
