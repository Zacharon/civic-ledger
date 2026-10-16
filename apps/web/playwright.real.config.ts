import { defineConfig, devices } from '@playwright/test';

/**
 * Real-data visual QA (not part of `test:e2e`): screenshots and page timings against a
 * server already running on a real database, e.g.
 *   PGLITE_DATA_DIR=../../.pglite/live DB_ALLOW_OWNER_CREDENTIALS=1 pnpm --filter web start -p 3400
 *   REAL_BASE_URL=http://localhost:3400 pnpm --filter web screenshots:real
 */
export default defineConfig({
  testDir: './e2e-real',
  outputDir: './test-results/real',
  workers: 1,
  timeout: 180_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.REAL_BASE_URL ?? 'http://localhost:3400',
    colorScheme: 'light',
    deviceScaleFactor: 1,
  },
});
