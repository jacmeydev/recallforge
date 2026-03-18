import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export interface RequestContext {
  requestId: string;
  deviceId: string | null;
  operationId: string | null;
}

export function getRequestContext(req: NextRequest): RequestContext {
  return {
    requestId: req.headers.get('x-request-id') || randomUUID(),
    deviceId: req.headers.get('x-device-id'),
    operationId: req.headers.get('x-operation-id'),
  };
}

export function withRequestContext(
  response: NextResponse,
  context: RequestContext,
  extraHeaders?: Record<string, string>
): NextResponse {
  response.headers.set('x-request-id', context.requestId);
  if (context.deviceId) {
    response.headers.set('x-device-id', context.deviceId);
  }
  if (context.operationId) {
    response.headers.set('x-operation-id', context.operationId);
  }
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      response.headers.set(key, value);
    }
  }
  return response;
}
