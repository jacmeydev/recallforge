export const dynamic = 'force-dynamic';

// GET /api/copilot/brief — Daily copilot brief

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { generateBrief } from '@/lib/server/copilot-service';
import { logger } from '@/lib/server/logger';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';
import { recordRouteObservation } from '@/lib/server/observability';

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'copilot/brief' });
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) {
    recordRouteObservation({
      route: 'copilot/brief',
      method: 'GET',
      status: authResult.error.status,
      durationMs: Date.now() - startedAt,
      requestId: context.requestId,
      deviceId: context.deviceId,
      operationId: context.operationId,
      errorMessage: 'Authentication required',
    });
    return withRequestContext(authResult.error, context);
  }
  const { user } = authResult;

  const brief = generateBrief(user.id);
  log.info('Copilot brief generated', {
    userId: user.id,
    actions: brief.actions.length,
    overdue: brief.stats.overdueCards,
    draftsPending: brief.stats.draftsPending,
  });

  const response = NextResponse.json({
    ok: true,
    userId: user.id,
    timestamp: new Date().toISOString(),
    ...brief,
  });

  recordRouteObservation({
    route: 'copilot/brief',
    method: 'GET',
    status: response.status,
    durationMs: Date.now() - startedAt,
    requestId: context.requestId,
    userId: user.id,
    deviceId: context.deviceId,
    operationId: context.operationId,
  });

  return withRequestContext(response, context);
}
