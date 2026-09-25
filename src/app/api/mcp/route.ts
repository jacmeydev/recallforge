// ============================================================================
// RecallForge — MCP endpoint (Streamable HTTP, stateless, JSON responses)
// ============================================================================
// POST /api/mcp with "Authorization: Bearer rf_..." (or ?key=rf_... for
// clients that cannot send headers).
// ============================================================================

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/auth';
import { errorResponse, unauthorized } from '@/lib/api/handler';
import { createMcpServer } from '@/lib/mcp/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const auth = await authenticate(req);
    if (!auth) return unauthorized();

    const server = createMcpServer(auth.user);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req);
    } finally {
      void server.close();
    }
  } catch (error) {
    return errorResponse(error);
  }
}

function methodNotAllowed() {
  return NextResponse.json(
    { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this MCP server is stateless, use POST.' }, id: null },
    { status: 405, headers: { Allow: 'POST' } }
  );
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
