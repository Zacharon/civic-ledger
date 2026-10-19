import { defineConfig, devices } from '@playwright/test';

/** shared-values owns its web/MCP/Postgres processes; avoid unrelated scale servers. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'shared-values.spec.ts',
  outputDir: './test-results/parity',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
});
