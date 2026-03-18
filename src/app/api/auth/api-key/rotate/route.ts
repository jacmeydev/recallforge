export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/server/auth';
import { serverDb } from '@/lib/server/db';
import { users } from '@/lib/server/db/schema';
import { createApiKey, getApiKeyPreview, hashApiKey } from '@/lib/server/api-keys';
import { logger } from '@/lib/server/logger';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';

export async function POST(req: NextRequest) {
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'auth/api-key/rotate' });
  const session = await auth();

  if (!session?.user?.id) {
    return withRequestContext(
      NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
      context
    );
  }

  const userId = session.user.id;
  const nextApiKey = createApiKey();
  const rotatedAt = new Date().toISOString();

  await serverDb
    .update(users)
    .set({
      apiKey: null,
      apiKeyHash: hashApiKey(nextApiKey),
      apiKeyPreview: getApiKeyPreview(nextApiKey),
      apiKeyLastRotatedAt: rotatedAt,
      updatedAt: rotatedAt,
    })
    .where(eq(users.id, userId));

  log.info('API key rotated', { userId });

  return withRequestContext(
    NextResponse.json({
      apiKey: nextApiKey,
      apiKeyPreview: getApiKeyPreview(nextApiKey),
      apiKeyLastRotatedAt: rotatedAt,
    }),
    context
  );
}
