/**
 * Test fixture only: one real Postgres database shared by three separate processes, as in
 * production: `next start` (web UI + /api/v1) and the MCP stdio server, both on a
 * select-only login (DATABASE_URL_READONLY), plus owner connections for seed and changes.
 * Postgres is `PG_TEST_URL` (an admin URL, as in CI) or an embedded Postgres 17.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import EmbeddedPostgres from 'embedded-postgres';
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

function runTsx(script: string, args: string[], env: Record<string, string>): void {
  const result = spawnSync(process.execPath, [tsx, script, ...args], {
    cwd: repoRoot,
    env: { ...cleanEnv(), ...env },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${script} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
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
  close(): Promise<void>;
}

const LIMITS = {
  RATE_LIMIT_SINGLE_BUCKET: '1',
  PAGE_RATE_LIMIT_PER_MINUTE: '100000',
  API_RATE_LIMIT_PER_MINUTE: '100000',
  API_RATE_LIMIT_EVALUATE_PER_MINUTE: '100000',
};

export async function startPgStack(): Promise<PgStack> {
  let embedded: EmbeddedPostgres | undefined;
  let embeddedDir: string | undefined;
  let adminUrl = process.env.PG_TEST_URL?.trim() ?? '';
  if (!adminUrl) {
    embeddedDir = await mkdtemp(join(tmpdir(), 'civic-e2e-pg-'));
    const port = await freePort();
    embedded = new EmbeddedPostgres({
      databaseDir: embeddedDir,
      port,
      user: 'postgres',
      password: 'postgres',
      persistent: false,
      postgresFlags: ['-c', 'fsync=off'],
      onLog: () => {},
      onError: () => {},
    });
    await embedded.initialise();
    await embedded.start();
    adminUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  }

  const database = `civic_e2e_${randomBytes(5).toString('hex')}`;
  await exec(adminUrl, `create database "${database}"`);
  const ownerUrl = withDatabase(adminUrl, database);
  runTsx(join(repoRoot, 'packages/db/src/cli/seed.ts'), ['--allow-postgres'], {
    DATABASE_URL: ownerUrl,
  });
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
    async close() {
      await stack.stopMcp().catch(() => undefined);
      await stack.stopWeb().catch(() => undefined);
      await exec(adminUrl, `drop database if exists "${database}" with (force)`).catch(
        () => undefined,
      );
      if (embedded) await embedded.stop();
      if (embeddedDir) await rm(embeddedDir, { recursive: true, force: true });
    },
  };
  return stack;
}
