import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

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

/**
 * embedded-postgres registers async-exit-hook at import, whose `beforeExit` handler calls
 * `process.exit(0)` and so replaced vitest's failing exit code: `pnpm test:pg` exited 0
 * with failed tests. Import it only when needed and drop that one listener; teardown
 * below stops the server explicitly, and the signal hooks stay in place.
 */
async function importEmbeddedPostgres() {
  const before = new Set(process.listeners('beforeExit'));
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  for (const listener of process.listeners('beforeExit')) {
    if (!before.has(listener)) process.removeListener('beforeExit', listener);
  }
  return EmbeddedPostgres;
}

/** CI points at a postgres:17 service via PG_TEST_URL; locally an embedded Postgres 17 is started. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const external = process.env.PG_TEST_URL?.trim();
  if (external) {
    project.provide('pgAdminUrl', external);
    return async () => {};
  }
  const EmbeddedPostgres = await importEmbeddedPostgres();
  const databaseDir = await mkdtemp(join(tmpdir(), 'civic-embedded-pg-'));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'fsync=off', '-c', 'max_connections=200'],
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();
  project.provide('pgAdminUrl', `postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
  return async () => {
    await server.stop();
    await rm(databaseDir, { recursive: true, force: true });
  };
}
