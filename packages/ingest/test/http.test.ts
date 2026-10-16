import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { downloadToFile } from '../src/runtime/download';
import {
  backoffDelayMs,
  DEFAULT_RETRY_POLICY,
  type HttpDeps,
  HttpError,
  httpGet,
  retryAfterMs,
} from '../src/runtime/http';

type Step = Response | Error | 'hang';

/** Scripted fetch: each call consumes one step; records the request headers. */
function scripted(steps: Step[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const sleeps: number[] = [];
  const deps: HttpDeps = {
    fetch: async (input, init) => {
      calls.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
      const step = steps.shift();
      if (!step) throw new Error('unexpected extra request');
      if (step === 'hang') {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }
      if (step instanceof Error) throw step;
      return step;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
  };
  return { deps, calls, sleeps };
}

const status = (code: number, headers: Record<string, string> = {}) =>
  new Response(code === 304 ? null : `status ${code}`, { status: code, headers });

describe('retry policy', () => {
  it('retries 5xx and 429 then succeeds, with full-jitter exponential backoff', async () => {
    const { deps, calls, sleeps } = scripted([status(503), status(429), status(200)]);
    const res = await httpGet('https://example.org/f', {}, deps);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
    // random() = 0.5: half of base * 2^attempt.
    expect(sleeps).toEqual([500, 1000]);
  });

  it('honors Retry-After on 429, capped by the policy maximum', async () => {
    const { deps, sleeps } = scripted([status(429, { 'retry-after': '7' }), status(200)]);
    await httpGet('https://example.org/f', {}, deps);
    expect(sleeps).toEqual([7000]);
    expect(retryAfterMs('9999', DEFAULT_RETRY_POLICY)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
  });

  it('does not retry other 4xx responses', async () => {
    const { deps, calls } = scripted([status(404)]);
    await expect(httpGet('https://example.org/missing', {}, deps)).rejects.toMatchObject({
      name: 'HttpError',
      status: 404,
    });
    expect(calls).toHaveLength(1);
  });

  it('retries network errors at most 3 times (4 attempts) and then fails', async () => {
    const network = () =>
      Object.assign(new TypeError('fetch failed'), { cause: new Error('ECONNRESET') });
    const { deps, calls, sleeps } = scripted([network(), network(), network(), network()]);
    await expect(httpGet('https://example.org/f', {}, deps)).rejects.toThrow('fetch failed');
    expect(calls).toHaveLength(4);
    expect(sleeps).toHaveLength(3);
  });

  it('gives up on a persistent 503 after the retry budget', async () => {
    const { deps, calls } = scripted([status(503), status(503), status(503), status(503)]);
    await expect(httpGet('https://example.org/f', {}, deps)).rejects.toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(4);
  });

  it('times out a hanging request (AbortSignal.timeout) and retries it as transient', async () => {
    const { deps, calls } = scripted(['hang', status(200)]);
    const res = await httpGet('https://example.org/slow', { timeoutMs: 20 }, deps);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('does not retry when the run itself was cancelled', async () => {
    const controller = new AbortController();
    const { deps, calls } = scripted(['hang', status(200)]);
    const pending = httpGet(
      'https://example.org/f',
      { signal: controller.signal, timeoutMs: 5_000 },
      deps,
    );
    controller.abort(new Error('operator cancelled'));
    await expect(pending).rejects.toThrow('operator cancelled');
    expect(calls).toHaveLength(1);
  });

  it('caps the backoff ceiling at maxDelayMs', () => {
    const policy = { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 4_000 };
    expect(backoffDelayMs(10, policy, () => 0.999)).toBeLessThan(4_000);
    expect(backoffDelayMs(0, policy, () => 0)).toBe(0);
  });

  it('sends the project User-Agent, or a browser-like one when asked', async () => {
    const { deps, calls } = scripted([status(200), status(200)]);
    await httpGet('https://example.org/a', {}, deps);
    await httpGet('https://example.org/b', { browserLike: true }, deps);
    expect(calls[0]?.headers['user-agent']).toMatch(/^CivicLedgerIngest/);
    expect(calls[1]?.headers['user-agent']).toMatch(/^Mozilla/);
  });
});

describe('downloadToFile', () => {
  it('streams to disk with sha256, then uses conditional GET and reuses the copy on 304', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'civic-dl-'));
    const cachePath = join(dir, 'http-cache.json');
    const ok = new Response('hello,world\n', {
      status: 200,
      headers: { etag: '"v1"', 'last-modified': 'Thu, 15 Oct 2026 05:40:05 GMT' },
    });
    const { deps, calls } = scripted([ok, status(304)]);

    const first = await downloadToFile(
      { url: 'https://example.org/f.csv', targetPath: join(dir, 'a', 'f.csv'), cachePath },
      deps,
    );
    expect(first).toMatchObject({ bytes: 12, notModified: false });
    expect(first.sha256).toBe(createHash('sha256').update('hello,world\n').digest('hex'));

    const second = await downloadToFile(
      { url: 'https://example.org/f.csv', targetPath: join(dir, 'b', 'f.csv'), cachePath },
      deps,
    );
    expect(second).toMatchObject({ notModified: true, sha256: first.sha256, bytes: 12 });
    expect(calls[1]?.headers['if-none-match']).toBe('"v1"');
    expect(calls[1]?.headers['if-modified-since']).toBe('Thu, 15 Oct 2026 05:40:05 GMT');
    expect(await readFile(join(dir, 'b', 'f.csv'), 'utf8')).toBe('hello,world\n');
  });

  it('leaves no partial file when the body fails mid-stream', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'civic-dl-'));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'));
        controller.error(new Error('connection reset'));
      },
    });
    const { deps } = scripted([new Response(body, { status: 200 })]);
    await expect(
      downloadToFile(
        {
          url: 'https://example.org/f',
          targetPath: join(dir, 'f'),
          cachePath: join(dir, 'c.json'),
        },
        deps,
      ),
    ).rejects.toThrow('connection reset');
    expect(await readdir(dir)).toEqual([]);
  });
});
