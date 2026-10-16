import { describe, expect, it } from 'vitest';
import { loadApiConfig } from '../src/server/api/config';
import { createGuard, ruleFor } from '../src/server/api/guard';
import { createLogger } from '../src/server/api/logger';
import { clientIp, InMemoryRateLimiter, UNKNOWN_CLIENT } from '../src/server/api/rate-limit';

const RULE = { capacity: 3, refillPerSecond: 1 };

describe('InMemoryRateLimiter', () => {
  it('allows a burst, then refuses with a Retry-After, then refills', () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter(100, () => now);
    expect([1, 2, 3].map(() => limiter.take('a', RULE))).toEqual([
      { allowed: true, limit: 3, remaining: 2 },
      { allowed: true, limit: 3, remaining: 1 },
      { allowed: true, limit: 3, remaining: 0 },
    ]);
    expect(limiter.take('a', RULE)).toEqual({ allowed: false, limit: 3, retryAfterSeconds: 1 });
    now += 1_000;
    expect(limiter.take('a', RULE)).toMatchObject({ allowed: true });
    expect(limiter.take('a', RULE)).toMatchObject({ allowed: false });
  });

  it('reports how long until a token exists', () => {
    const limiter = new InMemoryRateLimiter(100, () => 0);
    const slow = { capacity: 1, refillPerSecond: 1 / 60 };
    limiter.take('a', slow);
    expect(limiter.take('a', slow)).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
  });

  it('keeps buckets independent per key', () => {
    const limiter = new InMemoryRateLimiter(100, () => 0);
    for (let i = 0; i < 3; i++) limiter.take('a', RULE);
    expect(limiter.take('a', RULE)).toMatchObject({ allowed: false });
    expect(limiter.take('b', RULE)).toMatchObject({ allowed: true });
  });

  it('bounds memory by evicting the least recently used key', () => {
    const limiter = new InMemoryRateLimiter(2, () => 0);
    for (let i = 0; i < 3; i++) limiter.take('a', RULE);
    limiter.take('b', RULE);
    limiter.take('c', RULE); // evicts "a", which was exhausted
    expect(limiter.take('a', RULE)).toMatchObject({ allowed: true, remaining: 2 });
  });
});

describe('clientIp', () => {
  const headers = (h: Record<string, string>) => new Headers(h);

  it('trusts no header by default (shared bucket)', () => {
    expect(
      clientIp(headers({ 'x-forwarded-for': '203.0.113.9' }), {
        trustedProxyHeader: undefined,
        trustedProxyHops: 1,
      }),
    ).toBe(UNKNOWN_CLIENT);
  });

  it('takes the entry the trusted proxy appended, not what the client claimed', () => {
    const h = headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' });
    expect(clientIp(h, { trustedProxyHeader: 'x-forwarded-for', trustedProxyHops: 1 })).toBe(
      '203.0.113.9',
    );
    expect(clientIp(h, { trustedProxyHeader: 'x-forwarded-for', trustedProxyHops: 2 })).toBe(
      '6.6.6.6',
    );
  });

  it('reads single-value headers and rejects non-IP values', () => {
    const options = { trustedProxyHeader: 'cf-connecting-ip', trustedProxyHops: 1 };
    expect(clientIp(headers({ 'cf-connecting-ip': '2001:DB8::1' }), options)).toBe('2001:db8::1');
    expect(clientIp(headers({ 'cf-connecting-ip': 'not-an-ip' }), options)).toBe(UNKNOWN_CLIENT);
    expect(clientIp(headers({}), options)).toBe(UNKNOWN_CLIENT);
  });
});

