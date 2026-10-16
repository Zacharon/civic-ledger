import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createDb, dbConfigFromEnv } from '@civic-ledger/db';
import { runRealSmoke } from './real';

/**
 * `pnpm smoke:real -- --db <pglite dir>` (or `DATABASE_URL=… pnpm smoke:real`).
 * Prints the report as JSON on stdout, progress on stderr; exit 1 on any capability error.
 */
const { values } = parseArgs({
  // pnpm forwards the `--` separator itself; drop it so `--db` still parses.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    db: { type: 'string' },
    former: { type: 'string', default: '100' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`Usage: pnpm smoke:real -- --db <pglite dir> [--former <n>]

Dispatches every public capability over a real database (read-only) and fails on any
CapabilityError or output validation error. Without --db, uses DATABASE_URL.
  --former <n>   former members to sample for profile reads (default 100)`);
  process.exit(0);
}

const formerSample = Number(values.former);
if (!Number.isInteger(formerSample) || formerSample < 0) {
  console.error('--former must be a non-negative integer');
  process.exit(2);
}

const handle = createDb(
  values.db ? { kind: 'pglite', dataDir: resolve(values.db) } : dbConfigFromEnv(),
);
try {
  const report = await runRealSmoke(
    { db: handle.db },
    {
      formerSample,
      onProgress: (calls, failures) => console.error(`… ${calls} calls, ${failures} failures`),
    },
  );
  console.log(JSON.stringify(report, null, 2));
  console.error(
    `${report.ok ? 'PASS' : 'FAIL'}: ${report.calls} calls, ${report.failureCount} failures, ` +
      `${report.currentMembers} current members, ${report.formerMembersSampled} former sampled, ` +
      `${report.sortColumns} sort columns x 2 scopes, ${report.policyAreas} policy areas, ${report.seconds}s`,
  );
  process.exitCode = report.ok ? 0 : 1;
} finally {
  await handle.close();
}
