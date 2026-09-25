// ============================================================================
// RecallForge — Request authentication for the REST API and MCP endpoint
// ============================================================================
// API key (for agents), accepted as:
//   Authorization: Bearer rf_...   (preferred)
//   X-API-Key: rf_...
//   ?key=rf_...                    (only for clients that cannot set headers)
// Otherwise falls back to the browser session cookie.
// ============================================================================

import { findUserByApiKey } from '@/lib/core/users';
import type { AuthUser } from '@/lib/core/types';

export function extractApiKey(req: Request): string | null {
  const authorization = req.headers.get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim() || null;
  const header = req.headers.get('x-api-key');
  if (header) return header.trim() || null;
  return new URL(req.url).searchParams.get('key');
}

export interface Authenticated {
  user: AuthUser;
  via: 'api-key' | 'session';
}

export async function authenticate(req: Request): Promise<Authenticated | null> {
  const apiKey = extractApiKey(req);
  if (apiKey) {
    const user = findUserByApiKey(apiKey);
    return user ? { user, via: 'api-key' } : null;
  }
  const { getSessionUser } = await import('@/lib/auth');
  const user = await getSessionUser();
  return user ? { user, via: 'session' } : null;
}
