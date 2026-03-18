export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Agent API: Study Plan
// ============================================================================
// GET /api/agent/study-plan?maxMinutes=60
// Generates a structured study plan for today.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { getStudyPlan } from '@/lib/server/agent-service';
import { logger } from '@/lib/server/logger';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';
import { recordRouteObservation } from '@/lib/server/observability';

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'agent/study-plan' });
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) {
    recordRouteObservation({
      route: 'agent/study-plan',
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

  const { searchParams } = new URL(req.url);
  const maxMinutes = Math.min(
    Math.max(parseInt(searchParams.get('maxMinutes') || '60', 10) || 60, 5),
    480
  );

  const plan = getStudyPlan(user.id, maxMinutes);
  log.info('Study plan generated', {
    userId: user.id,
    entries: plan.entries.length,
    totalMinutes: plan.totalMinutes,
    totalCards: plan.totalCards,
  });

  const response = NextResponse.json({
    ok: true,
    userId: user.id,
    timestamp: new Date().toISOString(),
    maxMinutes,
    ...plan,
  });

  recordRouteObservation({
    route: 'agent/study-plan',
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
