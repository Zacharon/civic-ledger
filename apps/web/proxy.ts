import { type NextRequest, NextResponse } from 'next/server';
import { REQUEST_ID_HEADER } from './src/server/api/request-id';
import { apiGuard } from './src/server/api/runtime';

/**
 * Next 16 `proxy` (formerly middleware, Node runtime): request id + per-client rate limit for
 * every /api/* call. Pages are untouched (see matcher).
 */
export async function proxy(request: NextRequest): Promise<Response> {
  const result = await apiGuard().check(request);
  if (result.kind === 'block') return result.response;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, result.requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of result.responseHeaders) response.headers.set(name, value);
  return response;
}

export const config = { matcher: '/api/:path*' };
