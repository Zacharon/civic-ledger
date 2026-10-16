import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from '../helpers';

/** Exit code `crash-run.ts` uses when it dies at the start of publication. */
export const CRASH_EXIT_CODE = 86;

const TSX = fileURLToPath(new URL('../../../../node_modules/tsx/dist/cli.mjs', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./crash-run.ts', import.meta.url));

/** Runs the crash child against a PGlite data dir or Postgres URL; resolves its exit code. */
export function runCrashChild(target: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX, SCRIPT, target], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== CRASH_EXIT_CODE) process.stderr.write(stderr);
      resolve(code);
    });
  });
}
