/**
 * Test-owned Postgres process. Exit hooks from embedded-postgres stay outside Playwright
 * (see test-pg/embedded-server.ts). A restart reopens the same cluster with fsync enabled;
 * this is a local process restart, not a power-loss or hosted recovery test. The
 * package stops its own Postgres tree with taskkill /f on Windows (SIGINT elsewhere).
 */
import EmbeddedPostgres from 'embedded-postgres';

const [databaseDir, portText, reuse] = process.argv.slice(2);
if (!databaseDir || !portText || !process.send) throw new Error('missing Postgres fixture args');
const server = new EmbeddedPostgres({
  databaseDir,
  port: Number(portText),
  user: 'postgres',
  password: 'postgres',
  persistent: true,
  onLog: () => {},
  onError: () => {},
});
let stopping: Promise<void> | undefined;
function stop() {
  stopping ??= server.stop().finally(() => {
    if (process.connected) process.disconnect();
  });
  return stopping;
}
process.on('message', (message: { type?: string }) => {
  if (message.type === 'stop') void stop();
});
process.on('disconnect', () => void stop());
try {
  if (reuse !== 'reuse') await server.initialise();
  await server.start();
  process.send({ type: 'ready' });
} catch (error) {
  process.send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  await stop();
}
