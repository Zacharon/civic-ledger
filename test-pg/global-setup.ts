import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';
import type { ServerMessage } from './embedded-server';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Superuser connection string to the maintenance database. */
    pgAdminUrl: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no free port')),
      );
    });
  });
}

const SERVER_SCRIPT = fileURLToPath(new URL('./embedded-server.ts', import.meta.url));

/**
 * Runs the embedded Postgres in a child process (`embedded-server.ts`), never in the
 * vitest process. embedded-postgres registers async-exit-hook at import: its `beforeExit`
 * handler called `process.exit(0)` over vitest's failing exit code (DECISIONS A56), and
 * with that listener removed its `exit` handler called `gracefulShutdown()` without the
 * callback (`TypeError: done is not a function`, H3R2-05). In the child those hooks only
 * govern the child, and the stop below shuts down this server alone.
 */
async function startEmbeddedPostgres(databaseDir: string, port: number) {
  const child = fork(SERVER_SCRIPT, [databaseDir, String(port)], {
    execArgv: [],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('message', (message: ServerMessage) =>
      message.type === 'ready'
        ? resolve()
        : reject(new Error(`embedded Postgres failed to start: ${message.message}`)),
    );
    void exited.then((code) =>
      reject(new Error(`embedded Postgres process exited before it was ready (code ${code})`)),
    );
  });
  return {
    async stop(): Promise<void> {
      if (child.connected) child.send({ type: 'stop' });
      await exited;
    },
  };
}

/** CI points at a postgres:17 service via PG_TEST_URL; locally an embedded Postgres 17 is started. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const external = process.env.PG_TEST_URL?.trim();
  if (external) {
    project.provide('pgAdminUrl', external);
    return async () => {};
  }
  const databaseDir = await mkdtemp(join(tmpdir(), 'civic-embedded-pg-'));
  const port = await freePort();
  const server = await startEmbeddedPostgres(databaseDir, port);
  project.provide('pgAdminUrl', `postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
  return async () => {
    await server.stop();
    await rm(databaseDir, { recursive: true, force: true });
  };
}
