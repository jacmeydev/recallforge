// ============================================================================
// RecallForge — Proxy
// ============================================================================
// 1. Security headers on every response.
// 2. Optional access token (RECALLFORGE_TOKEN) for servers exposed beyond
//    localhost. Opening any page with ?key=<token> stores it in a cookie.
// 3. Rate limiting on the agent API.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, requiredToken, TOKEN_COOKIE, tokensMatch } from '@/lib/api/auth';
import { checkRateLimit } from '@/lib/server/rate-limit';

const API_RATE_LIMIT = {
  max: parseInt(process.env.RATE_LIMIT_API_MAX || '120', 10),
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
};

function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
}

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}

const LOCKED_PAGE = `<!doctype html><html lang="es"><meta charset="utf-8"><title>RecallForge</title>
<body style="font-family:system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.5">
<h1>RecallForge</h1><p>Este servidor está protegido con un token. Ábrelo una vez con <code>?key=TU_TOKEN</code> al final de la dirección
(el valor de <code>RECALLFORGE_TOKEN</code>) y el navegador lo recordará.</p></body></html>`;

export function proxy(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // Rate limiting only matters when the server is reachable by others (token mode); media are exempt.
  if (requiredToken() && isApi && !pathname.startsWith('/api/v1/media/') && (pathname.startsWith('/api/v1/') || pathname === '/api/mcp')) {
    const limit = checkRateLimit(`api:${clientIp(req)}`, API_RATE_LIMIT);
    if (!limit.allowed) {
      const res = NextResponse.json({ error: { code: 'rate_limited', message: 'Too many requests' } }, { status: 429 });
      res.headers.set('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000)));
      return withSecurityHeaders(res);
    }
  }

  const token = requiredToken();
  if (token && pathname !== '/api/health') {
    if (!isAuthorized(req)) {
      return withSecurityHeaders(
        isApi
          ? NextResponse.json(
              { error: { code: 'unauthorized', message: 'Send "Authorization: Bearer <RECALLFORGE_TOKEN>"' } },
              { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="recallforge"' } }
            )
          : new NextResponse(LOCKED_PAGE, { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } })
      );
    }
    // A browser that opened a page with ?key= keeps the token in a cookie and drops it from the URL.
    const key = searchParams.get('key');
    if (!isApi && key && tokensMatch(key, token)) {
      const clean = req.nextUrl.clone();
      clean.searchParams.delete('key');
      const res = NextResponse.redirect(clean);
      res.cookies.set(TOKEN_COOKIE, key, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.nextUrl.protocol === 'https:',
        maxAge: 60 * 60 * 24 * 365,
        path: '/',
      });
      return withSecurityHeaders(res);
    }
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
