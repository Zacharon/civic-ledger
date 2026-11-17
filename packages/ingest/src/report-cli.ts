import { resolve } from 'node:path';
import { attestReadOnlyCredentials, createDb, dbConfigFromEnv } from '@civic-ledger/db';
import { Command, InvalidArgumentError } from 'commander';
import { qualityReport } from './report';

/** `pnpm ingest:report`: join coverage and industry-coding gaps after a load (read-only). */
const positiveInt = (value: string) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new InvalidArgumentError('must be a positive integer');
  return parsed;
};
const year = new Date().getUTCFullYear();

const program = new Command('ingest:report')
  .description('Print data-quality metrics (JSON) for a loaded database.')
  .option('--congress <n>', 'congress', positiveInt, Math.floor((year - 1789) / 2) + 1)
  .option('--cycle <yyyy>', 'FEC cycle', positiveInt, year % 2 === 0 ? year : year + 1)
  .option('--db <dir>', 'PGlite data directory (default: $DATABASE_URL, else .pglite/dev)')
  .action(async (opts: { congress: number; cycle: number; db?: string }) => {
    const config = opts.db
      ? ({ kind: 'pglite', dataDir: resolve(opts.db) } as const)
      : dbConfigFromEnv(process.env, { readOnly: true });
    // Same read-only attestation as web and MCP (DECISIONS A61): a writable login is refused
    // in production unless DB_ALLOW_OWNER_CREDENTIALS=1; PGlite is skipped.
    const attestation = await attestReadOnlyCredentials(config, process.env);
    if (attestation.action === 'refuse') throw new Error(attestation.message);
    if (attestation.action === 'warn') {
      console.error(
        JSON.stringify({
          level: 'warn',
          event: 'db.readonly_attestation',
          problems: attestation.problems,
          warnings: attestation.warnings,
        }),
      );
    }
    const handle = createDb(config);
    try {
      console.log(
        JSON.stringify(await qualityReport(handle.db, opts.congress, opts.cycle), null, 2),
      );
    } finally {
      await handle.close();
    }
  });

await program.parseAsync();
