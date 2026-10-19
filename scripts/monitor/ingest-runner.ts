import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { persistentRawRoot } from '../backup/safety';

export function scheduledSources(kind: string): string[] {
  if (kind === 'daily') return ['congress-legislators', 'govinfo-billstatus'];
  if (kind === 'weekly') return ['voteview', 'fec-bulk'];
  throw new Error('schedule must be daily or weekly');
}
const { values } = parseArgs({ options: { schedule: { type: 'string' } } });
if (process.env.CIVIC_DEPLOYMENT_ENABLED !== 'true' || !process.env.DATABASE_URL) {
  throw new Error(
    'scheduled ingest requires explicit deployment activation and scoped ingest credentials',
  );
}
const congress = Number(process.env.CIVIC_CONGRESS);
const cycle = Number(process.env.CIVIC_CYCLE);
const rawRoot = await persistentRawRoot(process.env.CIVIC_RAW_ROOT, process.cwd());
if (
  !Number.isInteger(congress) ||
  congress < 1 ||
  !Number.isInteger(cycle) ||
  cycle < 2000 ||
  cycle % 2 !== 0
)
  throw new Error('explicit CIVIC_CONGRESS and even CIVIC_CYCLE are required');
for (const source of scheduledSources(values.schedule ?? '')) {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'packages/ingest/src/cli.ts',
      source,
      '--congress',
      String(congress),
      '--cycle',
      String(cycle),
      '--deadline-minutes',
      '45',
      '--raw-dir',
      rawRoot,
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) {
    process.exitCode = 1;
    break;
  }
}
