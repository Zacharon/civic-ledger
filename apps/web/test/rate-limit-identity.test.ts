import { describe, expect, it } from 'vitest';
import { loadApiConfig } from '../src/server/api/config';
import { createGuard, ruleFor } from '../src/server/api/guard';
import { createHealthHandler, type HealthReport } from '../src/server/api/health';
import { createLogger } from '../src/server/api/logger';
import { InMemoryRateLimiter } from '../src/server/api/rate-limit';
import { rateLimitIdentityProblem } from '../src/server/api/rate-limit-identity';
import { closedDb, ORIGIN, seededStack } from './stack';

const silent = createLogger({ level: 'silent' });
const rateLimit = (env: Record<string, string>) => loadApiConfig(env).rateLimit;
const guardFor = (env: Record<string, string>) =>
  createGuard({
    limiter: new InMemoryRateLimiter(100, () => 0),
    config: rateLimit(env),
    logger: silent,
  });
const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, { headers });

describe('rate-limit identity in production', () => {
  it('flags only a production process with no trusted header and no acknowledgement', () => {
    expect(rateLimitIdentityProblem(rateLimit({}))).toBeNull();
    expect(rateLimitIdentityProblem(rateLimit({ NODE_ENV: 'development' }))).toBeNull();
    expect(rateLimitIdentityProblem(rateLimit({ NODE_ENV: 'production' }))).toBe(
      'trusted_proxy_header_unset',
    );
    expect(
      rateLimitIdentityProblem(
        rateLimit({ NODE_ENV: 'production', TRUSTED_PROXY_HEADER: 'cf-connecting-ip' }),
      ),
    ).toBeNull();
    expect(
      rateLimitIdentityProblem(
        rateLimit({ NODE_ENV: 'production', RATE_LIMIT_SINGLE_BUCKET: '1' }),
      ),
    ).toBeNull();
    expect(
      rateLimitIdentityProblem(
        rateLimit({ NODE_ENV: 'production', RATE_LIMIT_SINGLE_BUCKET: 'yes' }),
      ),
    ).toBe('trusted_proxy_header_unset');
  });

  it('fails closed: pages and the API get a 503 without internals, probes still answer', async () => {
    const guard = guardFor({ NODE_ENV: 'production' });
    for (const path of ['/', '/explore', '/api/v1/people.search']) {
      const result = await guard.check(get(path));
      expect(result.kind, path).toBe('block');
      if (result.kind !== 'block') continue;
      expect(result.response.status).toBe(503);
      expect(result.response.headers.get('retry-after')).toBe('60');
      const body = await result.response.text();
      expect(body).toMatch(/rate limiting is not configured/);
      expect(body).not.toMatch(/TRUSTED_PROXY_HEADER/);
    }
    expect((await guard.check(get('/api/health'))).kind).toBe('pass');
    expect((await guard.check(get('/api/live'))).kind).toBe('pass');
  });

  it('serves normally with a trusted header or an explicit single-bucket acknowledgement', async () => {
    const trusted = guardFor({ NODE_ENV: 'production', TRUSTED_PROXY_HEADER: 'x-forwarded-for' });
    const request = get('/explore', { 'x-forwarded-for': '203.0.113.9' });
    expect((await trusted.check(request)).kind).toBe('pass');
    const acknowledged = guardFor({ NODE_ENV: 'production', RATE_LIMIT_SINGLE_BUCKET: '1' });
    expect((await acknowledged.check(get('/api/v1/people.search'))).kind).toBe('pass');
  });

  it('keeps development ergonomic: no header, no acknowledgement, still served', async () => {
    const dev = guardFor({});
    expect((await dev.check(get('/api/v1/people.search'))).kind).toBe('pass');
    expect((await dev.check(get('/'))).kind).toBe('pass');
  });
});

