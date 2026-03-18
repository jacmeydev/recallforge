export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Agent API: Recommendations
// ============================================================================
// GET /api/agent/recommendations
// Returns smart study recommendations for the authenticated user.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { getRecommendations } from '@/lib/server/agent-service';
import { logger } from '@/lib/server/logger';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';
import { recordRouteObservation } from '@/lib/server/observability';

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'agent/recommendations' });
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) {
    recordRouteObservation({
      route: 'agent/recommendations',
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

  const recommendations = getRecommendations(user.id);
  log.info('Recommendations generated', { userId: user.id, count: recommendations.length });

  const response = NextResponse.json({
    ok: true,
    userId: user.id,
    timestamp: new Date().toISOString(),
    recommendations,
  });

  recordRouteObservation({
    route: 'agent/recommendations',
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
