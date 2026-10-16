import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CapabilityError,
  type IngestRunReceipt,
  type IngestScope,
  SOURCE_IDS,
  type SourceId,
} from '@civic-ledger/core';
import { createDb, type DbConfig, dbConfigFromEnv } from '@civic-ledger/db';
import { runMigrations } from '@civic-ledger/db/migrate';
import { Command, InvalidArgumentError, Option } from 'commander';
import { ADAPTERS, PIPELINE_ORDER } from './adapters/registry';
import { createLogger } from './runtime/logger';
import { runIngest } from './runtime/run';
import { shrinkGuardFromEnv } from './runtime/shrink-guard';

/** `pnpm ingest <source|all>`: the operator entry point for ingest.run@1. */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const now = new Date();
const year = now.getUTCFullYear();
const DEFAULT_CONGRESS = Math.floor((year - 1789) / 2) + 1;
const DEFAULT_CYCLE = year % 2 === 0 ? year : year + 1;
const implemented = Object.keys(ADAPTERS);

const positiveInt = (label: string) => (value: string) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0)
    throw new InvalidArgumentError(`${label} must be a positive integer`);
  return n;
};

function scopeFor(source: SourceId, opts: { congress: number; cycle: number }): IngestScope {
  const kinds = ADAPTERS[source as keyof typeof ADAPTERS]?.scopes ?? [];
  if (kinds.includes('congress')) return { kind: 'congress', congress: opts.congress };
  if (kinds.includes('cycle')) return { kind: 'cycle', cycle: opts.cycle };
  return { kind: 'all' };
}

function dbConfig(dbDir: string | undefined): DbConfig {
  if (dbDir) return { kind: 'pglite', dataDir: resolve(dbDir) };
  return dbConfigFromEnv(process.env, { batch: true });
}

const program = new Command('ingest')
  .description(
    'Fetch, parse and load one public data source into the database (operator only).\n' +
      'Prints the ingest_run receipt as JSON on stdout; structured logs go to stderr.',
  )
  .argument('<source>', `one of: ${implemented.join(', ')}, or "all" (runs them in that order)`)
  .option(
    '--congress <n>',
    'congress for voteview / govinfo-billstatus',
    positiveInt('--congress'),
    DEFAULT_CONGRESS,
  )
  .option(
    '--cycle <yyyy>',
    'two-year cycle (even year) for fec-bulk',
    positiveInt('--cycle'),
    DEFAULT_CYCLE,
  )
  .option(
    '--snapshot <dir>',
    'load files already in <dir> instead of downloading (one source only)',
  )
  .option('--db <dir>', 'PGlite data directory (default: $DATABASE_URL, else .pglite/dev)')
  .option(
    '--raw-dir <dir>',
    'where raw snapshots are written (relative to the repo root)',
    join('data', 'raw'),
  )
  .addOption(new Option('--migrate', 'apply pending database migrations first').default(false))
  .addOption(
    new Option(
      '--allow-shrink',
      'commit a load the shrink guard refused (sweep deletes >10% of rows, or far fewer records than last run)',
    ).default(false),
  )
  .addHelpText(
    'after',
    `
Examples:
  pnpm ingest congress-legislators --db .pglite/live --migrate
  pnpm ingest voteview --congress 119
  pnpm ingest fec-bulk --cycle 2026
  pnpm ingest all --congress 119 --cycle 2026 --db .pglite/live --migrate
  pnpm ingest voteview --snapshot data/raw/voteview/2026-10-16

Shrink guard: a run is failed and rolled back when its stale-row sweep would delete more than
$INGEST_MAX_DELETE_FRACTION (default 0.1) of the source's rows, or it loads fewer than
$INGEST_MIN_RECORD_RATIO (default 0.5) of the last successful run's records. --allow-shrink overrides.

Exit codes: 0 succeeded (or already loaded), 1 failed or refused, 2 usage error.
A rerun of an unchanged snapshot returns the original run with "deduplicated": true.`,
  )
  .action(async (source: string, opts) => {
    const sources: SourceId[] =
      source === 'all'
        ? [...PIPELINE_ORDER]
        : implemented.includes(source)
          ? [source as SourceId]
          : [];
    if (sources.length === 0) {
      const planned = SOURCE_IDS.filter((s) => !implemented.includes(s));
      program.error(
        `Unknown source "${source}". Expected one of: ${implemented.join(', ')}, all` +
          (planned.includes(source as SourceId) ? ` ("${source}" is not implemented yet)` : ''),
        { exitCode: 2 },
      );
    }
    if (opts.snapshot && sources.length > 1) {
      program.error('--snapshot applies to a single source, not "all"', { exitCode: 2 });
    }

    const logger = createLogger();
    const shrinkGuard = shrinkGuardFromEnv(process.env, opts.allowShrink);
    const handle = createDb(dbConfig(opts.db));
    const abort = new AbortController();
    process.once('SIGINT', () => abort.abort(new Error('interrupted (SIGINT)')));
    const receipts: IngestRunReceipt[] = [];
    try {
      if (opts.migrate) {
        await runMigrations(handle);
        logger.info('migrations applied');
      }
      for (const id of sources) {
        const receipt = await runIngest(
          {
            source: id,
            scope: scopeFor(id, opts),
            ...(opts.snapshot ? { snapshotPath: opts.snapshot } : {}),
          },
          {
            handle,
            adapters: ADAPTERS,
            logger,
            rawRoot: resolve(REPO_ROOT, opts.rawDir),
            repoRoot: REPO_ROOT,
            signal: abort.signal,
            shrinkGuard,
          },
        );
        receipts.push(receipt);
        if (receipt.status !== 'succeeded') break;
      }
    } catch (error) {
      if (error instanceof CapabilityError) {
        console.error(`ingest: ${error.code}: ${error.message}`);
        process.exitCode = error.code === 'invalid_input' ? 2 : 1;
        return;
      }
      throw error;
    } finally {
      if (receipts.length > 0) {
        console.log(JSON.stringify(receipts.length === 1 ? receipts[0] : receipts, null, 2));
      }
      await handle.close();
    }
    if (receipts.some((r) => r.status !== 'succeeded')) process.exitCode = 1;
  });

await program.parseAsync();
