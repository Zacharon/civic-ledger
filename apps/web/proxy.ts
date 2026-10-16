import { type NextRequest, NextResponse } from 'next/server';
import { REQUEST_ID_HEADER } from './src/server/api/request-id';
import { apiGuard } from './src/server/api/runtime';

/**
 * Next 16 `proxy` (formerly middleware, Node runtime): request id + per-client rate limit for
 * every page and `/api/*` call. Static assets are excluded (see matcher); pages use a
 * separate, more generous bucket than the API (docs/OPERATIONS.md "Rate limiting").
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

// Everything except Next's static files, the image optimizer and the favicon.
export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico).*)' };
