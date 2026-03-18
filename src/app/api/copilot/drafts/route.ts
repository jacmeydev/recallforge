export const dynamic = 'force-dynamic';

// POST /api/copilot/drafts — Create draft cards
// GET  /api/copilot/drafts — List drafts (optional ?status=pending)

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { createDrafts, getDrafts } from '@/lib/server/copilot-service';
import { logger } from '@/lib/server/logger';
import { CopilotDraftCreateItemSchema } from '@/lib/validation/copilot-draft-schema';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';

export async function POST(req: NextRequest) {
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'copilot/drafts' });
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return withRequestContext(authResult.error, context);
  const { user } = authResult;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return withRequestContext(NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }), context);
  }

  const { drafts, agentId } = body as { drafts?: unknown[]; agentId?: string };

  if (!Array.isArray(drafts) || drafts.length === 0) {
    return withRequestContext(
      NextResponse.json({ error: 'drafts array is required and must not be empty' }, { status: 400 }),
      context
    );
  }

  if (drafts.length > 200) {
    return withRequestContext(NextResponse.json({ error: 'Maximum 200 drafts per request' }, { status: 400 }), context);
  }

  const validationErrors: Array<{ index: number; errors: string[] }> = [];
  const validDrafts: Array<ReturnType<typeof CopilotDraftCreateItemSchema.safeParse> & { success: true }> = [];
  for (let index = 0; index < drafts.length; index++) {
    const parsed = CopilotDraftCreateItemSchema.safeParse(drafts[index]);
    if (!parsed.success) {
      validationErrors.push({
        index,
        errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
      continue;
    }
    validDrafts.push(parsed as typeof parsed & { success: true });
  }

  if (validDrafts.length === 0) {
    return withRequestContext(
      NextResponse.json({ error: 'No valid drafts to create', validationErrors }, { status: 400 }),
      context
    );
  }

  const result = createDrafts(user.id, validDrafts.map((draft) => draft.data), agentId);
  log.info('Copilot drafts created', { userId: user.id, created: result.created, requested: drafts.length });

  return withRequestContext(NextResponse.json({
    ok: true,
    userId: user.id,
    timestamp: new Date().toISOString(),
    validationErrors,
    ...result,
  }), context);
}

export async function GET(req: NextRequest) {
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'copilot/drafts#get' });
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return withRequestContext(authResult.error, context);
  const { user } = authResult;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') as 'pending' | 'approved' | 'rejected' | 'edited' | 'imported' | null;
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

  const validStatuses = ['pending', 'approved', 'rejected', 'edited', 'imported'];
  if (status && !validStatuses.includes(status)) {
    return withRequestContext(
      NextResponse.json({ error: `Invalid status. Valid: ${validStatuses.join(', ')}` }, { status: 400 }),
      context
    );
  }

  const drafts = getDrafts(user.id, status || undefined, limit);
  log.info('Copilot drafts listed', { userId: user.id, count: drafts.length, filter: status || 'all' });

  return withRequestContext(NextResponse.json({
    ok: true,
    userId: user.id,
    timestamp: new Date().toISOString(),
    drafts,
    count: drafts.length,
  }), context);
}
