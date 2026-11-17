import { CapabilityError } from '@civic-ledger/core';
import { errorResponse } from '../../../../src/server/api/http';
import { requestIdFrom } from '../../../../src/server/api/request-id';
import { apiCapabilityHandler } from '../../../../src/server/api/runtime';

/**
 * `/people/<slug>/portrait?size=225|450&v=<cache key>`: the official portrait file.
 *
 * A web-facing address for the `people.portrait` capability. It does not read the database or
 * decide headers itself: it rewrites the request to the same call `/api/v1/people.portrait`
 * receives, so the bytes, ETag (the sha256), 304 handling, nosniff and cache policy are
 * identical for the page, the API and the MCP tool.
 */
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const { slug } = await params;
  const requestId = requestIdFrom(request.headers);
  // A slug that cannot be a slug cannot exist: 404, as the profile page does.
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) {
    return errorResponse(new CapabilityError('not_found', 'No such member'), requestId);
  }
  const incoming = new URL(request.url);
  const target = new URL('/api/v1/people.portrait', incoming.origin);
  // Pass every query parameter through so unknown ones are rejected by the capability's strict
  // input exactly as they are on the API; `slug` always comes from the path.
  if (incoming.searchParams.has('slug')) {
    return errorResponse(
      new CapabilityError('invalid_input', 'The slug is part of the path', {
        issues: [{ path: 'slug', message: 'Do not pass slug as a query parameter' }],
      }),
      requestId,
    );
  }
  target.searchParams.set('slug', slug);
  for (const [key, value] of incoming.searchParams) target.searchParams.append(key, value);
  return apiCapabilityHandler()(
    new Request(target, { method: request.method, headers: request.headers }),
    'people.portrait',
  );
}
