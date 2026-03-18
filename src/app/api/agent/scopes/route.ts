export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Agent API: Study Scopes
// ============================================================================
// GET /api/agent/scopes
// Returns all available study scopes (decks, programs, subjects, note types).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { getStudyScopes } from '@/lib/server/agent-service';
import { logger } from '@/lib/server/logger';

export async function GET(req: NextRequest) {
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { user } = authResult;

  const scopes = getStudyScopes(user.id);

  logger.info(`[agent/scopes] user=${user.id} decks=${scopes.decks.length} subjects=${scopes.subjects.length}`);

  return NextResponse.json({
    ok: true,
    ...scopes,
  });
}
