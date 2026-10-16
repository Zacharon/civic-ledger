import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    // Each test file boots its own in-memory PGlite; migrations + seed take a few seconds.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
