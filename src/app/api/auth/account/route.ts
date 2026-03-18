export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Account API
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/server/auth';
import { serverDb } from '@/lib/server/db';
import { users } from '@/lib/server/db/schema';
import { logger } from '@/lib/server/logger';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';
import { deleteUserAccount } from '@/lib/server/account-data';

export async function GET(req: NextRequest) {
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'auth/account#get' });
  const session = await auth();
  if (!session?.user?.id) {
    return withRequestContext(
      NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
      context
    );
  }

  const [user] = await serverDb
    .select({
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      apiKeyPreview: users.apiKeyPreview,
      apiKeyLastRotatedAt: users.apiKeyLastRotatedAt,
      apiKeyHash: users.apiKeyHash,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user) {
    return withRequestContext(
      NextResponse.json({ error: 'User not found' }, { status: 404 }),
      context
    );
  }

  log.info('Account metadata requested', { userId: session.user.id });

  return withRequestContext(NextResponse.json({
    email: user.email,
    name: user.name,
    hasApiKey: Boolean(user.apiKeyHash),
    apiKeyPreview: user.apiKeyPreview,
    apiKeyLastRotatedAt: user.apiKeyLastRotatedAt,
    createdAt: user.createdAt,
  }), context);
}

export async function DELETE(req: NextRequest) {
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'auth/account#delete' });
  const session = await auth();
  if (!session?.user?.id) {
    return withRequestContext(
      NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
      context
    );
  }

  const userId = session.user.id;

  try {
    const summary = deleteUserAccount(userId);

    log.info('Account deleted', { userId, deleted: summary.deleted });
    return withRequestContext(NextResponse.json({ success: true, deleted: summary.deleted }), context);
  } catch (error) {
    log.error('Failed to delete account', {
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return withRequestContext(
      NextResponse.json(
        { error: 'Failed to delete account' },
        { status: 500 }
      ),
      context
    );
  }
}
