import { once } from 'node:events';
import type { Server } from 'node:http';
import { connect } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createBoundedServer, loadServerTimeouts } from '../server.mjs';

async function listening(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP port');
  return address.port;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('production HTTP server budgets', () => {
  it('refuses invalid and disabled budgets', () => {
    expect(loadServerTimeouts({}).requestTimeout).toBe(30_000);
    for (const value of ['0', '-1', 'NaN', '100ms', '1000000']) {
      expect(() => loadServerTimeouts({ HTTP_REQUEST_TIMEOUT_MS: value })).toThrow();
    }
    expect(() => loadServerTimeouts({ HTTP_REQUEST_TIMEOUT_MS: '100' })).toThrow();
  });

  it('returns a correlated 503 when a handler never responds, then serves another request', async () => {
    const server = createBoundedServer(
      (request, response) => {
        if (request.url === '/ok') response.end('recovered');
      },
      { HTTP_RESPONSE_TIMEOUT_MS: '50' },
    );
    const port = await listening(server);
    try {
      const result = await fetch(`http://127.0.0.1:${port}/stalled`, {
        headers: { 'x-request-id': 'server-budget-123' },
      });
      expect(result.status).toBe(503);
      expect(result.headers.get('x-request-id')).toBe('server-budget-123');
      expect(result.headers.get('cache-control')).toBe('no-store');
      expect(await result.text()).toContain('Try again');
      expect(await (await fetch(`http://127.0.0.1:${port}/ok`)).text()).toBe('recovered');
    } finally {
      await close(server);
    }
  });

  it('rejects incomplete headers on a real socket without reaching the app', async () => {
    let dispatched = false;
    const server = createBoundedServer(
      (_, response) => {
        dispatched = true;
        response.end('unexpected');
      },
      { HTTP_HEADERS_TIMEOUT_MS: '50', HTTP_REQUEST_TIMEOUT_MS: '100' },
    );
    const port = await listening(server);
    const socket = connect(port, '127.0.0.1');
    const pieces: string[] = [];
    socket.on('data', (chunk) => pieces.push(chunk.toString()));
    socket.on('error', () => {});
    try {
      await once(socket, 'connect');
      socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nIncomplete: ');
      await once(socket, 'close');
      expect(pieces.join('')).toContain('408');
      expect(dispatched).toBe(false);
    } finally {
      socket.destroy();
      await close(server);
    }
  });
});
