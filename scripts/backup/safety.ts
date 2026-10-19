import { spawn } from 'node:child_process';
import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

/** The persistent source tree must survive checkout cleanup and be explicitly scoped. */
export async function persistentRawRoot(
  value: string | undefined,
  checkout: string,
): Promise<string> {
  if (!value || !isAbsolute(value))
    throw new Error(
      'CIVIC_RAW_ROOT must be an absolute runner-owned directory outside the checkout',
    );
  const path = resolve(value);
  const repo = await realpath(checkout);
  const info = await lstat(path);
  if (
    path === parse(path).root ||
    (await lstat(path)).isSymbolicLink() ||
    (await realpath(path)) !== path ||
    !(await lstat(path)).isDirectory()
  )
    throw new Error('CIVIC_RAW_ROOT must be a real scoped directory');
  if (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o022) !== 0))
    throw new Error(
      'CIVIC_RAW_ROOT must be owned by the runner user and not writable by other users',
    );
  const outside = (candidate: string) => candidate === '..' || candidate.startsWith(`..${sep}`);
  if (!outside(relative(repo, path)) || !outside(relative(path, repo)))
    throw new Error('CIVIC_RAW_ROOT must be separate from the checkout and its ancestors');
  const marker = JSON.parse(await readFile(join(path, '.civic-ledger-raw-root.json'), 'utf8')) as {
    version: number;
    purpose: string;
  };
  if (marker.version !== 1 || marker.purpose !== 'civic-ledger-raw-snapshots')
    throw new Error('CIVIC_RAW_ROOT lacks the operator-created scope marker');
  return path;
}

export function safeError(error: unknown): string {
  // Driver errors can include connection strings, SQL, environment or arbitrary remote text.
  // Expose only our bounded actionable messages and stable server error codes.
  const message = error instanceof Error ? error.message : 'operation failed';
  return message
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@[^\s"']+/gi, '[web credentials redacted]')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database redacted]')
    .replace(/(password|secret|token)=\S+/gi, '$1=[redacted]')
    .slice(0, 300);
}

export function databaseIdentity(value: string): string {
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.pathname.slice(1)
  ) {
    throw new Error('database must be an explicit PostgreSQL connection');
  }
  return `${url.hostname.toLowerCase()}:${url.port || '5432'}${url.pathname}`;
}

/** libpq receives secrets in the environment, never in argv or error output. */
export function pgEnvironment(value: string): NodeJS.ProcessEnv {
  databaseIdentity(value);
  const url = new URL(value);
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get('sslmode') || 'prefer',
    PGCONNECT_TIMEOUT: '30',
    PGAPPNAME: 'civic-ledger-backup',
    PGOPTIONS: '-c timezone=UTC -c statement_timeout=3600000 -c lock_timeout=30000',
  };
}

export async function runTool(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stdoutBytes = 0;
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      // Raw snapshot indexes can legitimately exceed 1 MiB on BILLSTATUS. Keep
      // a finite budget and refuse overflow rather than parsing truncated JSON.
      stdoutBytes += chunk.length;
      if (stdoutBytes > 64 * 1024 ** 2) {
        child.kill();
        reject(new Error(`${basename(command)} output exceeded its 64-MiB budget`));
      } else stdout += chunk;
    });
    // Never inherit libpq or object-store stderr: provider details may include credentials.
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${basename(command)} exceeded its 60-minute budget`));
    }, 3_600_000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error(`${basename(command)} could not start`));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(stdout);
      else
        reject(
          new Error(
            `${basename(command)} failed (exit ${code}); inspect access and tool versions privately`,
            { cause: new Error(safeError(new Error(stderr))) },
          ),
        );
    });
  });
}

/** Scratch roots are created by us; callers cannot supply a path that will be recursively removed. */
export async function scratchDirectory(): Promise<{ path: string; close(): Promise<void> }> {
  const parent = await realpath(tmpdir());
  const path = await mkdtemp(join(parent, 'civic-ledger-ops-'));
  return {
    path,
    async close() {
      const actual = await realpath(path);
      if (
        dirname(actual) !== parent ||
        !basename(actual).startsWith('civic-ledger-ops-') ||
        resolve(path) !== actual
      ) {
        throw new Error('refusing scratch cleanup outside its verified temporary parent');
      }
      await rm(actual, { recursive: true, force: false });
    },
  };
}
