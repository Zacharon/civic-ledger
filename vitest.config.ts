import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    // Each test file boots its own in-memory PGlite; migrations + seed take a few seconds.
    // Some files also spawn a child process with its own PGlite or tsx start-up; with one
    // worker per core those children starved (a 36 s file took 212 s). Half the cores.
    maxWorkers: '50%',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
