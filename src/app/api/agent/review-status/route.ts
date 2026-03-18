export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Agent API: Review Status
// ============================================================================
// POST /api/agent/review-status
// Mark AI-imported notes as reviewed or corrected.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { updateReviewStatus } from '@/lib/server/agent-service';
import { logger } from '@/lib/server/logger';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';

export async function POST(req: NextRequest) {
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'agent/review-status' });
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { user } = authResult;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return withRequestContext(NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }), context);
  }

  const { noteIds, status, agentId } = body as {
    noteIds?: string[];
    status?: string;
    agentId?: string;
  };

  if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
    return withRequestContext(NextResponse.json({ error: 'noteIds array is required' }, { status: 400 }), context);
  }

  if (noteIds.length > 200) {
    return withRequestContext(NextResponse.json({ error: 'Maximum 200 noteIds per request' }, { status: 400 }), context);
  }

  if (!status || !['reviewed', 'corrected'].includes(status)) {
    return withRequestContext(
      NextResponse.json({ error: 'status must be "reviewed" or "corrected"' }, { status: 400 }),
      context
    );
  }

  const result = updateReviewStatus(user.id, noteIds, status as 'reviewed' | 'corrected', agentId);

  log.info('Agent review status updated', {
    userId: user.id,
    status,
    updated: result.updated,
    notFound: result.notFound,
  });

  return withRequestContext(NextResponse.json({
    ok: true,
    ...result,
  }), context);
}
