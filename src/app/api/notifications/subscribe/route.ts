export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Push Subscription API (Phase 7)
// POST: Save subscription | DELETE: Remove subscription
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { runMigrations } from '@/lib/server/db/migrate';
import { savePushSubscription, removePushSubscription } from '@/lib/server/notification-service';

let migrated = false;
function ensureMigrated() {
  if (!migrated) {
    runMigrations();
    migrated = true;
  }
}

export async function POST(req: NextRequest) {
  ensureMigrated();
  const auth = await authenticateRequest(req);
  if ('error' in auth) return auth.error;

  const body = await req.json();
  const { endpoint, keys } = body;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription data' }, { status: 400 });
  }

  const sub = savePushSubscription(auth.user.id, endpoint, keys.p256dh, keys.auth);
  return NextResponse.json({ id: sub.id, createdAt: sub.createdAt });
}

export async function DELETE(req: NextRequest) {
  ensureMigrated();
  const auth = await authenticateRequest(req);
  if ('error' in auth) return auth.error;

  const body = await req.json();
  if (!body.endpoint) {
    return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  }

  removePushSubscription(auth.user.id, body.endpoint);
  return NextResponse.json({ ok: true });
}
