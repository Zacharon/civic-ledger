import { defineConfig } from 'drizzle-kit';

// `generate` only diffs the schema against committed snapshots; it needs no database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
