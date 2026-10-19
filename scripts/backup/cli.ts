import { createHash, randomBytes } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import {
  checkKey,
  checkSecret,
  decryptFile,
  encryptFile,
  hashFile,
  type Manifest,
  signManifest,
  verifyArchiveFile,
  verifyManifest,
} from './archive';
import {
  type BackupRecord,
  compareAgainst,
  formatReport,
  RECORD_VERSION,
  takeRecord,
} from './record';
import { databaseIdentity, pgEnvironment, runTool, safeError, scratchDirectory } from './safety';
import { createStore, type Store } from './storage';

const identityHash = (url: string) =>
  createHash('sha256').update(databaseIdentity(url)).digest('hex');
export async function createBackup(options: {
  sourceUrl: string;
  secret: string;
  store: Store;
  pgDump?: string;
  now?: Date;
}): Promise<Manifest> {
  checkSecret(options.secret);
  databaseIdentity(options.sourceUrl);
  const scratch = await scratchDirectory();
  try {
    const now = options.now ?? new Date();
    const id = `civic-ledger-${now.toISOString().replace(/[-:.]/g, '')}-${randomBytes(4).toString('hex')}`;
    const dump = join(scratch.path, 'civic-ledger.dump');
    const record = await takeRecord({
      url: options.sourceUrl,
      dumpFile: dump,
      pgDump: options.pgDump || 'pg_dump',
    });
    const recordPath = join(scratch.path, 'record.json');
    await writeFile(recordPath, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    const files = {} as Manifest['files'];
    for (const kind of ['dump', 'record'] as const) {
      const encrypted = join(scratch.path, `${kind}.enc`);
      await encryptFile(kind === 'dump' ? dump : recordPath, encrypted, options.secret);
      files[kind] = {
        key: `daily/${id}.${kind}.enc`,
        bytes: (await stat(encrypted)).size,
        sha256: await hashFile(encrypted),
      };
    }
    const manifest = signManifest(
      {
        version: 2,
        id,
        takenAt: record.takenAt,
        recordDate: record.recordDate,
        sourceIdentitySha256: identityHash(options.sourceUrl),
        files,
        cipher: 'aes-256-gcm+scrypt',
      },
      options.secret,
    );
    for (const kind of ['dump', 'record'] as const)
      await options.store.put(join(scratch.path, `${kind}.enc`), manifest.files[kind].key);
    const path = join(scratch.path, 'manifest.json');
    await writeFile(path, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await options.store.put(path, `daily/${id}.manifest.json`);
    // Weekly copies retain independently signed keys and can be restored without daily objects.
    if (now.getUTCDay() === 0 && now.getUTCHours() < 12) {
      const { hmac: _hmac, ...unsigned } = manifest;
      const weekly = signManifest(
        {
          ...unsigned,
          files: {
            dump: { ...files.dump, key: files.dump.key.replace('daily/', 'weekly/') },
            record: { ...files.record, key: files.record.key.replace('daily/', 'weekly/') },
          },
        },
        options.secret,
      );
      for (const kind of ['dump', 'record'] as const)
        await options.store.put(join(scratch.path, `${kind}.enc`), weekly.files[kind].key);
      const weeklyPath = join(scratch.path, 'weekly.json');
      await writeFile(weeklyPath, JSON.stringify(weekly), { mode: 0o600 });
      await options.store.put(weeklyPath, `weekly/${id}.manifest.json`);
    }
    // Success becomes visible only after every required object has been uploaded.
    await options.store.put(path, 'latest.json');
    return manifest;
  } finally {
    await scratch.close();
  }
}

export async function retentionPlan(store: Store, secret: string): Promise<string[]> {
  const remove: string[] = [];
  for (const [tier, keep] of [
    ['daily', 14],
    ['weekly', 8],
  ] as const) {
    const keys = (await store.list(tier))
      .filter((key) => key.endsWith('.manifest.json'))
      .sort()
      .reverse();
    const retainedPeriods = new Set<string>();
    for (const key of keys) {
      checkKey(key);
      const m = verifyManifest(await store.json(key), secret);
      if (
        key !== `${tier}/${m.id}.manifest.json` ||
        !Object.values(m.files).every((f) => f.key.startsWith(`${tier}/`))
      )
        throw new Error('retention manifest belongs to a different archive tier');
      const date = new Date(m.takenAt);
      if (tier === 'weekly') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      const period = date.toISOString().slice(0, 10);
      if (!retainedPeriods.has(period) && retainedPeriods.size < keep) {
        retainedPeriods.add(period);
        continue;
      }
      remove.push(m.files.dump.key, m.files.record.key, key);
    }
  }
  return remove;
}

export async function restoreBackup(options: {
  targetUrl: string;
  expectedDatabase: string;
  manifestKey: string;
  secret: string;
  store: Store;
  pgRestore?: string;
  execute?: boolean;
  webBaseUrl?: string;
}): Promise<{ mode: 'preview' | 'executed'; report?: Awaited<ReturnType<typeof compareAgainst>> }> {
  databaseIdentity(options.targetUrl);
  if (
    !options.expectedDatabase ||
    decodeURIComponent(new URL(options.targetUrl).pathname.slice(1)) !== options.expectedDatabase
  )
    throw new Error('restore database does not match --target-database');
  checkKey(options.manifestKey);
  const manifest = verifyManifest(await options.store.json(options.manifestKey), options.secret);
  if (!options.manifestKey.endsWith(`/${manifest.id}.manifest.json`))
    throw new Error('manifest key does not match archive identity');
  if (identityHash(options.targetUrl) === manifest.sourceIdentitySha256)
    throw new Error('restore target is the backup source; use a separate empty database');
  if (!options.execute) return { mode: 'preview' };
  const started = performance.now();
  const scratch = await scratchDirectory();
  try {
    for (const kind of ['dump', 'record'] as const) {
      const encrypted = join(scratch.path, `${kind}.enc`);
      await options.store.get(manifest.files[kind].key, encrypted);
      await verifyArchiveFile(encrypted, manifest.files[kind]);
      await decryptFile(
        encrypted,
        join(scratch.path, kind === 'dump' ? 'civic-ledger.dump' : 'record.json'),
        options.secret,
      );
    }
    const record = JSON.parse(
      await readFile(join(scratch.path, 'record.json'), 'utf8'),
    ) as BackupRecord;
    if (
      record.version !== RECORD_VERSION ||
      !record.dump ||
      record.recordDate !== manifest.recordDate ||
      record.takenAt !== manifest.takenAt
    )
      throw new Error('authenticated backup record does not match manifest');
    const dump = join(scratch.path, 'civic-ledger.dump');
    if (
      (await hashFile(dump)) !== record.dump.sha256 ||
      (await stat(dump)).size !== record.dump.bytes
    )
      throw new Error('decrypted dump checksum mismatch');
    const restoreBin = options.pgRestore || 'pg_restore';
    const version = await runTool(restoreBin, ['--version']);
    if (
      Number(/PostgreSQL\) (\d+)/.exec(version)?.[1]) !== Number(record.serverVersion.split('.')[0])
    )
      throw new Error('pg_restore major version must match backup server');
    const client = new pg.Client({
      connectionString: options.targetUrl,
      connectionTimeoutMillis: 30_000,
    });
    await client.connect();
    try {
      const { rows } = await client.query<{ count: string }>(
        `select count(*) as count from (
          select n.nspname from pg_class c join pg_namespace n on n.oid=c.relnamespace
          union all select n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          union all select n.nspname from pg_type t join pg_namespace n on n.oid=t.typnamespace
          union all select nspname from pg_namespace where nspname <> 'public'
        ) objects where nspname not in ('pg_catalog','information_schema')
          and nspname not like 'pg_toast%' and nspname not like 'pg_temp%'`,
      );
      if (rows[0]?.count !== '0')
        throw new Error('restore target contains objects; refusing to overwrite existing state');
    } finally {
      await client.end();
    }
    // No --clean, DROP or pre-migration; pg_dump contains the complete original schema.
    await runTool(
      restoreBin,
      [
        `--dbname=${decodeURIComponent(new URL(options.targetUrl).pathname.slice(1))}`,
        '--single-transaction',
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        dump,
      ],
      pgEnvironment(options.targetUrl),
    );
    const report = await compareAgainst({
      url: options.targetUrl,
      record,
      refreshIfEmpty: true,
      webBaseUrl: options.webBaseUrl,
    });
    report.timingsMs.restoreTotal = Math.round(performance.now() - started);
    if (!report.passed)
      throw new Error(
        `restore integrity comparison failed (${report.mismatches.length} mismatches)`,
      );
    return { mode: 'executed', report };
  } finally {
    await scratch.close();
  }
}

export async function executeRetention(
  store: Store,
  secret: string,
  reviewedKeys: string[],
): Promise<string[]> {
  const current = await retentionPlan(store, secret);
  if (JSON.stringify(reviewedKeys) !== JSON.stringify(current))
    throw new Error('retention preview is stale; review a fresh plan');
  // Each exact unlink/delete is retryable; the signed manifest is removed last.
  for (const key of current) await store.remove(key);
  return current;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { values } = parseArgs({
    args,
    options: {
      execute: { type: 'boolean', default: false },
      manifest: { type: 'string' },
      'target-database': { type: 'string' },
      report: { type: 'string' },
      'web-base-url': { type: 'string' },
      plan: { type: 'string' },
    },
  });
  if (command === 'help' || !command) {
    process.stdout.write(
      'backup cli: backup | restore --manifest <daily/key.manifest.json> --target-database <empty-db> [--execute] [--report <file>] | retention [--execute]\nConnections and encryption key are environment-only. Restore and retention default to preview.\n',
    );
    return;
  }
  const store = await createStore();
  const secret = process.env.BACKUP_ENCRYPTION_KEY ?? '';
  checkSecret(secret);
  if (command === 'backup') {
    const sourceUrl = process.env.BACKUP_DATABASE_URL;
    if (!sourceUrl) throw new Error('BACKUP_DATABASE_URL is required');
    const manifest = await createBackup({ sourceUrl, secret, store, pgDump: process.env.PG_DUMP });
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
  } else if (command === 'restore') {
    const targetUrl = process.env.RESTORE_DATABASE_URL;
    if (!targetUrl || !values.manifest || !values['target-database'])
      throw new Error('RESTORE_DATABASE_URL, --manifest and --target-database are required');
    const result = await restoreBackup({
      targetUrl,
      secret,
      store,
      manifestKey: values.manifest,
      expectedDatabase: values['target-database'],
      execute: values.execute,
      pgRestore: process.env.PG_RESTORE,
      webBaseUrl: values['web-base-url'],
    });
    if (values.report)
      await writeFile(values.report, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(
      result.report
        ? `${formatReport(result.report)}\n`
        : 'PREVIEW: authenticated archive; separate target confirmed; no database effects\n',
    );
  } else if (command === 'retention') {
    const keys = await retentionPlan(store, secret);
    if (values.execute) {
      if (!values.plan)
        throw new Error('retention --execute requires --plan <reviewed-preview.json>');
      const reviewed = JSON.parse(await readFile(values.plan, 'utf8')) as { deleteKeys?: string[] };
      if (!Array.isArray(reviewed.deleteKeys))
        throw new Error('retention preview lacks deleteKeys');
      await executeRetention(store, secret, reviewed.deleteKeys);
    }
    process.stdout.write(
      `${JSON.stringify({ mode: values.execute ? 'executed' : 'preview', deleteKeys: keys })}\n`,
    );
  } else throw new Error('unknown backup command; use help');
}
if (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  });
}
