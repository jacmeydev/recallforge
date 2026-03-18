export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/server/auth';
import { deleteUserData } from '@/lib/server/account-data';
import { logger } from '@/lib/server/logger';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';

export async function DELETE(req: NextRequest) {
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'auth/account/data#delete' });
  const session = await auth();

  if (!session?.user?.id) {
    return withRequestContext(
      NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
      context
    );
  }

  const userId = session.user.id;

  try {
    const summary = deleteUserData(userId);

    log.info('Server account data deleted', { userId, deleted: summary.deleted });

    return withRequestContext(
      NextResponse.json({
        success: true,
        preservedAccount: true,
        deleted: summary.deleted,
      }),
      context
    );
  } catch (error) {
    log.error('Failed to delete server account data', {
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return withRequestContext(
      NextResponse.json({ error: 'Failed to delete server data' }, { status: 500 }),
      context
    );
  }
}
