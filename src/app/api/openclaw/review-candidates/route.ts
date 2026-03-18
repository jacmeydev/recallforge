export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { logger } from '@/lib/server/logger';
import { recordRouteObservation } from '@/lib/server/observability';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';
import { OpenClawReviewCandidateQuerySchema } from '@/lib/validation/copilot-draft-schema';
import { getOpenClawReviewCandidates } from '@/lib/server/openclaw-review-service';

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'openclaw/review-candidates' });
  const authResult = await authenticateRequest(req);

  if ('error' in authResult) {
    recordRouteObservation({
      route: 'openclaw/review-candidates',
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
  const parsed = OpenClawReviewCandidateQuerySchema.safeParse({
    limit: req.nextUrl.searchParams.get('limit') ?? undefined,
    mode: req.nextUrl.searchParams.get('mode') ?? undefined,
    deckId: req.nextUrl.searchParams.get('deckId') ?? undefined,
    noteId: req.nextUrl.searchParams.get('noteId') ?? undefined,
  });

  if (!parsed.success) {
    const response = NextResponse.json({
      error: 'Invalid query params',
      validationErrors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    }, { status: 400 });
    recordRouteObservation({
      route: 'openclaw/review-candidates',
      method: 'GET',
      status: response.status,
      durationMs: Date.now() - startedAt,
      requestId: context.requestId,
      userId: user.id,
      deviceId: context.deviceId,
      operationId: context.operationId,
      errorMessage: 'Invalid query params',
    });
    return withRequestContext(response, context);
  }

  const candidates = getOpenClawReviewCandidates(user.id, parsed.data);
  log.metric('openclaw_review_candidates_served', candidates.length, {
    userId: user.id,
    mode: parsed.data.mode,
    limit: parsed.data.limit,
  });

  const response = NextResponse.json({
    ok: true,
    userId: user.id,
    timestamp: new Date().toISOString(),
    mode: parsed.data.mode,
    count: candidates.length,
    candidates,
  });
  recordRouteObservation({
    route: 'openclaw/review-candidates',
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
