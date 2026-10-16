import { apiHealthHandler } from '../../../src/server/api/runtime';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return apiHealthHandler()(request);
}
