export const dynamic = 'force-dynamic';

// GET /api/copilot/history — Copilot activity history

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { getCopilotHistory } from '@/lib/server/copilot-service';
import { logger } from '@/lib/server/logger';

export async function GET(req: NextRequest) {
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { user } = authResult;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

  const history = getCopilotHistory(user.id, limit);
  logger.info(`[copilot/history] user=${user.id} events=${history.length}`);

  return NextResponse.json({
    ok: true,
    userId: user.id,
    timestamp: new Date().toISOString(),
    events: history,
    count: history.length,
  });
}
