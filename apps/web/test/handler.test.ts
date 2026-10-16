import { createDb, publicCapabilities } from '@civic-ledger/core';
import { runMigrations } from '@civic-ledger/db/migrate';
import { describe, expect, it } from 'vitest';
import { CACHE_CLASS, cacheControlFor } from '../src/server/api/cache';
import {
  allowedMethodFor,
  createCapabilityHandler,
  MAX_BODY_BYTES,
} from '../src/server/api/handler';
import { createLogger } from '../src/server/api/logger';
import { ORIGIN, seededStack } from './stack';

const stack = seededStack();

function request(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}/api/v1/${path}`, init);
}

function handlerWith(lines: string[], overrides: { ctx?: () => never } = {}) {
  return createCapabilityHandler({
    context: overrides.ctx ?? (() => stack().ctx),
    logger: createLogger({
      level: 'info',
      destination: { write: (line) => void lines.push(line) },
    }),
  });
}

describe('GET /api/v1/<capability>', () => {
  it('returns JSON with request id, ETag, shared-cache headers and CORS', async () => {
    const res = await handlerWith([])(request('policy.areas'), 'policy.areas');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get('etag')).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('answers 304 with no body when If-None-Match matches', async () => {
    const handler = handlerWith([]);
    const first = await handler(request('frameworks.list'), 'frameworks.list');
    const etag = first.headers.get('etag') as string;
    const second = await handler(
      request('frameworks.list', { headers: { 'if-none-match': `"other", W/${etag}` } }),
      'frameworks.list',
    );
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
    expect(second.headers.get('etag')).toBe(etag);
    const stale = await handler(
      request('frameworks.list', { headers: { 'if-none-match': '"stale"' } }),
      'frameworks.list',
    );
    expect(stale.status).toBe(200);
  });

  it('echoes a well-formed inbound request id and replaces a malformed one', async () => {
    const handler = handlerWith([]);
    const ok = await handler(
      request('policy.areas', { headers: { 'x-request-id': 'abc-12345678' } }),
      'policy.areas',
    );
    expect(ok.headers.get('x-request-id')).toBe('abc-12345678');
    const bad = await handler(
      request('policy.areas', { headers: { 'x-request-id': 'bad id; with <junk>' } }),
      'policy.areas',
    );
    expect(bad.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('coerces query strings: typed numbers, nested filters, indexed sort', async () => {
    const res = await handlerWith([])(
      request(
        'explore.table?filters.chamber=senate&sort.0.column=totalReceiptsCents&sort.0.direction=desc&limit=2',
      ),
      'explore.table',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; limit: number };
    expect(body.limit).toBe(2);
    expect(body.rows).toHaveLength(2);
  });

  it('rejects unknown parameters with a structured 400 and no-store', async () => {
    const res = await handlerWith([])(request('people.search?limt=5'), 'people.search');
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { error: { code: string; issues: Array<{ path: string }> } };
    expect(body.error.code).toBe('invalid_input');
    expect(body.error.issues.length).toBeGreaterThan(0);
  });

  it('maps not_found to 404', async () => {
    const res = await handlerWith([])(request('people.get?slug=nobody-here'), 'people.get');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('rejects the wrong method with 405 and an Allow header', async () => {
    const handler = handlerWith([]);
    const post = await handler(
      request('people.search', { method: 'POST', body: '{}' }),
      'people.search',
    );
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, OPTIONS');
    const get = await handler(request('frameworks.evaluate'), 'frameworks.evaluate');
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST, OPTIONS');
  });

  it('never exposes more than the output schema allows', async () => {
    // Core strips undeclared keys in dispatch; the adapter must add none of its own.
    const res = await handlerWith([])(request('policy.areas'), 'policy.areas');
    expect(Object.keys((await res.json()) as object)).toEqual(['items']);
  });
});

describe('POST /api/v1/frameworks.evaluate', () => {
  const post = (
    body: BodyInit,
    headers: Record<string, string> = { 'content-type': 'application/json' },
  ) =>
    handlerWith([])(
      request('frameworks.evaluate', { method: 'POST', body, headers }),
      'frameworks.evaluate',
    );

  it('is never cached', async () => {
    const res = await post(
      JSON.stringify({
        framework: {
          title: 'x',
          rules: [
            {
              target: { kind: 'rollcall', congress: 119, chamber: 'house', number: 1 },
              alignedPosition: 'yea',
            },
          ],
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('etag')).toBeNull();
  });

  it('requires a JSON content type', async () => {
    const res = await post('{}', { 'content-type': 'text/plain' });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    expect((await post('{nope')).status).toBe(400);
    const big = await post(JSON.stringify({ filler: 'x'.repeat(MAX_BODY_BYTES) }));
    expect(big.status).toBe(400);
    expect(((await big.json()) as { error: { message: string } }).error.message).toContain(
      'exceeds',
    );
  });
});

describe('OPTIONS preflight', () => {
  it('is answered by the route helper with CORS headers', async () => {
    const { preflightResponse } = await import('../src/server/api/handler');
    const res = preflightResponse('req-12345678');
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });
});

describe('cache policy', () => {
  it('names a class for every public capability, and no-store only for evaluate', () => {
    for (const { name } of publicCapabilities()) {
      expect(CACHE_CLASS[name as keyof typeof CACHE_CLASS], name).toBeDefined();
      const control = cacheControlFor(name);
      if (name === 'frameworks.evaluate') expect(control).toBe('no-store');
      else expect(control).toMatch(/^public, max-age=0, s-maxage=\d+, stale-while-revalidate=\d+$/);
    }
    expect(cacheControlFor('curated.validate')).toBe('no-store');
  });

  it('uses POST only where the input is a document', () => {
    expect(
      publicCapabilities()
        .filter((c) => allowedMethodFor(c.name) === 'POST')
        .map((c) => c.name),
    ).toEqual(['frameworks.evaluate']);
  });
});

describe('failures and logging', () => {
  it('hides internals from the body and logs the cause, never headers', async () => {
    const broken = createDb({ kind: 'pglite' });
    await runMigrations(broken);
    await broken.close();
    const lines: string[] = [];
    const handler = handlerWith(lines, { ctx: (() => ({ db: broken.db })) as () => never });

    const res = await handler(
      request('policy.areas', {
        headers: { authorization: 'Bearer secret-token', cookie: 'session=secret-cookie' },
      }),
      'policy.areas',
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: 'internal', message: 'policy.areas failed' },
    });

    const logged = lines.join('');
    expect(logged).toContain('"requestId"');
    expect(logged).toContain('"capability":"policy.areas"');
    expect(logged).toContain('"status":500');
    expect(logged).toContain('"durationMs"');
    expect(logged).toContain('"level":"error"');
    expect(logged).not.toContain('secret-token');
    expect(logged).not.toContain('secret-cookie');
  });

  it('logs one structured line per request', async () => {
    const lines: string[] = [];
    await handlerWith(lines)(request('policy.areas'), 'policy.areas');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      level: 'info',
      service: 'civic-ledger-web',
      capability: 'policy.areas',
      method: 'GET',
      status: 200,
    });
  });

  it('redacts authorization and cookie fields if one is ever logged', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (l) => void lines.push(l) },
    });
    logger.info({ headers: { authorization: 'Bearer x', cookie: 'c=1', accept: 'json' } }, 'probe');
    const entry = JSON.parse(lines[0] as string) as { headers: Record<string, string> };
    expect(entry.headers).toEqual({ accept: 'json' });
  });
});
