/**
 * Child process that owns the local embedded Postgres 17 for `pnpm test:pg`; started by
 * `global-setup.ts` with `fork` (Node 24 strips the types). Arguments: data directory, port.
 *
 * embedded-postgres installs process-wide exit and signal hooks (async-exit-hook) when it
 * is imported. Kept in this process they cannot change vitest's exit status, and they
 * only ever see the one server started here. Lifecycle:
 * - sends `{ type: 'ready' }` once the server accepts connections, or `{ type: 'error' }`;
 * - on `{ type: 'stop' }`, or when the parent goes away (IPC `disconnect`), stops the
 *   server, closes the channel and lets the event loop drain. The package's `beforeExit`
 *   hook then runs with its completion callback, which is the path it supports.
 */
import EmbeddedPostgres from 'embedded-postgres';

export type ServerMessage = { type: 'ready' } | { type: 'error'; message: string };

const [databaseDir, portText] = process.argv.slice(2);
const port = Number(portText);
if (!databaseDir || !Number.isInteger(port) || !process.send) {
  throw new Error('usage: fork embedded-server.ts <databaseDir> <port> (with an IPC channel)');
}

const server = new EmbeddedPostgres({
  databaseDir,
  port,
  user: 'postgres',
  password: 'postgres',
  persistent: false,
  postgresFlags: ['-c', 'fsync=off', '-c', 'max_connections=200'],
  onLog: () => {},
  onError: () => {},
});

let stopping: Promise<void> | undefined;
function stop(): Promise<void> {
  stopping ??= server.stop().finally(() => {
    if (process.connected) process.disconnect();
  });
  return stopping;
}

function send(message: ServerMessage): void {
  if (process.connected) process.send?.(message);
}

process.on('message', (message: unknown) => {
  if ((message as { type?: unknown } | null)?.type === 'stop') void stop();
});
process.on('disconnect', () => void stop());

try {
  await server.initialise();
  await server.start();
  send({ type: 'ready' });
} catch (error) {
  send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  await stop();
}
