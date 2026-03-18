// ============================================================================
// RecallForge — Auth Helpers for API Routes
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, getApiKeyUser } from '@/lib/server/auth';
import type { User } from '@/types';

/**
 * Authenticate a request via session OR API key.
 * Returns the user or a 401 response.
 */
export async function authenticateRequest(
  req: NextRequest
): Promise<{ user: User } | { error: NextResponse }> {
  // Try API key first (for agents)
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const apiKey = authHeader.slice(7);
    const user = await getApiKeyUser(apiKey);
    if (user) return { user };
    return { error: NextResponse.json({ error: 'Invalid API key' }, { status: 401 }) };
  }

  // Fall back to session auth
  const user = await getAuthUser();
  if (user) return { user };

  return { error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
}
