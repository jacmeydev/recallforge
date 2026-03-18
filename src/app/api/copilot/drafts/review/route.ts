export const dynamic = 'force-dynamic';

// POST /api/copilot/drafts/review — Approve/reject/edit drafts

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { reviewDrafts } from '@/lib/server/copilot-service';
import type { DraftReviewAction } from '@/lib/server/copilot-service';
import { logger } from '@/lib/server/logger';

export async function POST(req: NextRequest) {
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { user } = authResult;

  const body = await req.json();
  const { reviews } = body as { reviews: DraftReviewAction[] };

  if (!Array.isArray(reviews) || reviews.length === 0) {
    return NextResponse.json({ error: 'reviews array is required and must not be empty' }, { status: 400 });
  }

  if (reviews.length > 100) {
    return NextResponse.json({ error: 'Maximum 100 reviews per request' }, { status: 400 });
  }

  const validActions = ['approve', 'reject', 'edit'];
  for (const rev of reviews) {
    if (!rev.draftId || !rev.action) {
      return NextResponse.json({ error: 'Each review must have draftId and action' }, { status: 400 });
    }
    if (!validActions.includes(rev.action)) {
      return NextResponse.json({ error: `Invalid action "${rev.action}". Valid: ${validActions.join(', ')}` }, { status: 400 });
    }
  }

  const result = reviewDrafts(user.id, reviews);
  logger.info(`[copilot/drafts/review] user=${user.id} reviewed=${result.reviewed} imported=${result.imported} rejected=${result.rejected}`);

  return NextResponse.json({
    ok: true,
    userId: user.id,
    timestamp: new Date().toISOString(),
    ...result,
  });
}
