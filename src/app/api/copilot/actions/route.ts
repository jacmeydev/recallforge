export const dynamic = 'force-dynamic';

// GET /api/copilot/actions — Actionable suggestions

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { getActions } from '@/lib/server/copilot-service';
import { logger } from '@/lib/server/logger';

export async function GET(req: NextRequest) {
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { user } = authResult;

  const actions = getActions(user.id);
  logger.info(`[copilot/actions] user=${user.id} count=${actions.length}`);

  return NextResponse.json({
    ok: true,
    userId: user.id,
    timestamp: new Date().toISOString(),
    actions,
  });
}
