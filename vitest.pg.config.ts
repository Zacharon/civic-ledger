import { defineConfig } from 'vitest/config';

/**
 * Opt-in suite against real Postgres: `pnpm test:pg`. Uses `PG_TEST_URL` (an admin
 * connection string, as in the CI postgres:17 service) or starts an embedded Postgres 17.
 */
export default defineConfig({
  test: {
    include: ['test-pg/**/*.pgtest.ts'],
    environment: 'node',
    globalSetup: ['test-pg/global-setup.ts'],
    // One server, one database per test file; files run in turn to keep the server calm.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
