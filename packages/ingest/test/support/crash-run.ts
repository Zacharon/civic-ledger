/**
 * Child process for the process-loss tests (H3-01): runs one fixture ingest and exits hard
 * (no catch, no finally, no pool shutdown) the moment publication starts, i.e. when the
 * runtime asks for the read-model refresh. Exit code 86 proves the crash point was reached.
 *
 * Usage: tsx crash-run.ts <pglite-data-dir | postgres://url>
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, type DbHandle } from '@civic-ledger/db';
import { ADAPTERS } from '../../src/adapters/registry';
import { silentLogger } from '../../src/runtime/logger';
import { runIngest } from '../../src/runtime/run';
import { FIXTURES, REPO_ROOT } from '../helpers';

const CRASH_EXIT_CODE = 86;

const target = process.argv[2];
if (!target) throw new Error('usage: crash-run.ts <pglite-dir | postgres-url>');
const handle: DbHandle = target.startsWith('postgres')
  ? createDb({ kind: 'pg', url: target, poolMax: 4 })
  : createDb({ kind: 'pglite', dataDir: target });

await runIngest(
  {
    source: 'congress-legislators',
    scope: { kind: 'all' },
    snapshotPath: join(FIXTURES, 'congress-legislators'),
  },
  {
    handle,
    adapters: ADAPTERS,
    logger: silentLogger,
    rawRoot: join(tmpdir(), 'civic-crash-raw'),
    repoRoot: REPO_ROOT,
    refreshReadModel: async () => {
      process.exit(CRASH_EXIT_CODE);
    },
  },
);
// Reaching this line means the crash point was never hit.
process.exit(0);
