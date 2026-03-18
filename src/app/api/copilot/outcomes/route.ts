export const dynamic = 'force-dynamic';

// POST /api/copilot/outcomes — Record copilot outcomes

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { recordOutcome } from '@/lib/server/copilot-service';
import { logger } from '@/lib/server/logger';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';
import { recordRouteObservation } from '@/lib/server/observability';

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'copilot/outcomes' });
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) {
    recordRouteObservation({
      route: 'copilot/outcomes',
      method: 'POST',
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const response = NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    recordRouteObservation({
      route: 'copilot/outcomes',
      method: 'POST',
      status: response.status,
      durationMs: Date.now() - startedAt,
      requestId: context.requestId,
      userId: user.id,
      deviceId: context.deviceId,
      operationId: context.operationId,
      errorMessage: 'Invalid JSON body',
    });
    return withRequestContext(response, context);
  }
  const { actionType, actionTaken, ...rest } = body as {
    recommendationId?: string;
    actionType: string;
    actionTaken: boolean;
    executedAt?: string;
    resultSummary?: string;
    cardsImported?: number;
    cardsStudied?: number;
    riskDelta?: number;
    masteryDelta?: number;
    userDismissed?: boolean;
    payload?: Record<string, unknown>;
  };

  if (!actionType) {
    const response = NextResponse.json({ error: 'actionType is required' }, { status: 400 });
    recordRouteObservation({
      route: 'copilot/outcomes',
      method: 'POST',
      status: response.status,
      durationMs: Date.now() - startedAt,
      requestId: context.requestId,
      userId: user.id,
      deviceId: context.deviceId,
      operationId: context.operationId,
      errorMessage: 'actionType is required',
    });
    return withRequestContext(response, context);
  }
  if (typeof actionTaken !== 'boolean') {
    const response = NextResponse.json({ error: 'actionTaken (boolean) is required' }, { status: 400 });
    recordRouteObservation({
      route: 'copilot/outcomes',
      method: 'POST',
      status: response.status,
      durationMs: Date.now() - startedAt,
      requestId: context.requestId,
      userId: user.id,
      deviceId: context.deviceId,
      operationId: context.operationId,
      errorMessage: 'actionTaken is required',
    });
    return withRequestContext(response, context);
  }

  const outcome = recordOutcome(user.id, { actionType, actionTaken, ...rest });
  log.info('Copilot outcome recorded', { userId: user.id, actionType, actionTaken });

  const response = NextResponse.json({
    ok: true,
    userId: user.id,
    timestamp: new Date().toISOString(),
    outcome,
  });
  recordRouteObservation({
    route: 'copilot/outcomes',
    method: 'POST',
    status: response.status,
    durationMs: Date.now() - startedAt,
    requestId: context.requestId,
    userId: user.id,
    deviceId: context.deviceId,
    operationId: context.operationId,
  });
  return withRequestContext(response, context);
}
