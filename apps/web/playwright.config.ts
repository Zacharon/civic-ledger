import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a production build (`next build` runs first via `pnpm test:e2e`).
 * Port 3300 serves the fictional seed; 3301 the seed plus 560 fictional members (600 rows)
 * for the performance budget. Each server gets its own throwaway PGlite.
 */
const PORT = 3300;
const SCALE_PORT = 3301;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  // Four workers share one machine with two Next servers; allow for slow navigations.
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /(screenshots|performance)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // Runs after the functional suite so timing is not skewed by parallel tests.
      name: 'performance',
      testMatch: /performance\.spec\.ts/,
      dependencies: ['desktop'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'screenshots',
      testMatch: /screenshots\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `node e2e/support/start-server.mjs ${PORT}`,
      url: `http://localhost:${PORT}/sources`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'ignore',
    },
    {
      command: `node e2e/support/start-server.mjs ${SCALE_PORT} 560`,
      url: `http://localhost:${SCALE_PORT}/sources`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'ignore',
    },
  ],
});
