export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { emitAgentEvent } from '@/lib/server/agent-service';
import { logger } from '@/lib/server/logger';
import { recordRouteObservation } from '@/lib/server/observability';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';
import { OpenClawImprovementDraftBatchSchema } from '@/lib/validation/copilot-draft-schema';
import { createOpenClawImprovementDrafts } from '@/lib/server/openclaw-review-service';

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'openclaw/improvement-drafts' });
  const authResult = await authenticateRequest(req);

  if ('error' in authResult) {
    recordRouteObservation({
      route: 'openclaw/improvement-drafts',
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
      route: 'openclaw/improvement-drafts',
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

  const parsed = OpenClawImprovementDraftBatchSchema.safeParse(body);
  if (!parsed.success) {
    const response = NextResponse.json({
      error: 'Invalid OpenClaw improvement payload',
      validationErrors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    }, { status: 400 });
    recordRouteObservation({
      route: 'openclaw/improvement-drafts',
      method: 'POST',
      status: response.status,
      durationMs: Date.now() - startedAt,
      requestId: context.requestId,
      userId: user.id,
      deviceId: context.deviceId,
      operationId: context.operationId,
      errorMessage: 'Invalid OpenClaw improvement payload',
    });
    return withRequestContext(response, context);
  }

  const agentId = parsed.data.agentId || 'openclaw';
  const result = createOpenClawImprovementDrafts(user.id, parsed.data.proposals, agentId);

  emitAgentEvent(user.id, 'openclaw_improvement_drafts_received', 'openclaw', context.requestId, {
    requestId: context.requestId,
    agentId,
    requested: parsed.data.proposals.length,
    created: result.created,
    notFound: result.notFound,
  }, 'openclaw');
  log.metric('openclaw_improvement_drafts_received', result.created, {
    userId: user.id,
    requested: parsed.data.proposals.length,
    notFound: result.notFound.length,
  });

  const response = NextResponse.json({
    ok: true,
    userId: user.id,
    timestamp: new Date().toISOString(),
    agentId,
    ...result,
  });
  recordRouteObservation({
    route: 'openclaw/improvement-drafts',
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
