export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Agent API: Academic Coverage & Risk
// ============================================================================
// GET /api/agent/coverage
// Clear operational snapshot for curriculum coverage and academic risk.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { getAcademicCoverage } from '@/lib/server/agent-service';
import { logger } from '@/lib/server/logger';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';
import { recordRouteObservation } from '@/lib/server/observability';

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'agent/coverage' });
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) {
    recordRouteObservation({
      route: 'agent/coverage',
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

  const coverage = getAcademicCoverage(user.id);
  log.info('Academic coverage snapshot generated', {
    userId: user.id,
    totalCards: coverage.overall.totalCards,
    linkedPercent: coverage.overall.curriculumLinkedPercent,
    highRiskCards: coverage.overall.highRiskCards,
  });

  const response = NextResponse.json({
    ok: true,
    ...coverage,
  });

  recordRouteObservation({
    route: 'agent/coverage',
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