describe('page rate limiting', () => {
  const env = {
    TRUSTED_PROXY_HEADER: 'x-forwarded-for',
    PAGE_RATE_LIMIT_PER_MINUTE: '3',
    API_RATE_LIMIT_PER_MINUTE: '50',
  };
  const page = (ip: string, path = '/explore') => get(path, { 'x-forwarded-for': ip });

  it('routes anything outside /api to the page rule', () => {
    expect(ruleFor('/')).toBe('page');
    expect(ruleFor('/people/avery-ashvale-x000001')).toBe('page');
    expect(ruleFor('/api/v1/people.search')).toBe('default');
    expect(ruleFor('/api/v1/openapi.json')).toBe('default');
  });

  it('has a generous default budget', () => {
    expect(rateLimit({}).rules.page).toEqual({ capacity: 300, refillPerSecond: 5 });
  });

  it('answers 429 text with Retry-After once a client has spent the page budget', async () => {
    const guard = guardFor(env);
    for (let i = 0; i < 3; i++) expect((await guard.check(page('203.0.113.1'))).kind).toBe('pass');
    const blocked = await guard.check(page('203.0.113.1', '/compare'));
    expect(blocked.kind).toBe('block');
    if (blocked.kind !== 'block') return;
    expect(blocked.response.status).toBe(429);
    expect(blocked.response.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(Number(blocked.response.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(blocked.response.headers.get('x-request-id')).toBeTruthy();
    // Another client, and the API bucket of the same client, are unaffected.
    expect((await guard.check(page('203.0.113.2'))).kind).toBe('pass');
    const api = get('/api/v1/people.search', { 'x-forwarded-for': '203.0.113.1' });
    expect((await guard.check(api)).kind).toBe('pass');
  });

  it('adds the request id and rate headers to allowed page requests', async () => {
    const result = await guardFor(env).check(page('203.0.113.7'));
    expect(result.kind).toBe('pass');
    if (result.kind !== 'pass') return;
    expect(result.responseHeaders.get('x-request-id')).toBe(result.requestId);
    expect(result.responseHeaders.get('ratelimit-limit')).toBe('3');
  });
});

describe('liveness is separate from readiness', () => {
  const stack = seededStack();

  it('serves /api/live without touching the database', async () => {
    const { GET, HEAD } = await import('../app/api/live/route');
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'live' });
    expect(HEAD().status).toBe(200);
  });

  it('reports a fail-closed limiter as degraded on /api/health (503 under ?strict=1)', async () => {
    const config = loadApiConfig({ NODE_ENV: 'production' });
    const handler = createHealthHandler({
      context: () => stack().ctx,
      config: config.health,
      rateLimit: config.rateLimit,
      logger: silent,
    });
    const res = await handler(new Request(`${ORIGIN}/api/health`));
    const report = (await res.json()) as HealthReport;
    expect(res.status).toBe(200);
    expect(report.status).toBe('degraded');
    expect(report.checks.rateLimit).toEqual({
      status: 'misconfigured',
      mode: 'single_bucket',
      reason: 'trusted_proxy_header_unset',
    });
    expect((await handler(new Request(`${ORIGIN}/api/health?strict=1`))).status).toBe(503);
  });

  it('reports an acknowledged single bucket as ok, and still shows the limiter when the DB is down', async () => {
    const config = loadApiConfig({ NODE_ENV: 'production', RATE_LIMIT_SINGLE_BUCKET: '1' });
    const ok = createHealthHandler({
      context: () => stack().ctx,
      config: config.health,
      rateLimit: config.rateLimit,
      logger: silent,
    });
    const report = (await (await ok(new Request(`${ORIGIN}/api/health`))).json()) as HealthReport;
    expect(report.checks.rateLimit).toEqual({ status: 'ok', mode: 'single_bucket' });

    const broken = await closedDb();
    const down = createHealthHandler({
      context: () => ({ db: broken.db }),
      config: config.health,
      rateLimit: config.rateLimit,
      logger: silent,
    });
    const res = await down(new Request(`${ORIGIN}/api/health`));
    expect(res.status).toBe(503);
    expect(((await res.json()) as HealthReport).checks.rateLimit?.mode).toBe('single_bucket');
  });
});
