import { resolve } from 'node:path';
import { createDb, type DbConfig, dbConfigFromEnv, dispatchByName } from '@civic-ledger/core';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer, SERVER_NAME } from './server';

const USAGE = `Usage: pnpm --filter @civic-ledger/mcp start [--pglite <dir>]

Runs the Civic Ledger MCP server over stdio (read-only tools).
Database: DATABASE_URL (Postgres), else --pglite <dir>, else .pglite/dev.
Logs are JSON lines on stderr; stdout carries the protocol and nothing else.`;

function log(level: 'info' | 'error', message: string, extra: Record<string, unknown> = {}): void {
  const line = { level, time: new Date().toISOString(), name: SERVER_NAME, message, ...extra };
  process.stderr.write(`${JSON.stringify(line)}\n`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `pnpm --filter` runs scripts inside the package, so relative paths follow where the user typed. */
const invokedFrom = process.env.INIT_CWD ?? process.cwd();

function parseConfig(argv: string[]): DbConfig | undefined {
  if (argv.includes('--help') || argv.includes('-h')) return undefined;
  const flag = argv.indexOf('--pglite');
  if (flag !== -1) {
    const dir = argv[flag + 1];
    if (!dir) throw new Error('--pglite needs a directory');
    return { kind: 'pglite', dataDir: resolve(invokedFrom, dir) };
  }
  const config = dbConfigFromEnv(process.env, { readOnly: true });
  return config.kind === 'pglite'
    ? { kind: 'pglite', dataDir: resolve(invokedFrom, '.pglite/dev') }
    : config;
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  if (!config) {
    process.stderr.write(`${USAGE}\n`);
    return;
  }
  const handle = createDb(config);
  // Fail at startup, not on the first tool call, when the database is empty or unreachable.
  try {
    await dispatchByName('sources.status', {}, { db: handle.db });
  } catch (error) {
    const cause = error instanceof Error && error.cause ? error.cause : error;
    throw new Error(`database is not ready (run pnpm db:migrate and db:seed): ${describe(cause)}`);
  }
  const server = createMcpServer({
    ctx: { db: handle.db },
    onError: (cause, tool) => log('error', 'tool failed', { tool, cause: describe(cause) }),
  });
  const shutdown = async (): Promise<void> => {
    await server.close();
    await handle.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  // The client closing our stdin is the normal way a stdio session ends.
  process.stdin.once('end', () => void shutdown());
  await server.connect(new StdioServerTransport());
  log('info', 'mcp server ready', { database: config.kind });
}

main().catch((error: unknown) => {
  log('error', 'mcp server failed to start', { cause: describe(error) });
  process.exit(1);
});
