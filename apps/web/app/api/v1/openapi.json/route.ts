import { cacheControlFor, etagOf, matchesEtag } from '../../../../src/server/api/cache';
import { baseHeaders } from '../../../../src/server/api/http';
import { buildOpenApiDocument } from '../../../../src/server/api/openapi';
import { requestIdFrom } from '../../../../src/server/api/request-id';

export const dynamic = 'force-dynamic';

const body = JSON.stringify(buildOpenApiDocument());
const etag = etagOf(body);

export function GET(request: Request): Response {
  const headers = baseHeaders(requestIdFrom(request.headers), {
    'cache-control': cacheControlFor('policy.areas'),
    etag,
  });
  if (matchesEtag(request.headers.get('if-none-match'), etag)) {
    headers.delete('content-type');
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers });
}
