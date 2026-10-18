import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));
// Nothing listens on port 1: if the CLI ever tried to connect, it would fail differently.
const OWNER_URL = 'postgres://owner:owner-secret@127.0.0.1:1/civic';

// A cold tsx start of the CLI takes ~5 s on an idle Windows machine and several times that
// while the full suite runs in parallel; 30 s budgets killed the child (status null).
const CLI_BUDGET_MS = 120_000;

function startCli(env: Record<string, string>, args: string[] = []) {
  const { DATABASE_URL, DATABASE_URL_READONLY, DB_ALLOW_OWNER_CREDENTIALS, ...rest } = process.env;
  const result = spawnSync(process.execPath, [TSX, CLI, ...args], {
    env: { ...rest, ...env },
    input: '',
    encoding: 'utf8',
    timeout: CLI_BUDGET_MS,
  });
  if (result.status === null) {
    throw new Error(
      `mcp CLI did not exit within ${CLI_BUDGET_MS} ms (signal ${result.signal}): a start-up time problem, not a credential result`,
    );
  }
  return result;
}

/** VC-068: the real MCP process refuses to start in production without a read-only role. */
describe('mcp server startup credentials', { timeout: CLI_BUDGET_MS + 10_000 }, () => {
  it('exits 1 with a clear message instead of connecting as DATABASE_URL', () => {
    const result = startCli({ NODE_ENV: 'production', DATABASE_URL: OWNER_URL });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    const line = JSON.parse(result.stderr.trim().split('\n').at(-1) ?? '{}') as {
      message?: string;
      cause?: string;
    };
    expect(line.message).toBe('mcp server failed to start');
    expect(line.cause).toMatch(/DATABASE_URL_READONLY is not set/);
    expect(result.stderr).not.toContain('owner-secret');
  });

  it('also refuses an unacknowledged --pglite directory in production', () => {
    const result = startCli({ NODE_ENV: 'production' }, [
      '--pglite',
      join(tmpdir(), 'civic-mcp-never-opened'),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/DB_ALLOW_OWNER_CREDENTIALS=1/);
  });

  it('gets past the credential check when acknowledged (then fails to reach the database)', () => {
    const result = startCli({
      NODE_ENV: 'production',
      DATABASE_URL: OWNER_URL,
      DB_ALLOW_OWNER_CREDENTIALS: '1',
      DB_CONNECT_TIMEOUT_MS: '2000',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/database is not ready/);
    expect(result.stderr).not.toMatch(/DATABASE_URL_READONLY is not set/);
  });
});
