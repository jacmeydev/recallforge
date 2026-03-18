export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Agent API: Import (Real)
// ============================================================================
// POST /api/agent/import
// Import cards from an agent into the server database.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { AIImportItemSchema } from '@/lib/validation/ai-import-schema';
import { agentImport } from '@/lib/server/agent-service';
import { logger } from '@/lib/server/logger';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';

export async function POST(req: NextRequest) {
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'agent/import' });
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { user } = authResult;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return withRequestContext(NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }), context);
  }

  const { items, options } = body as { items?: unknown[]; options?: Record<string, unknown> };

  if (!items || !Array.isArray(items) || items.length === 0) {
    return withRequestContext(
      NextResponse.json({ error: 'items array is required and must not be empty' }, { status: 400 }),
      context
    );
  }

  if (items.length > 500) {
    return withRequestContext(
      NextResponse.json({ error: 'Maximum 500 items per request' }, { status: 400 }),
      context
    );
  }

  // Validate each item
  const validationErrors: Array<{ index: number; errors: string[] }> = [];
  const validItems: Array<ReturnType<typeof AIImportItemSchema.safeParse> & { success: true }> = [];

  for (let i = 0; i < items.length; i++) {
    const result = AIImportItemSchema.safeParse(items[i]);
    if (!result.success) {
      validationErrors.push({
        index: i,
        errors: result.error.issues.map(iss => `${iss.path.join('.')}: ${iss.message}`),
      });
    } else {
      validItems.push(result as typeof result & { success: true });
    }
  }

  if (validItems.length === 0) {
    return withRequestContext(
      NextResponse.json({
        ok: false,
        error: 'No valid items to import',
        validationErrors,
      }, { status: 400 }),
      context
    );
  }

  // Real import
  const agentId = typeof (options as Record<string, unknown>)?.agentId === 'string'
    ? (options as Record<string, unknown>).agentId as string
    : 'agent';

  const { dryRun: _ignored, agentId: _ignored2, ...restOptions } = (options as Record<string, string>) || {};
  const importResult = agentImport(
    user.id,
    validItems.map(v => v.data),
    { ...restOptions, dryRun: false, agentId }
  );

  if (importResult.errors.some((error) => error.index === -1)) {
    return withRequestContext(
      NextResponse.json({
        ok: false,
        error: importResult.errors[0]?.message || 'Invalid import options',
        validationErrors,
      }, { status: 400 }),
      context
    );
  }

  log.info('Agent import completed', {
    userId: user.id,
    created: importResult.created,
    updated: importResult.updated,
    skipped: importResult.skipped,
    failed: importResult.failed,
    durationMs: importResult.durationMs,
  });

  return withRequestContext(NextResponse.json({
    ok: true,
    ...importResult,
    validationErrors,
  }), context);
}
