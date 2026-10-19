/**
 * Test fixture only: one real Postgres database shared by three separate processes, as in
 * production: `next start` (web UI + /api/v1) and the MCP stdio server, both on a
 * select-only login (DATABASE_URL_READONLY), plus owner connections for seed and changes.
 * Postgres is `PG_TEST_URL` (an admin URL, as in CI) or an embedded Postgres 17.
 */
import { type ChildProcess, fork, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IngestRunReceipt } from '@civic-ledger/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '../..');
const repoRoot = resolve(webDir, '../..');
const tsx = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const nextBin = join(webDir, 'node_modules', 'next', 'dist', 'bin', 'next');

const DB_SETTINGS =
  /^(DATABASE_URL|DATABASE_URL_READONLY|PGLITE_DATA_DIR|DB_ALLOW_OWNER_CREDENTIALS)$/;

/** The parent environment minus every database setting, so each process gets only its own. */
function cleanEnv(): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || DB_SETTINGS.test(key)) continue;
    out[key] = value;
  }
  // `next start` forces production anyway; the CLIs here (seed, changes) are writers.
  return { ...out, NODE_ENV: 'production' };
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address ? done(address.port) : fail(new Error('no port')),
      );
    });
  });
}

function withDatabase(adminUrl: string, database: string, user?: [string, string]): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  if (user) [url.username, url.password] = user;
  return url.toString();
}

