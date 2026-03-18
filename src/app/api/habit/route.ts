export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Habit Data API (Phase 7)
// GET: Get daily habit & streak data
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { runMigrations } from '@/lib/server/db/migrate';
import { getHabitData } from '@/lib/server/notification-service';

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

  const habit = getHabitData(auth.user.id);
  return NextResponse.json(habit);
}
