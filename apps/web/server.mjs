import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { requestIdFrom } from './src/server/api/request-id.ts';

function integer(env, name, fallback) {
  const value = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isSafeInteger(value) || value < 1 || value > 120_000) {
    throw new Error(`${name} must be an integer from 1 to 120000`);
  }
  return value;
}

export function loadServerTimeouts(env = process.env) {
  const config = {
    headersTimeout: integer(env, 'HTTP_HEADERS_TIMEOUT_MS', 10_000),
    requestTimeout: integer(env, 'HTTP_REQUEST_TIMEOUT_MS', 30_000),
    inactivityTimeout: integer(env, 'HTTP_INACTIVITY_TIMEOUT_MS', 30_000),
    keepAliveTimeout: integer(env, 'HTTP_KEEP_ALIVE_TIMEOUT_MS', 5_000),
    responseTimeout: integer(env, 'HTTP_RESPONSE_TIMEOUT_MS', 25_000),
  };
  if (config.headersTimeout > config.requestTimeout) {
    throw new Error('HTTP_HEADERS_TIMEOUT_MS must not exceed HTTP_REQUEST_TIMEOUT_MS');
  }
  return config;
}

export function loadServerAddress(args = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: 'string', short: 'p' },
      hostname: { type: 'string', short: 'H' },
    },
  });
  const port = Number(values.port ?? env.PORT ?? 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return { port, hostname: values.hostname ?? env.HOSTNAME ?? '0.0.0.0' };
}

/** A small native Node boundary; Next continues to own routing and all application rules. */
export function createBoundedServer(handler, env = process.env) {
  const timeouts = loadServerTimeouts(env);
  const server = createServer(
    {
      headersTimeout: timeouts.headersTimeout,
      requestTimeout: timeouts.requestTimeout,
      keepAliveTimeout: timeouts.keepAliveTimeout,
      connectionsCheckingInterval: Math.min(1_000, timeouts.headersTimeout),
      maxHeaderSize: 16_384,
    },
    (request, response) => {
      const requestId = requestIdFrom(
        new Headers({
          'x-request-id': String(request.headers['x-request-id'] ?? ''),
        }),
      );
      request.headers['x-request-id'] = requestId;
      response.setHeader('x-request-id', requestId);
      const timer = setTimeout(() => {
        // End the response even if a read keeps producing chunks; inactivity alone is insufficient.
        if (!response.headersSent) {
          response.writeHead(503, {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
          });
          response.end('The request took too long. Try again.');
        } else {
          response.destroy();
        }
      }, timeouts.responseTimeout);
      const clear = () => clearTimeout(timer);
      response.once('finish', clear);
      response.once('close', clear);
      Promise.resolve()
        .then(() => handler(request, response))
        .catch(() => {
          // No raw handler errors: driver exceptions can contain credentials or SQL.
          if (!response.headersSent) {
            response.writeHead(500, {
              'content-type': 'text/plain; charset=utf-8',
              'cache-control': 'no-store',
            });
            response.end('The request could not be completed. Try again.');
          } else response.destroy();
        });
    },
  );
  server.setTimeout(timeouts.inactivityTimeout, (socket) => socket.destroy());
  return server;
}

async function main() {
  process.env.NODE_ENV ??= 'production';
  const { port, hostname } = loadServerAddress();
  const { default: next } = await import('next');
  const app = next({
    dev: false,
    dir: fileURLToPath(new URL('.', import.meta.url)),
    hostname,
    port,
  });
  await app.prepare();
  const server = createBoundedServer(app.getRequestHandler());
  server.on('error', () => {
    process.stderr.write('{"event":"web.server_failed"}\n');
    process.exitCode = 1;
    void app.close();
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const timer = setTimeout(() => server.closeAllConnections(), 8_000);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      void app.close();
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  server.listen(port, hostname, () => {
    process.stdout.write(`${JSON.stringify({ event: 'web.listening', port })}\n`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('{"event":"web.startup_failed"}\n');
    process.exitCode = 1;
  });
}
