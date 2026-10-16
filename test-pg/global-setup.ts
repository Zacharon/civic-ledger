import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
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

/** CI points at a postgres:17 service via PG_TEST_URL; locally an embedded Postgres 17 is started. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const external = process.env.PG_TEST_URL?.trim();
  if (external) {
    project.provide('pgAdminUrl', external);
    return async () => {};
  }
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
