/** Quiesced source-snapshot preservation; independent signed index and encrypted blobs. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  checkKey,
  checkSecret,
  decryptFile,
  encryptFile,
  hashFile,
  verifyArchiveFile,
} from './archive';
import { canonical } from './record';
import { persistentRawRoot, safeError, scratchDirectory } from './safety';
import { createStore, type Store } from './storage';

export interface RawFile {
  path: string;
  key: string;
  bytes: number;
  sha256: string;
  encryptedBytes: number;
  encryptedSha256: string;
}
export interface RawManifest {
  version: 1;
  kind: 'raw-snapshots';
  id: string;
  takenAt: string;
  files: RawFile[];
  hmac: string;
}
function checkRelative(path: string): void {
  if (
    typeof path !== 'string' ||
    path.length > 2000 ||
    path.split('/').length > 12 ||
    path
      .split('/')
      .some((part) => !/^[a-zA-Z0-9._-]{1,180}$/.test(part) || part === '.' || part === '..')
  )
    throw new Error('raw snapshot path is unsafe');
}
function sign(value: Omit<RawManifest, 'hmac'>, secret: string): RawManifest {
  checkSecret(secret);
  return { ...value, hmac: createHmac('sha256', secret).update(canonical(value)).digest('hex') };
}
export function verifyRawManifest(value: unknown, secret: string): RawManifest {
  checkSecret(secret);
  if (!value || typeof value !== 'object') throw new Error('raw manifest is malformed');
  const m = value as RawManifest;
  if (
    m.version !== 1 ||
    m.kind !== 'raw-snapshots' ||
    !/^civic-ledger-\d{8}T\d{9}Z-[a-f0-9]{8}$/.test(m.id) ||
    !Number.isFinite(Date.parse(m.takenAt)) ||
    !Array.isArray(m.files) ||
    m.files.length === 0 ||
    m.files.length > 100_000 ||
    !/^[a-f0-9]{64}$/.test(m.hmac)
  )
    throw new Error('raw manifest is malformed');
  const paths = new Set<string>();
  for (const file of m.files) {
    checkRelative(file.path);
    checkKey(file.key);
    const normalized = file.path.toLowerCase();
    if (
      paths.has(normalized) ||
      file.key !== `raw/${m.id}/${file.sha256}.enc` ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !/^[a-f0-9]{64}$/.test(file.encryptedSha256) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !Number.isSafeInteger(file.encryptedBytes) ||
      file.encryptedBytes < 52
    )
      throw new Error('raw manifest file metadata is invalid');
    paths.add(normalized);
  }
  const { hmac, ...unsigned } = m;
  if (!timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(sign(unsigned, secret).hmac, 'hex')))
    throw new Error('raw manifest authentication failed');
  return m;
}
async function filesIn(root: string, path = ''): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    const relative = path ? `${path}/${entry.name}` : entry.name;
    checkRelative(relative);
    if (entry.isSymbolicLink())
      throw new Error('raw snapshot tree must not contain symbolic links');
    if (entry.isDirectory()) output.push(...(await filesIn(root, relative)));
    else if (entry.isFile()) output.push(relative);
    else throw new Error('raw snapshot tree contains a non-file object');
    if (output.length > 100_000) throw new Error('raw snapshot file budget exceeded');
  }
  return output.sort();
}
export async function archiveRaw(options: {
  root: string;
  secret: string;
  store: Store;
}): Promise<RawManifest> {
  checkSecret(options.secret);
  const root = await realpath(options.root);
  if ((await lstat(options.root)).isSymbolicLink() || root !== resolve(options.root))
    throw new Error('raw root must be a real directory without symbolic links');
  const files = await filesIn(root);
  if (files.length === 0) throw new Error('raw snapshot tree is empty');
  const scratch = await scratchDirectory();
  const now = new Date();
  const id = `civic-ledger-${now.toISOString().replace(/[-:.]/g, '')}-${randomBytes(4).toString('hex')}`;
  const index: RawFile[] = [];
  const blobs = new Map<string, Omit<RawFile, 'path'>>();
  const observed = new Map<string, { size: number; mtime: number; hash: string }>();
  let total = 0;
  try {
    for (const path of files) {
      const input = join(root, path);
      if ((await realpath(input)) !== input)
        throw new Error('raw snapshot path traverses a symbolic link');
      const before = await lstat(input);
      total += before.size;
      if (!before.isFile() || before.size > 8 * 1024 ** 3 || total > 512 * 1024 ** 3)
        throw new Error('raw snapshot byte budget exceeded');
      const sha256 = await hashFile(input);
      observed.set(path, { size: before.size, mtime: before.mtimeMs, hash: sha256 });
      let blob = blobs.get(sha256);
      if (!blob) {
        const encrypted = join(scratch.path, 'raw.enc');
        await encryptFile(input, encrypted, options.secret);
        const after = await lstat(input);
        if (
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs ||
          (await hashFile(input)) !== sha256 ||
          (await realpath(input)) !== input
        )
          throw new Error('raw source changed during archival; quiesce ingest and retry');
        blob = {
          key: `raw/${id}/${sha256}.enc`,
          bytes: before.size,
          sha256,
          encryptedBytes: (await lstat(encrypted)).size,
          encryptedSha256: await hashFile(encrypted),
        };
        await options.store.put(encrypted, blob.key);
        await unlink(encrypted);
        blobs.set(sha256, blob);
      }
      index.push({ path, ...blob });
    }
    if (JSON.stringify(await filesIn(root)) !== JSON.stringify(files))
      throw new Error('raw snapshot tree changed during archival');
    for (const path of files) {
      const expected = observed.get(path);
      const current = await lstat(join(root, path));
      if (
        !expected ||
        current.isSymbolicLink() ||
        current.size !== expected.size ||
        current.mtimeMs !== expected.mtime ||
        (await hashFile(join(root, path))) !== expected.hash
      )
        throw new Error('raw source changed during archival; quiesce ingest and retry');
    }
    const manifest = sign(
      { version: 1, kind: 'raw-snapshots', id, takenAt: now.toISOString(), files: index },
      options.secret,
    );
    const output = join(scratch.path, 'manifest.json');
    const manifestJson = JSON.stringify(manifest);
    if (Buffer.byteLength(manifestJson) > 64 * 1024 ** 2)
      throw new Error('raw archive index exceeds its 64-MiB budget');
    await writeFile(output, manifestJson, { mode: 0o600 });
    await options.store.put(output, `raw/${id}/manifest.json`);
    await options.store.put(output, 'latest-raw.json');
    return manifest;
  } finally {
    await scratch.close();
  }
}
export async function restoreRaw(options: {
  target: string;
  manifestKey: string;
  secret: string;
  store: Store;
  execute?: boolean;
}): Promise<{ mode: string; files: number }> {
  checkKey(options.manifestKey);
  const m = verifyRawManifest(await options.store.json(options.manifestKey), options.secret);
  if (options.manifestKey !== `raw/${m.id}/manifest.json`)
    throw new Error('raw archive identity mismatch');
  const parent = await realpath(dirname(resolve(options.target)));
  const target = join(parent, basename(options.target));
  if (target !== resolve(options.target) || !/^[a-zA-Z0-9_-]{1,100}$/.test(basename(target)))
    throw new Error('raw restore target must be a new named directory under a real parent');
  try {
    await lstat(target);
    throw new Error('raw restore target already exists; preserve it and use a new directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!options.execute) return { mode: 'preview', files: m.files.length };
  await mkdir(target, { mode: 0o700 });
  const scratch = await scratchDirectory();
  try {
    for (const [i, file] of m.files.entries()) {
      const encrypted = join(scratch.path, `raw-${i}.enc`);
      await options.store.get(file.key, encrypted);
      await verifyArchiveFile(encrypted, {
        key: file.key,
        bytes: file.encryptedBytes,
        sha256: file.encryptedSha256,
      });
      const output = join(target, ...file.path.split('/'));
      if (!output.startsWith(`${target}${sep}`)) throw new Error('raw restore path escaped target');
      await mkdir(dirname(output), { recursive: true, mode: 0o700 });
      if ((await realpath(dirname(output))) !== dirname(output))
        throw new Error('raw restore directory traverses a symbolic link');
      await decryptFile(encrypted, output, options.secret);
      if ((await lstat(output)).size !== file.bytes || (await hashFile(output)) !== file.sha256)
        throw new Error('raw plaintext checksum mismatch');
      await unlink(encrypted);
    }
    await writeFile(
      join(target, 'RECOVERY_RECEIPT.json'),
      JSON.stringify({
        archive: m.id,
        files: m.files.length,
        outcome: 'verified',
        time: new Date().toISOString(),
      }),
      { mode: 0o600, flag: 'wx' },
    );
    return { mode: 'executed', files: m.files.length };
  } finally {
    await scratch.close();
  }
}
async function main() {
  const [mode, ...args] = process.argv.slice(2);
  const { values } = parseArgs({
    args,
    options: {
      execute: { type: 'boolean', default: false },
      manifest: { type: 'string' },
      target: { type: 'string' },
    },
  });
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const store = await createStore();
  const secret = process.env.BACKUP_ENCRYPTION_KEY ?? '';
  if (mode === 'backup') {
    const m = await archiveRaw({
      root: await persistentRawRoot(process.env.CIVIC_RAW_ROOT, repo),
      secret,
      store,
    });
    process.stdout.write(
      `${JSON.stringify({ archive: m.id, manifest: `raw/${m.id}/manifest.json`, files: m.files.length })}\n`,
    );
  } else if (mode === 'restore' && values.manifest && values.target) {
    process.stdout.write(
      `${JSON.stringify(await restoreRaw({ target: values.target, manifestKey: values.manifest, secret, store, execute: values.execute }))}\n`,
    );
  } else
    throw new Error(
      'raw.ts backup | restore --manifest raw/<archive>/manifest.json --target <new-directory> [--execute]',
    );
}
if (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url)))
  main().catch((error) => {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  });
