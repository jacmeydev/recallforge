// ============================================================================
// RecallForge — Access control
// ============================================================================
// Local use needs no login: the server listens on 127.0.0.1 and every request
// acts as the local learner. To expose it (e.g. through a tunnel so a cloud
// agent can reach it) set RECALLFORGE_TOKEN; then every request must carry it:
//   Authorization: Bearer <token>   ·   X-API-Key: <token>   ·   ?key=<token>
//   or the rf_token cookie the browser gets after opening any page with ?key=.
// ============================================================================

import { getLocalUser } from '@/lib/core/users';
import type { AuthUser } from '@/lib/core/types';

export const TOKEN_COOKIE = 'rf_token';

export function requiredToken(): string | null {
  const token = process.env.RECALLFORGE_TOKEN?.trim();
  return token ? token : null;
}

function readCookie(header: string | null, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

/** Every place a client can put the token. */
export function providedToken(req: Request): string | null {
  const authorization = req.headers.get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim() || null;
  const header = req.headers.get('x-api-key');
  if (header) return header.trim() || null;
  return new URL(req.url).searchParams.get('key') ?? readCookie(req.headers.get('cookie'), TOKEN_COOKIE);
}

/** Constant-time string comparison (works in every runtime, no crypto needed). */
export function tokensMatch(provided: string | null, expected: string): boolean {
  if (provided === null || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function isAuthorized(req: Request): boolean {
  const token = requiredToken();
  return token === null || tokensMatch(providedToken(req), token);
}

/** The local learner, or null when a token is required and missing/wrong. */
export function authenticate(req: Request): AuthUser | null {
  return isAuthorized(req) ? getLocalUser() : null;
}
