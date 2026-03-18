export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Agent API: Academic Summary
// ============================================================================
// GET /api/agent/academic-summary
// Full academic overview: cards, activity, subjects, gamification.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { getAcademicSummary } from '@/lib/server/agent-service';
import { logger } from '@/lib/server/logger';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';
import { recordRouteObservation } from '@/lib/server/observability';

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'agent/academic-summary' });
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) {
    recordRouteObservation({
      route: 'agent/academic-summary',
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

  const summary = getAcademicSummary(user.id);
  log.info('Academic summary generated', {
    userId: user.id,
    cards: summary.cards.total,
    subjects: summary.subjects.length,
    modules: summary.modules.length,
    topics: summary.topics.length,
  });

  const response = NextResponse.json({
    ok: true,
    ...summary,
  });

  recordRouteObservation({
    route: 'agent/academic-summary',
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