describe('guard', () => {
  const config = loadApiConfig({
    TRUSTED_PROXY_HEADER: 'x-forwarded-for',
    API_RATE_LIMIT_PER_MINUTE: '5',
    API_RATE_LIMIT_EVALUATE_PER_MINUTE: '2',
  }).rateLimit;
  const make = () =>
    createGuard({
      limiter: new InMemoryRateLimiter(100, () => 0),
      config,
      logger: createLogger({ level: 'silent' }),
    });
  const req = (path: string, ip = '203.0.113.1', method = 'GET') =>
    new Request(`http://civic-ledger.test${path}`, {
      method,
      headers: { 'x-forwarded-for': ip },
    });

  it('selects the stricter bucket for frameworks.evaluate and a separate one for health', () => {
    expect(ruleFor('/api/v1/frameworks.evaluate')).toBe('evaluate');
    expect(ruleFor('/api/health')).toBe('health');
    expect(ruleFor('/api/v1/people.search')).toBe('default');
  });

  it('returns 429 with Retry-After and the structured error body once the budget is spent', async () => {
    const guard = make();
    for (let i = 0; i < 5; i++) {
      const result = await guard.check(req('/api/v1/people.search'));
      expect(result.kind).toBe('pass');
    }
    const blocked = await guard.check(req('/api/v1/people.search'));
    expect(blocked.kind).toBe('block');
    if (blocked.kind !== 'block') return;
    expect(blocked.response.status).toBe(429);
    expect(Number(blocked.response.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(blocked.response.headers.get('cache-control')).toBe('no-store');
    expect(blocked.response.headers.get('ratelimit-remaining')).toBe('0');
    expect(blocked.response.headers.get('x-request-id')).toBeTruthy();
    const body = (await blocked.response.json()) as {
      error: { code: string; retryAfterSeconds: number };
    };
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('limits frameworks.evaluate sooner and independently of reads', async () => {
    const guard = make();
    const evaluate = () => guard.check(req('/api/v1/frameworks.evaluate', '203.0.113.2', 'POST'));
    expect((await evaluate()).kind).toBe('pass');
    expect((await evaluate()).kind).toBe('pass');
    expect((await evaluate()).kind).toBe('block');
    expect((await guard.check(req('/api/v1/people.search', '203.0.113.2'))).kind).toBe('pass');
  });

  it('gives each client address its own budget', async () => {
    const guard = make();
    for (let i = 0; i < 6; i++) await guard.check(req('/api/v1/people.search', '203.0.113.3'));
    expect((await guard.check(req('/api/v1/people.search', '203.0.113.3'))).kind).toBe('block');
    expect((await guard.check(req('/api/v1/people.search', '203.0.113.4'))).kind).toBe('pass');
  });

  it('passes rate headers and the request id on allowed requests, and spares preflights', async () => {
    const guard = make();
    const pass = await guard.check(req('/api/v1/people.search'));
    expect(pass.kind).toBe('pass');
    if (pass.kind !== 'pass') return;
    expect(pass.responseHeaders.get('ratelimit-limit')).toBe('5');
    expect(pass.responseHeaders.get('ratelimit-remaining')).toBe('4');
    expect(pass.responseHeaders.get('x-request-id')).toBe(pass.requestId);

    for (let i = 0; i < 10; i++) {
      expect((await guard.check(req('/api/v1/people.search', '203.0.113.5', 'OPTIONS'))).kind).toBe(
        'pass',
      );
    }
    expect((await guard.check(req('/api/v1/people.search', '203.0.113.5'))).kind).toBe('pass');
  });
});

describe('loadApiConfig', () => {
  it('has safe defaults and ignores junk', () => {
    const config = loadApiConfig({ API_RATE_LIMIT_PER_MINUTE: 'lots', TRUSTED_PROXY_HOPS: '-3' });
    expect(config.rateLimit.rules.default).toEqual({ capacity: 60, refillPerSecond: 1 });
    expect(config.rateLimit.rules.evaluate.capacity).toBe(10);
    expect(config.rateLimit.trustedProxyHeader).toBeUndefined();
    expect(config.rateLimit.trustedProxyHops).toBe(1);
  });
});
