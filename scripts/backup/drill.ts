/** Opt-in local synthetic PostgreSQL drill. Never reads DATABASE_URL or a hosted endpoint. */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '@civic-ledger/db';
import { runMigrations } from '@civic-ledger/db/migrate';
import { seedDevData } from '@civic-ledger/db/seed';
import pg from 'pg';
import { decryptFile } from './archive';
import { createBackup, restoreBackup } from './cli';
import { type BackupRecord, compareAgainst } from './record';
import { safeError } from './safety';
import { createStore } from './storage';

async function freePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolvePromise(address.port);
        else reject(new Error('no local port'));
      });
    });
  });
}
async function main() {
  if (!process.env.PG_DUMP || !process.env.PG_RESTORE)
    throw new Error('PG_DUMP and PG_RESTORE must name admitted PostgreSQL17 client binaries');
  const work = resolve('.pglite/ops-launch-drill');
  const run = join(work, randomBytes(4).toString('hex'));
  await mkdir(run, { recursive: true });
  const port = await freePort();
  const child = fork(
    fileURLToPath(new URL('../../test-pg/embedded-server.ts', import.meta.url)),
    [join(run, 'server'), String(port)],
    { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
  );
  const exited = new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise()));
  try {
    await new Promise<void>((resolvePromise, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('local PostgreSQL startup timed out')),
        90_000,
      );
      child.once('error', reject);
      child.once('message', (message: { type: string }) => {
        clearTimeout(timeout);
        if (message.type === 'ready') resolvePromise();
        else reject(new Error('local PostgreSQL startup failed'));
      });
      void exited.then(() => reject(new Error('local PostgreSQL exited before ready')));
    });
    const adminUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
    const source = new URL(adminUrl);
    source.pathname = '/ops_source';
    const target = new URL(adminUrl);
    target.pathname = '/ops_restore';
    const sourceUrl = source.toString();
    const targetUrl = target.toString();
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query('create database ops_source');
      await admin.query('create database ops_restore');
    } finally {
      await admin.end();
    }
    const sourceHandle = createDb({ kind: 'pg', url: sourceUrl, poolMax: 1 });
    try {
      await runMigrations(sourceHandle);
      await seedDevData(sourceHandle.db);
    } finally {
      await sourceHandle.close();
    }
    const store = await createStore({ BACKUP_LOCAL_DIR: join(run, 'archive') });
    const secret = randomBytes(32).toString('base64');
    const started = performance.now();
    const manifest = await createBackup({ sourceUrl, secret, store, pgDump: process.env.PG_DUMP });
    const afterBackup = performance.now();
    const options = {
      targetUrl,
      expectedDatabase: 'ops_restore',
      manifestKey: `daily/${manifest.id}.manifest.json`,
      secret,
      store,
      pgRestore: process.env.PG_RESTORE,
    };
    assert.deepEqual(await restoreBackup(options), { mode: 'preview' });
    const restored = await restoreBackup({ ...options, execute: true });
    assert.equal(restored.report?.passed, true);
    const afterRestore = performance.now();
    await assert.rejects(restoreBackup({ ...options, execute: true }), /contains objects/);
    await assert.rejects(
      restoreBackup({ ...options, targetUrl: sourceUrl, expectedDatabase: 'ops_source' }),
      /backup source/,
    );
    // Reconnect and re-read from durable state. A changed business value must fail.
    const recordEnc = join(run, 'record.enc');
    const recordPath = join(run, 'record.json');
    await store.get(manifest.files.record.key, recordEnc);
    await decryptFile(recordEnc, recordPath, secret);
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as BackupRecord;
    const unpopulate = new pg.Client({ connectionString: targetUrl });
    await unpopulate.connect();
    try {
      await unpopulate.query('refresh materialized view person_card with no data');
    } finally {
      await unpopulate.end();
    }
    const repaired = await compareAgainst({ url: targetUrl, record });
    assert.equal(repaired.passed, true);
    assert(repaired.refreshedViews.includes('person_card'));
    const client = new pg.Client({ connectionString: targetUrl });
    await client.connect();
    try {
      await client.query(
        "update person set full_name='Changed synthetic name' where id=(select min(id) from person)",
      );
    } finally {
      await client.end();
    }
    const changed = await compareAgainst({ url: targetUrl, record });
    assert.equal(changed.passed, false);
    assert(changed.mismatches.some((m) => m.item === 'table person'));
    const encrypted = join(run, 'archive', manifest.files.dump.key);
    const corrupted = await readFile(encrypted);
    corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] ?? 0) ^ 1;
    await writeFile(encrypted, corrupted);
    await assert.rejects(restoreBackup({ ...options, execute: true }), /checksum mismatch/);
    const evidence = {
      environment:
        'local synthetic PostgreSQL17; separate ops_source and ops_restore databases; local archive backend',
      status: 'PASS',
      sourcePersonCount: record.tables.person?.count,
      tablesCompared: Object.keys(record.tables).length,
      viewsCompared: Object.keys(record.views).length,
      capabilitySamples: record.capabilities.length,
      unpopulatedViewRecovery: repaired.passed ? 'PASS' : 'FAIL',
      backupMs: Math.round(afterBackup - started),
      restoreAndCompareMs: Math.round(afterRestore - afterBackup),
      totalMs: Math.round(performance.now() - started),
      report: restored.report,
      negatives: [
        'source-target refusal',
        'populated-target refusal',
        'mutated business row detected after reconnect',
        'corrupt encrypted dump refused before database effects',
      ],
      cloudProvisioning: 'NOT_RUN',
      offProviderTransfer: 'NOT_RUN',
      hostedRpoRto: 'NOT_RUN',
      ownerAlertDelivery: 'NOT_RUN',
    };
    await writeFile(join(run, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(
      `${JSON.stringify({ ...evidence, evidenceFile: join(run, 'evidence.json') }, null, 2)}\n`,
    );
  } finally {
    if (child.connected) child.send({ type: 'stop' });
    await exited;
  }
}
main().catch((error) => {
  process.stderr.write(`${safeError(error)}\n`);
  if (error instanceof Error && error.cause)
    process.stderr.write(`Synthetic-local tool diagnostic: ${safeError(error.cause)}\n`);
  process.exitCode = 1;
});
