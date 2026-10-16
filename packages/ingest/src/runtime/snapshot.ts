import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { SourceId } from '@civic-ledger/core';
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
  const raw = JSON.parse(text) as { schema_version?: unknown; source?: unknown };
  const version = raw.schema_version ?? MANIFEST_SCHEMA_VERSION;
  if (typeof version !== 'number' || !SUPPORTED_MANIFEST_VERSIONS.includes(version)) {
    throw new Error(
      `${join(directory, MANIFEST_FILE)}: manifest schema_version ${String(version)} is not supported (this build reads ${SUPPORTED_MANIFEST_VERSIONS.join(', ')})`,
    );
  }
  return { schema_version: version, source: String(raw.source ?? '') };
}

/** `data/raw/<source>/<YYYY-MM-DD>/`: one snapshot directory per source and UTC day. */
export function snapshotDirectory(rawRoot: string, source: SourceId, at: Date): string {
  return join(rawRoot, source, at.toISOString().slice(0, 10));
}

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

/** Downloads (or copies) every planned file into today's snapshot directory. */
export async function fetchSnapshot(
  plan: FetchPlan,
  ctx: FetchContext,
  upstream: Record<string, number | null>,
  http?: HttpDeps,
): Promise<RawSnapshot> {
  const retrievedAt = new Date();
  const directory = snapshotDirectory(ctx.rawDir, plan.source, retrievedAt);
  const cachePath = join(ctx.rawDir, plan.source, 'http-cache.json');
  await mkdir(directory, { recursive: true });
  const limit = pLimit(DOWNLOAD_CONCURRENCY);
  const files = await Promise.all(
    plan.requests.map((request) =>
      limit(async (): Promise<SnapshotFile> => {
        const targetPath = join(directory, request.fileName);
        if (request.localPath) {
          await mkdir(dirname(targetPath), { recursive: true });
          if (resolve(request.localPath) !== resolve(targetPath)) {
            await copyFile(request.localPath, targetPath);
          }
          return { fileName: request.fileName, ...(await hashFile(targetPath, ctx.signal)) };
        }
        if (!request.url) throw new Error(`Fetch request ${request.fileName} has no url`);
        const file = await downloadToFile(
          {
            url: request.url,
            targetPath,
            cachePath,
            timeoutMs: request.timeoutMs,
            browserLike: request.browserLike,
            headers: request.headers,
            signal: ctx.signal,
            logger: ctx.logger,
            maxBytes: ctx.maxDownloadBytes,
          },
          http,
        );
        return { fileName: request.fileName, sha256: file.sha256, bytes: file.bytes };
      }),
    ),
  );
  const snapshot: RawSnapshot = {
    source: plan.source,
    directory,
    files,
    upstream,
    checksum: snapshotChecksum(files, upstream),
    retrievedAt,
  };
  await writeManifest(snapshot, plan);
  return snapshot;
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
  };
}

async function writeManifest(snapshot: RawSnapshot, plan: FetchPlan): Promise<void> {
  const urls = new Map(plan.requests.map((r) => [r.fileName, r.url ?? r.localPath ?? null]));
  const manifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    source: snapshot.source,
    checksum: snapshot.checksum,
    retrievedAt: snapshot.retrievedAt.toISOString(),
    upstream: snapshot.upstream,
    files: snapshot.files.map((f) => ({ ...f, from: urls.get(f.fileName) ?? null })),
  };
  await writeFile(
    join(snapshot.directory, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}