async function exec(url: string, statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

function runTsx(script: string, args: string[], env: Record<string, string>): string {
  const result = spawnSync(process.execPath, [tsx, script, ...args], {
    cwd: repoRoot,
    env: { ...cleanEnv(), ...env },
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(`${script} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export interface ExitResult {
  code: number | null;
  stderr: string;
}

export interface PgStack {
  baseUrl: string;
  ownerUrl: string;
  readerUrl: string;
  mcp(): Client;
  startWeb(): Promise<void>;
  stopWeb(): Promise<void>;
  startMcp(): Promise<void>;
  stopMcp(): Promise<void>;
  /** Starts `next start` with exactly `env` (plus the clean parent) and waits for its exit. */
  webExit(env: Record<string, string>, timeoutMs?: number): Promise<ExitResult>;
  changeData(slug: string, newName: string, addCents: number): void;
  /** The actual operator CLI, restricted here to a test-owned curated snapshot. */
  ingestCurated(snapshot: string): IngestRunReceipt;
  /** Stops and starts only this fixture's Postgres server, retaining its data directory. */
  restartDatabase(): Promise<{ beforePid: number; afterPid: number }>;
  close(): Promise<void>;
}

const LIMITS = {
  RATE_LIMIT_SINGLE_BUCKET: '1',
  PAGE_RATE_LIMIT_PER_MINUTE: '100000',
  API_RATE_LIMIT_PER_MINUTE: '100000',
  API_RATE_LIMIT_EVALUATE_PER_MINUTE: '100000',
};

export async function startPgStack(options: { restartable?: boolean } = {}): Promise<PgStack> {
  let embedded: { child: ChildProcess; stop(): Promise<void> } | undefined;
  let embeddedDir: string | undefined;
  let embeddedPort = 0;
  // Restart scenarios must own their server; never stop a shared PG_TEST_URL service.
  let adminUrl = options.restartable ? '' : (process.env.PG_TEST_URL?.trim() ?? '');
  const startEmbedded = async (reuse = false) => {
    const child = fork(
      join(here, 'postgres-server.ts'),
      [embeddedDir ?? '', String(embeddedPort), reuse ? 'reuse' : 'initialise'],
      { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
    );
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Postgres fixture startup timeout: ${stderr}`)),
        60_000,
      );
      child.once('error', reject);
      child.once('message', (message: { type: string; message?: string }) => {
        clearTimeout(timer);
        if (message.type === 'ready') resolve();
        else reject(new Error(`Postgres fixture: ${message.message}`));
      });
      void exited.then((code) => {
        clearTimeout(timer);
        reject(new Error(`Postgres fixture exited (${code}): ${stderr}`));
      });
    });
    return {
      child,
      async stop() {
        if (child.connected) child.send({ type: 'stop' });
        await exited;
      },
    };
  };
  if (!adminUrl) {
    embeddedDir = await mkdtemp(join(tmpdir(), 'civic-e2e-pg-'));
    embeddedPort = await freePort();
    embedded = await startEmbedded();
    adminUrl = `postgres://postgres:postgres@127.0.0.1:${embeddedPort}/postgres`;
  }

  const database = `civic_e2e_${randomBytes(5).toString('hex')}`;
  const rawDir = await mkdtemp(join(tmpdir(), 'civic-e2e-ingest-raw-'));
  await exec(adminUrl, `create database "${database}"`);
  const ownerUrl = withDatabase(adminUrl, database);
  runTsx(join(repoRoot, 'packages/db/src/cli/seed.ts'), ['--allow-postgres'], {
    DATABASE_URL: ownerUrl,
  });
  runTsx(join(here, 'seed-parity.ts'), [ownerUrl], {});
  await exec(ownerUrl, await readFile(join(repoRoot, 'scripts/db/roles.sql'), 'utf8'));
  await exec(
    ownerUrl,
    `do $$ begin
       if not exists (select 1 from pg_roles where rolname = 'civic_e2e_web') then
         create role civic_e2e_web login password 'e2e-web-pw' in role civic_readonly;
       end if;
     end $$;
     alter role civic_e2e_web set default_transaction_read_only = on;`,
  );
  const readerUrl = withDatabase(adminUrl, database, ['civic_e2e_web', 'e2e-web-pw']);
  const port = await freePort();
  const baseUrl = `http://localhost:${port}`;

  let web: ChildProcess | undefined;
  let client: Client | undefined;

  const spawnWeb = (env: Record<string, string>, onPort = port) =>
    spawn(process.execPath, [nextBin, 'start', '-p', String(onPort)], {
      cwd: webDir,
      env: { ...cleanEnv(), ...LIMITS, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });

  const stack: PgStack = {
    baseUrl,
    ownerUrl,
    readerUrl,
    mcp: () => {
      if (!client) throw new Error('MCP not started');
      return client;
    },
    async startWeb() {
      const child = spawnWeb({ DATABASE_URL_READONLY: readerUrl });
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      web = child;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`next start exited: ${stderr}`);
        try {
          const response = await fetch(`${baseUrl}/api/health`);
          if (response.ok) return;
        } catch {
          // not listening yet
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error(`next start did not become healthy: ${stderr}`);
    },
    async stopWeb() {
      const child = web;
      web = undefined;
      if (!child || child.exitCode !== null) return;
      const exited = new Promise((r) => child.once('exit', r));
      child.kill();
      await exited;
    },
    async startMcp() {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [tsx, join(repoRoot, 'packages/mcp/src/cli.ts')],
        cwd: repoRoot,
        env: { ...cleanEnv(), DATABASE_URL_READONLY: readerUrl } as Record<string, string>,
        stderr: 'ignore',
      });
      client = new Client({ name: 'civic-e2e', version: '0.0.0' });
      await client.connect(transport);
    },
    async stopMcp() {
      await client?.close();
      client = undefined;
    },
    async webExit(env, timeoutMs = 60_000) {
      // Its own port: a refusal must not be confused with "address already in use".
      const child = spawnWeb(env, await freePort());
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      return new Promise((done) => {
        const timer = setTimeout(() => child.kill(), timeoutMs);
        child.once('exit', (code) => {
          clearTimeout(timer);
          done({ code, stderr });
        });
      });
    },
    changeData(slug, newName, addCents) {
      runTsx(
        join(webDir, 'e2e/support/change-data.ts'),
        [ownerUrl, slug, newName, String(addCents)],
        {},
      );
    },
    ingestCurated(snapshot) {
      return JSON.parse(
        runTsx(
          join(repoRoot, 'packages/ingest/src/cli.ts'),
          ['curated', '--snapshot', snapshot, '--raw-dir', rawDir],
          { DATABASE_URL: ownerUrl },
        ),
      ) as IngestRunReceipt;
    },
    async restartDatabase() {
      if (!embedded) throw new Error('Restart requires this fixture to own embedded Postgres');
      if (web || client) throw new Error('Stop web and MCP before restarting Postgres');
      const postgresPid = async () =>
        Number((await readFile(join(embeddedDir ?? '', 'postmaster.pid'), 'utf8')).split('\n')[0]);
      const beforePid = await postgresPid();
      await embedded.stop();
      embedded = await startEmbedded(true);
      const afterPid = await postgresPid();
      if (!beforePid || !afterPid) throw new Error('missing Postgres process id');
      return { beforePid, afterPid };
    },
    async close() {
      await stack.stopMcp().catch(() => undefined);
      await stack.stopWeb().catch(() => undefined);
      await exec(adminUrl, `drop database if exists "${database}" with (force)`).catch(
        () => undefined,
      );
      if (embedded) await embedded.stop();
      if (embeddedDir) await rm(embeddedDir, { recursive: true, force: true });
      await rm(rawDir, { recursive: true, force: true });
    },
  };
  return stack;
}
