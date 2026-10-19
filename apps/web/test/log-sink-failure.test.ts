import { describe, expect, it } from 'vitest';
import { loadApiConfig } from '../src/server/api/config';
import { createGuard } from '../src/server/api/guard';
import { createHealthHandler, type HealthReport } from '../src/server/api/health';
import { createLogger, type Logger } from '../src/server/api/logger';
import { InMemoryRateLimiter } from '../src/server/api/rate-limit';
import { closedDb, ORIGIN } from './stack';

/**
 * T-O O2: a failing diagnostic sink must not replace the intended HTTP outcome. Two kinds of
 * broken sink: a pino destination that throws on write, and a logger whose methods throw.
 */
const SECRET = 'SYNTHETIC_SINK_SECRET_O2';

function throwingDestinationLogger(): Logger {
  return createLogger({
    level: 'info',
    destination: {
      write() {
        throw new Error(`sink unavailable ${SECRET}`);
      },
    },
  });
}

function throwingMethodsLogger(): Logger {
  const boom = () => {
    throw new Error(`logger method failed ${SECRET}`);
  };
  return { error: boom, warn: boom, info: boom, fatal: boom, debug: boom } as unknown as Logger;
}

const sinks = [
  ['throwing destination', throwingDestinationLogger],
  ['throwing methods', throwingMethodsLogger],
] as const;

describe.each(sinks)('broken log sink (%s)', (_label, makeLogger) => {
  it('health keeps its 503 "down" JSON when the database fails', async () => {
    const broken = await closedDb();
    const handler = createHealthHandler({
      context: () => ({ db: broken.db }),
      config: loadApiConfig({}).health,
      logger: makeLogger(),
    });
    const res = await handler(new Request(`${ORIGIN}/api/health`));
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const report = (await res.json()) as HealthReport;
    expect(report.status).toBe('down');
    expect(report.checks.database).toMatchObject({ status: 'down', reason: 'unavailable' });
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  it('the rate-limit guard keeps its 429 for API and page requests', async () => {
    const config = loadApiConfig({
      TRUSTED_PROXY_HEADER: 'x-forwarded-for',
      API_RATE_LIMIT_PER_MINUTE: '1',
      PAGE_RATE_LIMIT_PER_MINUTE: '1',
    }).rateLimit;
    const guard = createGuard({
      limiter: new InMemoryRateLimiter(100, () => 0),
      config,
      logger: makeLogger(),
    });
    const req = (path: string) =>
      new Request(`${ORIGIN}${path}`, { headers: { 'x-forwarded-for': '203.0.113.9' } });
    for (const path of ['/api/v1/people.search', '/people']) {
      expect((await guard.check(req(path))).kind).toBe('pass');
      const blocked = await guard.check(req(path));
      expect(blocked.kind, path).toBe('block');
      if (blocked.kind !== 'block') continue;
      expect(blocked.response.status, path).toBe(429);
      expect(blocked.response.headers.get('retry-after'), path).toBeTruthy();
      expect(await blocked.response.text()).not.toContain(SECRET);
    }
  });

  it('the guard still fails closed (503) in production without a client identity', async () => {
    const config = loadApiConfig({ NODE_ENV: 'production' }).rateLimit;
    const guard = createGuard({
      limiter: new InMemoryRateLimiter(100, () => 0),
      config,
      logger: makeLogger(),
    });
    const blocked = await guard.check(new Request(`${ORIGIN}/api/v1/people.search`));
    expect(blocked.kind).toBe('block');
    if (blocked.kind === 'block') expect(blocked.response.status).toBe(503);
    // Probes stay reachable.
    expect((await guard.check(new Request(`${ORIGIN}/api/live`))).kind).toBe('pass');
  });

  it('a development guard without a trusted header still answers (shared-bucket warning)', async () => {
    const config = loadApiConfig({}).rateLimit;
    const guard = createGuard({
      limiter: new InMemoryRateLimiter(100, () => 0),
      config,
      logger: makeLogger(),
    });
    expect((await guard.check(new Request(`${ORIGIN}/api/v1/people.search`))).kind).toBe('pass');
  });
});
