import { describe, expect, it } from 'vitest';
import { createCapabilityHandler } from '../src/server/api/handler';
import { createLogger } from '../src/server/api/logger';

describe('request failure boundaries', () => {
  it('returns 408 and cancels an unfinished JSON body within its configured deadline', async () => {
    let cancelled = false;
    let source: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller;
        controller.enqueue(new TextEncoder().encode('{'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const handler = createCapabilityHandler({
      context: () => {
        throw new Error('a stalled body must never dispatch');
      },
      logger: createLogger({ level: 'silent' }),
      bodyReadTimeoutMs: 30,
    });
    const request = new Request('http://localhost/api/v1/frameworks.evaluate', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', 'x-request-id': 'body-deadline-123' },
      duplex: 'half',
    } as RequestInit);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      handler(request, 'frameworks.evaluate'),
      new Promise<'test deadline'>((resolve) => {
        deadline = setTimeout(() => resolve('test deadline'), 500);
      }),
    ]);
    clearTimeout(deadline);
    if (!cancelled) source?.close();
    expect(outcome).not.toBe('test deadline');
    if (outcome === 'test deadline') return;
    expect(outcome.status).toBe(408);
    expect(outcome.headers.get('cache-control')).toBe('no-store');
    expect(outcome.headers.get('x-request-id')).toBe('body-deadline-123');
    expect(cancelled).toBe(true);
  });

  it('keeps credential-shaped exception details out of the final log sink', async () => {
    const lines: string[] = [];
    const marker = 'SYNTHETIC_LOG_SECRET_813';
    const failure = new Error(`postgres://operator:${marker}@example.invalid/private`);
    Object.assign(failure, { code: '28P01', detail: { token: marker } });
    const handler = createCapabilityHandler({
      context: () => {
        throw failure;
      },
      logger: createLogger({
        level: 'info',
        destination: { write: (line) => void lines.push(line) },
      }),
    });
    const response = await handler(
      new Request('http://localhost/api/v1/policy.areas', {
        headers: { 'x-request-id': 'logging-canary-123' },
      }),
      'policy.areas',
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(marker);
    expect(lines.join('')).not.toContain(marker);
    const entry = JSON.parse(lines[0] ?? '{}');
    expect(entry.requestId).toBe('logging-canary-123');
    expect(entry.capability).toBe('policy.areas');
    expect(entry.status).toBe(500);
    expect(entry.err.code).toBe('28P01');
  });

  it('returns the normal error response even when the log sink fails', async () => {
    const handler = createCapabilityHandler({
      context: () => {
        throw new Error('must not dispatch');
      },
      logger: createLogger({
        level: 'info',
        destination: {
          write() {
            throw new Error('sink unavailable');
          },
        },
      }),
    });
    const response = await handler(
      new Request('http://localhost/api/v1/no-such-capability'),
      'no-such-capability',
    );
    expect(response.status).toBe(404);
  });
});
