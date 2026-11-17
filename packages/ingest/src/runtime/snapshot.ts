import { createHash, randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { formatIngestScope, type SourceId } from '@civic-ledger/core';
import pLimit from 'p-limit';
import type { FetchContext, FetchPlan, RawSnapshot, SnapshotFile } from '../adapter';
import { downloadToFile, hashFile } from './download';
import type { HttpDeps } from './http';

const DOWNLOAD_CONCURRENCY = 3;
export const MANIFEST_FILE = 'manifest.json';
/**
 * Version of the app-owned manifest format (H3-08). v1 = { schema_version, source,
 * checksum, retrievedAt, upstream, files[] }. Manifests written before versioning have no
 * field and the same v1 shape; any other version is refused rather than misread.
 */
export const MANIFEST_SCHEMA_VERSION = 1;
const SUPPORTED_MANIFEST_VERSIONS: readonly number[] = [MANIFEST_SCHEMA_VERSION];

export interface SnapshotManifest {
  schema_version: number;
  source: string;
  /** The plan's note (e.g. the upstream tree id), when the snapshot was written with one. */
  note?: string;
}

/** Reads `manifest.json` from a snapshot directory, or null when there is none. */
export async function readManifest(directory: string): Promise<SnapshotManifest | null> {
  let text: string;
  try {
    text = await readFile(join(directory, MANIFEST_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const raw = JSON.parse(text) as {
    schema_version?: unknown;
    source?: unknown;
    note?: unknown;
  };
  const version = raw.schema_version ?? MANIFEST_SCHEMA_VERSION;
  if (typeof version !== 'number' || !SUPPORTED_MANIFEST_VERSIONS.includes(version)) {
    throw new Error(
      `${join(directory, MANIFEST_FILE)}: manifest schema_version ${String(version)} is not supported (this build reads ${SUPPORTED_MANIFEST_VERSIONS.join(', ')})`,
    );
  }
  return {
    schema_version: version,
    source: String(raw.source ?? ''),
    ...(typeof raw.note === 'string' ? { note: raw.note } : {}),
  };
}

/**
 * `<rawRoot>/<source>/<YYYY-MM-DD>/`: the UTC day a fetched snapshot was retrieved. Before
 * evidence trust (T-A) this was the snapshot directory itself (a later same-day run
 * overwrote it); such legacy directories still load with `--snapshot`. New runs retain
 * each snapshot one level deeper, in its own immutable directory (`finalizeSnapshot`).
 */
export function snapshotDirectory(rawRoot: string, source: SourceId, at: Date): string {
  return join(rawRoot, source, at.toISOString().slice(0, 10));
}

/** Per-source directory of in-flight downloads; never retained evidence, never archived. */
export const STAGING_DIR = '.staging';
/** Per-source directory of conditional-request body copies (see `downloadToFile`). */
export const HTTP_CACHE_DIR = '.http-cache';

/**
 * Canonical checksum of a snapshot: sha256 over sorted `name:sha256` lines plus the
 * upstream run ids. Independent of download time, so identical content dedupes.
 */
export function snapshotChecksum(
  files: readonly SnapshotFile[],
  upstream: Record<string, number | null>,
): string {
  const lines = [...files]
    .sort((a, b) => a.fileName.localeCompare(b.fileName))
    .map((f) => `file:${f.fileName}:${f.sha256}`);
  for (const key of Object.keys(upstream).sort()) lines.push(`upstream:${key}:${upstream[key]}`);
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/**
 * Downloads (or copies) every planned file into a fresh staging directory
 * `<rawRoot>/<source>/.staging/<runId>-<random>` and writes its manifest there. Nothing
 * outside that directory is written except the per-source conditional-request cache. On
 * any failure or cancellation the staging directory is removed (a partial download is not
 * evidence). The caller then either finalizes it (`finalizeSnapshot`) or discards it.
 */
export async function stageSnapshot(
  plan: FetchPlan,
  ctx: FetchContext,
  upstream: Record<string, number | null>,
  runId: number,
  http?: HttpDeps,
): Promise<RawSnapshot> {
  const retrievedAt = new Date();
  const sourceRoot = join(ctx.rawDir, plan.source);
  const directory = join(sourceRoot, STAGING_DIR, `${runId}-${randomBytes(4).toString('hex')}`);
  const cachePath = join(sourceRoot, 'http-cache.json');
  const cacheBodyDir = join(sourceRoot, HTTP_CACHE_DIR);
  await mkdir(directory, { recursive: true });
  try {
    const limit = pLimit(plan.concurrency ?? DOWNLOAD_CONCURRENCY);
    // After the first failure, queued requests are skipped and the ones in flight are left
    // to settle before the staging directory is removed: removing it under a download that
    // is still writing fails (EBUSY on Windows) or races it.
    let failure: { error: unknown } | undefined;
    const settled = await Promise.allSettled(
      plan.requests.map((request) =>
        limit(async (): Promise<SnapshotFile> => {
          if (failure) throw failure.error;
          try {
            return await fetchOne(request);
          } catch (error) {
            failure ??= { error };
            throw error;
          }
        }),
      ),
    );
    if (failure) throw failure.error;
    const files = settled.map((r) => (r as PromiseFulfilledResult<SnapshotFile>).value);
    const snapshot: RawSnapshot = {
      source: plan.source,
      directory,
      files,
      upstream,
      checksum: snapshotChecksum(files, upstream),
      retrievedAt,
      ...(plan.note ? { note: plan.note } : {}),
    };
    await writeManifest(snapshot, plan, runId);
    return snapshot;
  } catch (error) {
    // The original error is what the run reports; a failed cleanup is only logged.
    await rm(directory, { recursive: true, force: true }).catch((cleanup: unknown) =>
      ctx.logger?.warn({ err: cleanup, directory }, 'could not remove the staging directory'),
    );
    throw error;
  }

  async function fetchOne(request: FetchPlan['requests'][number]): Promise<SnapshotFile> {
    const targetPath = join(directory, request.fileName);
    if (request.localPath) {
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(request.localPath, targetPath);
      return { fileName: request.fileName, ...(await hashFile(targetPath, ctx.signal)) };
    }
    if (!request.url) throw new Error(`Fetch request ${request.fileName} has no url`);
    const file = await downloadToFile(
      {
        url: request.url,
        targetPath,
        cachePath,
        cacheBodyDir,
        timeoutMs: request.timeoutMs,
        browserLike: request.browserLike,
        headers: request.headers,
        signal: ctx.signal,
        logger: ctx.logger,
        gitBlob: request.gitBlob,
        maxBytes:
          request.maxBytes === undefined
            ? ctx.maxDownloadBytes
            : Math.min(request.maxBytes, ctx.maxDownloadBytes ?? request.maxBytes),
      },
      http,
    );
    return { fileName: request.fileName, sha256: file.sha256, bytes: file.bytes };
  }
}

export interface RetainedSnapshot {
  snapshot: RawSnapshot;
  /** `<source>/<YYYY-MM-DD>/<leaf>`, forward slashes, relative to the raw root. */
  locator: string;
}

/**
 * Moves a staged snapshot to its immutable evidence directory
 * `<rawRoot>/<source>/<YYYY-MM-DD of retrieval>/<prefix>-<checksum first 12>` by one
 * rename (atomic on one volume). `prefix` is the run id, or `check-<id>` for evidence kept
 * by an unchanged check. An existing directory is never reused or written into: on a
 * name clash (a raw root shared by two databases) a random suffix is added.
 */
export async function finalizeSnapshot(
  rawRoot: string,
  staged: RawSnapshot,
  prefix: string,
): Promise<RetainedSnapshot> {
  const day = staged.retrievedAt.toISOString().slice(0, 10);
  const parent = snapshotDirectory(rawRoot, staged.source, staged.retrievedAt);
  await mkdir(parent, { recursive: true });
  let leaf = `${prefix}-${staged.checksum.slice(0, 12)}`;
  if (await exists(join(parent, leaf))) leaf = `${leaf}-${randomBytes(3).toString('hex')}`;
  const directory = join(parent, leaf);
  await rename(staged.directory, directory);
  return {
    snapshot: { ...staged, directory },
    locator: `${staged.source}/${day}/${leaf}`,
  };
}

/** Removes a staged snapshot (only ever a directory directly under `<source>/.staging/`). */
export async function discardStagedSnapshot(rawRoot: string, staged: RawSnapshot): Promise<void> {
  const stagingRoot = join(resolve(rawRoot), staged.source, STAGING_DIR);
  const directory = resolve(staged.directory);
  if (dirname(directory) !== stagingRoot) {
    throw new Error(`Refusing to discard ${directory}: not a staged snapshot`);
  }
  await rm(directory, { recursive: true, force: true });
}

/**
 * The evidence directory a locator names: relative locators resolve under the raw root,
 * absolute ones (`--snapshot`) are returned as given.
 */
export function locatorDirectory(rawRoot: string, locator: string): string {
  return isAbsolute(locator) ? locator : join(rawRoot, ...locator.split('/'));
}

/**
 * True when `locator` is a fetched snapshot under the raw root whose manifest still names
 * `checksum`. `--snapshot` (absolute) locators are operator-managed and not trusted to stay.
 */
export async function retainedEvidenceMatches(
  rawRoot: string,
  locator: string | null,
  checksum: string,
): Promise<boolean> {
  if (!locator || isAbsolute(locator)) return false;
  try {
    const text = await readFile(join(locatorDirectory(rawRoot, locator), MANIFEST_FILE), 'utf8');
    return (JSON.parse(text) as { checksum?: unknown }).checksum === checksum;
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Uses files already on disk (`--snapshot <dir>`); every planned file must exist there. */
export async function snapshotFromDirectory(
  plan: FetchPlan,
  directory: string,
  upstream: Record<string, number | null>,
  signal?: AbortSignal,
): Promise<RawSnapshot> {
  const manifest = await readManifest(directory);
  if (manifest?.source && manifest.source !== plan.source) {
    throw new Error(`Snapshot ${directory} belongs to ${manifest.source}, not ${plan.source}`);
  }
  const files: SnapshotFile[] = [];
  let newest = 0;
  for (const request of plan.requests) {
    const path = join(directory, request.fileName);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) {
      throw new Error(`Snapshot ${directory} is missing ${request.fileName}`);
    }
    newest = Math.max(newest, info.mtimeMs);
    files.push({ fileName: request.fileName, ...(await hashFile(path, signal)) });
  }
  return {
    source: plan.source,
    directory: resolve(directory),
    files,
    upstream,
    checksum: snapshotChecksum(files, upstream),
    retrievedAt: newest > 0 ? new Date(newest) : new Date(),
    ...(plan.note || manifest?.note ? { note: plan.note ?? manifest?.note } : {}),
  };
}

/**
 * v1 manifest. `run_id` (the run that fetched it) and `scope` are additive v1 fields
 * (`readManifest` ignores fields it does not know).
 */
async function writeManifest(snapshot: RawSnapshot, plan: FetchPlan, runId: number): Promise<void> {
  const urls = new Map(plan.requests.map((r) => [r.fileName, r.url ?? r.localPath ?? null]));
  const manifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    source: snapshot.source,
    run_id: runId,
    scope: formatIngestScope(plan.scope),
    checksum: snapshot.checksum,
    retrievedAt: snapshot.retrievedAt.toISOString(),
    ...(snapshot.note ? { note: snapshot.note } : {}),
    upstream: snapshot.upstream,
    files: snapshot.files.map((f) => ({ ...f, from: urls.get(f.fileName) ?? null })),
  };
  await writeFile(
    join(snapshot.directory, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}
