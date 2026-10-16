// Boots `next start` against a fresh, isolated PGlite for one Playwright web server.
// Usage: node e2e/support/start-server.mjs <port> [extraPeople]
// Never touches the developer's .pglite/dev database.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '../..');
const repoRoot = resolve(webDir, '../..');
const [port = '3300', extraPeople = '0'] = process.argv.slice(2);
const dataRoot = join(tmpdir(), `civic-ledger-e2e-${port}`);
const tsx = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

rmSync(dataRoot, { recursive: true, force: true });
mkdirSync(dataRoot, { recursive: true });
const env = { ...process.env, DATABASE_URL: '' };

// The seed CLI writes PGlite to `<cwd>/.pglite/dev`.
const seed = spawnSync(process.execPath, [tsx, join(repoRoot, 'packages/db/src/cli/seed.ts')], {
  cwd: dataRoot,
  env,
  stdio: 'inherit',
});
if (seed.status !== 0) process.exit(seed.status ?? 1);

const dataDir = join(dataRoot, '.pglite', 'dev');
if (Number(extraPeople) > 0) {
  const scale = spawnSync(
    process.execPath,
    [tsx, join(here, 'scale-db.ts'), dataDir, extraPeople],
    {
      cwd: webDir,
      env,
      stdio: 'inherit',
    },
  );
  if (scale.status !== 0) process.exit(scale.status ?? 1);
}

const next = join(webDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const server = spawn(process.execPath, [next, 'start', '-p', port], {
  cwd: webDir,
  env: { ...env, PGLITE_DATA_DIR: dataDir },
  stdio: 'inherit',
});
const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
