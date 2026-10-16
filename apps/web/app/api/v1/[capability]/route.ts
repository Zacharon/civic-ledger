import { preflightResponse } from '../../../../src/server/api/handler';
import { requestIdFrom } from '../../../../src/server/api/request-id';
import { apiCapabilityHandler } from '../../../../src/server/api/runtime';

// One generic adapter for every public capability: /api/v1/<capability name>.
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ capability: string }>;
}

async function handle(request: Request, { params }: RouteContext): Promise<Response> {
  return apiCapabilityHandler()(request, (await params).capability);
}

export const GET = handle;
export const POST = handle;

export function OPTIONS(request: Request): Response {
  return preflightResponse(requestIdFrom(request.headers));
}
