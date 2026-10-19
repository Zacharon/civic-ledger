import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './rollback',
  outputDir: './rollback-results',
  workers: 1,
  retries: 0,
  timeout: 300_000,
  use: { ...devices['Desktop Chrome'] },
});
