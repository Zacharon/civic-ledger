import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkKey,
  decryptFile,
  encryptFile,
  type Manifest,
  signManifest,
  verifyManifest,
} from '../../../scripts/backup/archive';
import { executeRetention, restoreBackup, retentionPlan } from '../../../scripts/backup/cli';
import { archiveRaw, restoreRaw, verifyRawManifest } from '../../../scripts/backup/raw';
import { type BackupRecord, compareRecords } from '../../../scripts/backup/record';
import { persistentRawRoot, pgEnvironment } from '../../../scripts/backup/safety';
import { createStore, type Store } from '../../../scripts/backup/storage';

const secret = 'synthetic-local-fixture-'.repeat(2);
const roots: string[] = [];
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'civic-ops-test-'));
  roots.push(path);
  return path;
}
function manifest(day = '01'): Manifest {
  const id = `civic-ledger-202610${day}T030000000Z-1234abcd`;
  const file = (kind: string) => ({
    key: `daily/${id}.${kind}.enc`,
    bytes: 100,
    sha256: 'a'.repeat(64),
  });
  return signManifest(
    {
      version: 2,
      id,
      takenAt: `2026-10-${day}T03:00:00.000Z`,
      recordDate: `2026-10-${day}`,
      sourceIdentitySha256: 'b'.repeat(64),
      files: { dump: file('dump'), record: file('record') },
      cipher: 'aes-256-gcm+scrypt',
    },
    secret,
  );
}
function record(): BackupRecord {
  return {
    version: 2,
    takenAt: '2026-10-18T00:00:00Z',
    recordDate: '2026-10-18',
    serverVersion: '17.10',
    snapshotId: null,
    tables: { person: { count: 2, checksum: 'aaa' } },
    views: {
      person_card: {
        count: 2,
        raw: 'raw',
        normalized: 'norm',
        normalizedNoTenure: 'without-tenure',
      },
    },
    ingestRuns: [],
    capabilities: [
      {
        name: 'money.summary',
        input: { slug: 'fictional' },
        output: { totalCents: 12345, coverage: null, refreshedAt: 'volatile' },
      },
    ],
    timingsMs: {},
  };
}
describe('authenticated backup and bounded recovery', () => {
  it('requires a marked persistent raw root outside checkout and rejects relative or checkout paths', async () => {
    const path = await root();
    const raw = join(path, 'raw');
    await mkdir(raw);
    await expect(persistentRawRoot(undefined, process.cwd())).rejects.toThrow('absolute');
    await expect(persistentRawRoot('data/raw', process.cwd())).rejects.toThrow('absolute');
    await expect(persistentRawRoot(process.cwd(), process.cwd())).rejects.toThrow('separate');
    await expect(persistentRawRoot(raw, process.cwd())).rejects.toThrow();
    await writeFile(
      join(raw, '.civic-ledger-raw-root.json'),
      JSON.stringify({ version: 1, purpose: 'civic-ledger-raw-snapshots' }),
    );
    expect(await persistentRawRoot(raw, process.cwd())).toBe(raw);
  });
  it('roundtrips a signed raw snapshot tree, preserves exact manifests, empty files and deduplicated content', async () => {
    const path = await root();
    const input = join(path, 'raw');
    await mkdir(join(input, 'voteview', '2026-10-18'), { recursive: true });
    const directory = join(input, 'voteview', '2026-10-18');
    await writeFile(join(directory, 'votes.csv'), 'person,vote\nfictional,Yea\n');
    await writeFile(join(directory, 'duplicate.csv'), 'person,vote\nfictional,Yea\n');
    await writeFile(join(directory, 'empty.csv'), '');
    const sourceManifest = '{"schema_version":1,"source":"voteview","checksum":"synthetic"}\n';
    await writeFile(join(directory, 'manifest.json'), sourceManifest);
    const store = await createStore({ BACKUP_LOCAL_DIR: join(path, 'archive') });
    const m = await archiveRaw({ root: input, secret, store });
    expect(verifyRawManifest(await store.json('latest-raw.json'), secret).files).toHaveLength(4);
    expect(new Set(m.files.map((f) => f.key)).size).toBe(3);
    const options = {
      target: join(path, 'recovered'),
      manifestKey: `raw/${m.id}/manifest.json`,
      secret,
      store,
    };
    expect(await restoreRaw(options)).toEqual({ mode: 'preview', files: 4 });
    expect(await restoreRaw({ ...options, execute: true })).toEqual({ mode: 'executed', files: 4 });
    expect(
      await readFile(join(options.target, 'voteview', '2026-10-18', 'manifest.json'), 'utf8'),
    ).toBe(sourceManifest);
    expect(
      await readFile(join(options.target, 'voteview', '2026-10-18', 'empty.csv'), 'utf8'),
    ).toBe('');
    await expect(restoreRaw({ ...options, execute: true })).rejects.toThrow('already exists');
    const first = m.files[0];
    assert(first);
    const blob = join(path, 'archive', first.key);
    const bytes = await readFile(blob);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    await writeFile(blob, bytes);
    await expect(
      restoreRaw({ ...options, target: join(path, 'corrupted'), execute: true }),
    ).rejects.toThrow('checksum mismatch');
    expect(() =>
      verifyRawManifest({ ...m, files: [{ ...first, path: '../outside' }] }, secret),
    ).toThrow('unsafe');
  });
  it('rejects raw-tree symbolic links and refuses a changed source before publishing success', async () => {
    const path = await root();
    const input = join(path, 'raw');
    const outside = join(path, 'outside');
    await mkdir(input);
    await mkdir(outside);
    await writeFile(join(outside, 'file'), 'private');
    await symlink(outside, join(input, 'link'), 'junction');
    const store = await createStore({ BACKUP_LOCAL_DIR: join(path, 'archive') });
    await expect(archiveRaw({ root: input, secret, store })).rejects.toThrow('symbolic');
    await rm(join(input, 'link'));
    await writeFile(join(input, 'data.csv'), 'first');
    const put = store.put;
    store.put = async (file, key) => {
      await put(file, key);
      await writeFile(join(input, 'data.csv'), 'changed');
    };
    await expect(archiveRaw({ root: input, secret, store })).rejects.toThrow('changed');
    await expect(store.json('latest-raw.json')).rejects.toThrow();
  });
  it('roundtrips encrypted bytes and refuses corruption or a different key before restore', async () => {
    const path = await root();
    const input = join(path, 'input');
    const encrypted = join(path, 'dump.enc');
    const output = join(path, 'output');
    await writeFile(input, Buffer.from('PGDMP\0synthetic data\0'));
    await encryptFile(input, encrypted, secret);
    expect((await readFile(encrypted)).includes(Buffer.from('synthetic'))).toBe(false);
    await decryptFile(encrypted, output, secret);
    expect(await readFile(output)).toEqual(await readFile(input));
    await expect(decryptFile(encrypted, output, secret)).rejects.toThrow();
    expect(await readFile(output)).toEqual(await readFile(input));
    await expect(
      decryptFile(encrypted, join(path, 'wrong-key'), `${secret}-wrong`),
    ).rejects.toThrow('authentication');
    const corrupt = await readFile(encrypted);
    corrupt[corrupt.length - 5] = (corrupt[corrupt.length - 5] ?? 0) ^ 1;
    await writeFile(encrypted, corrupt);
    await expect(decryptFile(encrypted, join(path, 'corrupt'), secret)).rejects.toThrow(
      'authentication',
    );
    await expect(readFile(join(path, 'corrupt'))).rejects.toThrow();
  });
  it('requires a signed complete manifest and validates paths before effects', () => {
    const good = manifest();
    expect(verifyManifest(good, secret)).toEqual(good);
    expect(() => verifyManifest({ ...good, takenAt: '2026-10-19T00:00:00Z' }, secret)).toThrow(
      'authentication',
    );
    expect(() => verifyManifest({ ...good, hmac: undefined }, secret)).toThrow();
    expect(() => verifyManifest({}, secret)).toThrow();
    for (const key of [
      '../dump.enc',
      'daily/../dump.enc',
      '/daily/file',
      'daily/x;rm',
      'latest.json',
    ])
      expect(() => checkKey(key)).toThrow();
  });
  it('detects financial changes while allowing only explicitly documented volatile fields', () => {
    const baseline = record();
    const changed = structuredClone(baseline);
    assert(changed.capabilities[0]);
    (changed.capabilities[0].output as { totalCents: number }).totalCents += 1;
    expect(compareRecords(baseline, changed).passed).toBe(false);
    const refresh = structuredClone(baseline);
    assert(refresh.capabilities[0]);
    assert(refresh.tables.person);
    (refresh.capabilities[0].output as { refreshedAt: string }).refreshedAt = 'new timestamp';
    expect(compareRecords(baseline, refresh).passed).toBe(true);
    refresh.tables.person.count += 1;
    expect(compareRecords(baseline, refresh).passed).toBe(false);
  });
  it('plans only the oldest authenticated archive triplets and never deletes during planning', async () => {
    const manifests = Array.from({ length: 16 }, (_, i) =>
      manifest(String(i + 1).padStart(2, '0')),
    );
    const deleted: string[] = [];
    const store: Store = {
      kind: 'local',
      size: async () => 100,
      put: async () => {},
      get: async () => {},
      json: async (key) => manifests.find((m) => key.endsWith(`/${m.id}.manifest.json`)),
      list: async (tier) =>
        tier === 'daily' ? manifests.map((m) => `daily/${m.id}.manifest.json`) : [],
      remove: async (key) => {
        deleted.push(key);
      },
    };
    const plan = await retentionPlan(store, secret);
    expect(plan).toHaveLength(6);
    expect(plan.every((key) => key.includes('20261001T') || key.includes('20261002T'))).toBe(true);
    expect(deleted).toEqual([]);
    await expect(executeRetention(store, secret, plan.slice(1))).rejects.toThrow('stale');
    expect(deleted).toEqual([]);
    expect(await executeRetention(store, secret, plan)).toEqual(plan);
    expect(deleted).toEqual(plan);
    store.json = async () => ({ ...manifests[0], hmac: '0'.repeat(64) });
    await expect(retentionPlan(store, secret)).rejects.toThrow('authentication');
  });
  it('rejects target name mismatches without connecting and defaults restore to preview', async () => {
    const m = manifest();
    const store: Store = {
      kind: 'local',
      size: async () => 100,
      put: async () => {},
      get: async () => {
        throw new Error('unexpected effect');
      },
      json: async () => m,
      list: async () => [],
      remove: async () => {},
    };
    const options = {
      store,
      secret,
      targetUrl: 'postgres://local:synthetic@127.0.0.1:1/restore_test',
      expectedDatabase: 'restore_test',
      manifestKey: `daily/${m.id}.manifest.json`,
    };
    expect(await restoreBackup(options)).toEqual({ mode: 'preview' });
    await expect(restoreBackup({ ...options, expectedDatabase: 'production' })).rejects.toThrow(
      'does not match',
    );
  });
  it('keeps libpq secrets out of arguments and local object keys within root', async () => {
    const env = pgEnvironment(
      'postgres://user:synthetic-secret@localhost:5433/restore_test?sslmode=verify-full',
    );
    expect(env.PGPASSWORD).toBe('synthetic-secret');
    expect(env.PGSSLMODE).toBe('verify-full');
    const path = await root();
    const store = await createStore({ BACKUP_LOCAL_DIR: path });
    await expect(store.remove('../outside')).rejects.toThrow();
    await expect(createStore({ BACKUP_LOCAL_DIR: path, BACKUP_S3_BUCKET: 'same' })).rejects.toThrow(
      'exactly one',
    );
  });
});
