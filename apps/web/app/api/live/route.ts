export const dynamic = 'force-dynamic';

/**
 * Liveness: the process is up and can answer. Touches no database and no other dependency,
 * so a database outage never makes a restart-on-failure probe loop. Readiness is /api/health.
 */
export function GET(): Response {
  return Response.json(
    { status: 'live' },
    { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } },
  );
}

export function HEAD(): Response {
  return new Response(null, { headers: { 'cache-control': 'no-store' } });
}
