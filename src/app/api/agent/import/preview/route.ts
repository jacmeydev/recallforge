export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Agent API: Import Preview
// ============================================================================
// POST /api/agent/import/preview
// Dry-run validation of agent import items. Returns what would happen.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { AIImportItemSchema } from '@/lib/validation/ai-import-schema';
import { agentImport } from '@/lib/server/agent-service';
import { logger } from '@/lib/server/logger';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';

export async function POST(req: NextRequest) {
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'agent/import/preview' });
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

  // Run dry-run import with valid items
  const importResult = agentImport(
    user.id,
    validItems.map(v => v.data),
    { ...(options as Record<string, string> || {}), dryRun: true, agentId: 'preview' }
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

  log.info('Agent import preview completed', {
    userId: user.id,
    totalItems: items.length,
    validItems: validItems.length,
  });

  return withRequestContext(NextResponse.json({
    ok: true,
    dryRun: true,
    totalItems: items.length,
    validItems: validItems.length,
    validationErrors,
    wouldCreate: importResult.created,
    wouldUpdate: importResult.updated,
    wouldSkip: importResult.skipped,
    wouldFail: importResult.failed + validationErrors.length,
    importErrors: importResult.errors,
  }), context);
}
