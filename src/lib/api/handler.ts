// ============================================================================
// RecallForge — REST route helper
// ============================================================================
// Wraps a route handler with authentication and uniform JSON errors:
//   { "error": { "code": "not_found", "message": "...", "details": ... } }
// ============================================================================

import { NextResponse } from 'next/server';
import { AppError, badRequest } from '@/lib/core/errors';
import { authenticate, type Authenticated } from './auth';

interface HandlerArgs<P> extends Authenticated {
  req: Request;
  params: P;
}

interface Options {
  status?: number;
  /** Reject API-key callers (account actions reserved for the browser). */
  sessionOnly?: boolean;
}

export function route<P = Record<string, string>>(
  fn: (args: HandlerArgs<P>) => unknown | Promise<unknown>,
  options: Options = {}
) {
  return async (req: Request, ctx: { params: Promise<P> }) => {
    try {
      const auth = await authenticate(req);
      if (!auth) return unauthorized();
      if (options.sessionOnly && auth.via !== 'session') {
        throw new AppError(403, 'forbidden', 'This action is only available from the web app');
      }
      const params = ((await ctx?.params) ?? {}) as P;
      const result = await fn({ req, params, ...auth });
      if (result instanceof Response) return result;
      return NextResponse.json(result, { status: options.status ?? 200 });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function unauthorized(): Response {
  return NextResponse.json(
    {
      error: {
        code: 'unauthorized',
        message: 'Missing or invalid API key. Send "Authorization: Bearer rf_..." (get a key in the web app → Cuenta).',
      },
    },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="recallforge"' } }
  );
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
      { status: error.status }
    );
  }
  console.error('[recallforge] unhandled API error', error);
  return NextResponse.json({ error: { code: 'internal', message: 'Internal server error' } }, { status: 500 });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw badRequest('Request body must be a JSON object');
}

/** Query string → plain object, converting numeric params listed in `numeric`. */
export function queryParams(req: Request, numeric: string[] = []): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const [key, value] of new URL(req.url).searchParams) {
    if (key === 'key' || value === '') continue;
    result[key] = numeric.includes(key) && /^\d+$/.test(value) ? Number(value) : value;
  }
  return result;
}

/** Path params may arrive encoded or decoded depending on the runtime. */
export function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
