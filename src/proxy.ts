// ============================================================================
// RecallForge — Proxy (Defense-in-depth)
// ============================================================================
// 1. Security headers on all responses
// 2. Rate limiting on auth and API routes
// 3. Fast-reject for unauthenticated API requests
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/server/rate-limit';

// Session cookie names used by Auth.js v5
const SESSION_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

// Rate limit configs
const AUTH_RATE_LIMIT = {
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '20', 10),
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
};
const API_RATE_LIMIT = {
  max: parseInt(process.env.RATE_LIMIT_API_MAX || '120', 10),
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
};

function getClientIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Required for SharedArrayBuffer / fsrs-browser optimizer.
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }
  return response;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const ip = getClientIP(req);

  // ── Rate limit auth endpoints ──────────────────────────────────────
  if (pathname.startsWith('/api/auth/register') || pathname.startsWith('/api/auth/callback')) {
    const rl = checkRateLimit(`auth:${ip}`, AUTH_RATE_LIMIT);
    if (!rl.allowed) {
      const res = NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
      res.headers.set('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      return addSecurityHeaders(res);
    }
  }

  // ── Rate limit sync & agent API ────────────────────────────────────
  if (pathname.startsWith('/api/sync') || pathname.startsWith('/api/agent')) {
    const rl = checkRateLimit(`api:${ip}`, API_RATE_LIMIT);
    if (!rl.allowed) {
      const res = NextResponse.json(
        { error: 'Rate limit exceeded.' },
        { status: 429 }
      );
      res.headers.set('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      return addSecurityHeaders(res);
    }

    // ── Auth check for protected routes ──────────────────────────────
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      return addSecurityHeaders(NextResponse.next());
    }

    const hasSessionCookie = SESSION_COOKIES.some(
      (name) => req.cookies.get(name)?.value
    );
    if (hasSessionCookie) {
      return addSecurityHeaders(NextResponse.next());
    }

    // No credentials → 401
    const res = NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
    return addSecurityHeaders(res);
  }

  // ── All other routes: pass through with security headers ───────────
  return addSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon\\.ico|icons|manifest\\.json|sw\\.js).*)',
  ],
};
