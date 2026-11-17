import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { startPgStack } from '../e2e/support/pg-stack';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselineRevision = '8ff5592';

async function port(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  await new Promise<void>((done) => server.close(() => done()));
  if (!address || typeof address === 'string') throw new Error('Expected port');
  return address.port;
}

test('previous app reads the current schema and previous schemas accept current API payloads', async ({
  page,
}) => {
  const baselineRoot = process.env.ROLLBACK_BASELINE_ROOT;
  if (!baselineRoot)
    throw new Error('Set ROLLBACK_BASELINE_ROOT to a clean, built 8ff5592 checkout');
  const identity = spawnSync('git', ['rev-parse', '--short=7', 'HEAD'], {
    cwd: baselineRoot,
    encoding: 'utf8',
  });
  expect(identity.status).toBe(0);
  expect(identity.stdout.trim()).toBe(baselineRevision);
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: baselineRoot,
    encoding: 'utf8',
  });
  expect(status.status).toBe(0);
  expect(status.stdout.trim()).toBe('');
  console.info('[rollback] create current database, migrate and seed');
  const stack = await startPgStack(); // Latest migrator + latest fictional seed, never a restored old schema.
  let previous: ChildProcess | undefined;
  try {
    console.info('[rollback] start current web app');
    await stack.startWeb();
    const baselinePort = await port();
    const oldUrl = `http://localhost:${baselinePort}`;
    const env = { ...process.env };
    for (const key of [
      'DATABASE_URL',
      'DATABASE_URL_READONLY',
      'PGLITE_DATA_DIR',
      'DB_ALLOW_OWNER_CREDENTIALS',
    ])
      delete env[key];
    console.info('[rollback] start previous web app');
    previous = spawn(
      process.execPath,
      [
        join(baselineRoot, 'apps/web/node_modules/next/dist/bin/next'),
        'start',
        '-p',
        String(baselinePort),
      ],
      {
        cwd: join(baselineRoot, 'apps/web'),
        env: {
          ...env,
          NODE_ENV: 'production',
          DATABASE_URL_READONLY: stack.readerUrl,
          RATE_LIMIT_SINGLE_BUCKET: '1',
          PAGE_RATE_LIMIT_PER_MINUTE: '100000',
          API_RATE_LIMIT_PER_MINUTE: '100000',
        },
        stdio: 'ignore',
      },
    );
    let ready = false;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (previous.exitCode !== null) throw new Error('Previous app failed to start');
      try {
        ready = (await fetch(`${oldUrl}/api/health`, { signal: AbortSignal.timeout(2_000) })).ok;
        if (ready) break;
      } catch {
        /* still starting */
      }
      await new Promise((done) => setTimeout(done, 250));
    }
    expect(ready).toBe(true);
    const current = async (name: string, input: unknown = {}) => {
      const response =
        name === 'frameworks.evaluate'
          ? await fetch(`${stack.baseUrl}/api/v1/${name}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(input),
            })
          : await fetch(
              `${stack.baseUrl}/api/v1/${name}?input=${encodeURIComponent(JSON.stringify(input))}`,
            );
      expect(response.status).toBe(200);
      return response.json();
    };
    console.info('[rollback] fetch people and framework inputs');
    const people = await current('people.search', { limit: 3 });
    const [a, b] = people.items.map((person: { slug: string }) => person.slug);
    const frameworks = await current('frameworks.list');
    const cases: Array<[string, Record<string, unknown>]> = [
      ['people.search', { limit: 3 }],
      ['people.get', { slug: a }],
      ['people.compare', { slugs: [a, b] }],
      ['explore.table', { limit: 3 }],
      ['explore.facets', {}],
      ['money.summary', { slug: a }],
      ['votes.list', { slug: a, limit: 3 }],
      ['scores.list', { slug: a }],
      ['promises.list', { slug: a }],
      ['policy.areas', {}],
      ['frameworks.list', {}],
      ['sources.status', {}],
      ['frameworks.evaluate', { framework: frameworks.items[0].spec, limit: 3 }],
    ];
    const records: Array<{ name: string; payload: unknown }> = [];
    for (const [name, input] of cases) {
      console.info('[rollback] compare legacy capability', name);
      const payload = await current(name, input);
      const prior =
        name === 'frameworks.evaluate'
          ? await fetch(`${oldUrl}/api/v1/${name}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(input),
            })
          : await fetch(
              `${oldUrl}/api/v1/${name}?input=${encodeURIComponent(JSON.stringify(input))}`,
            );
      expect(prior.status, `${name} from previous app on current schema`).toBe(200);
      expect(payload, `${name} preserves previous business values`).toMatchObject(
        await prior.json(),
      );
      records.push({ name, payload });
    }
    console.info('[rollback] validate current payloads with previous output schemas');
    const oldClient = spawnSync(
      process.execPath,
      [
        join(baselineRoot, 'node_modules/tsx/dist/cli.mjs'),
        join(webDir, 'rollback/old-client.ts'),
        baselineRoot,
      ],
      {
        cwd: baselineRoot,
        input: JSON.stringify(records),
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    expect(oldClient.status, 'baseline output schemas accept every current legacy payload').toBe(0);
    expect(JSON.parse(oldClient.stdout)).toEqual({ validated: cases.length });
    console.info('[rollback] previous app browser navigation');
    await page.goto(`${oldUrl}/people/${a}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(people.items[0].fullName);
    await page.goto(`${oldUrl}/explore`);
    await expect(page.getByRole('table')).toBeVisible();
    await page.goto(`${oldUrl}/sources`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Sources');
  } finally {
    console.info('[rollback] stop previous web app');
    if (previous && previous.exitCode === null) {
      const done = once(previous, 'exit');
      previous.kill();
      await done;
    }
    console.info('[rollback] close current stack');
    await stack.close();
    console.info('[rollback] cleanup complete');
  }
});
