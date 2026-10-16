import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Logger } from 'pino';
import { defaultHttpDeps, type HttpDeps, httpGet, type RetryPolicy } from './http';

export interface DownloadedFile {
  fileName: string;
  sha256: string;
  bytes: number;
  /** True when the server answered 304 and the cached copy was reused. */
  notModified: boolean;
}

export interface DownloadOptions {
  url: string;
  /** Absolute target path inside the run's snapshot directory. */
  targetPath: string;
  /** Per-source JSON file remembering validators (ETag/Last-Modified) per URL. */
  cachePath: string;
  timeoutMs?: number;
  browserLike?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  logger?: Logger;
  policy?: RetryPolicy;
}

interface CacheEntry {
  etag?: string;
  lastModified?: string;
  path: string;
  sha256: string;
  bytes: number;
}
type HttpCache = Record<string, CacheEntry>;

/**
 * Streams a URL to disk while hashing it (never buffering the body), using conditional GET
 * when an earlier copy exists. Writes to a temp file and renames, so a failed download
 * never leaves a partial file under the snapshot name.
 */
export async function downloadToFile(
  options: DownloadOptions,
  deps: HttpDeps = defaultHttpDeps,
): Promise<DownloadedFile> {
  const cache = await readCache(options.cachePath);
  const cached = cache[options.url];
  const reusable = cached && (await isIntact(cached)) ? cached : undefined;
  const conditional: Record<string, string> = {};
  if (reusable?.etag) conditional['if-none-match'] = reusable.etag;
  if (reusable?.lastModified) conditional['if-modified-since'] = reusable.lastModified;

  await mkdir(dirname(options.targetPath), { recursive: true });
  const response = await httpGet(
    options.url,
    {
      headers: { ...options.headers, ...conditional },
      timeoutMs: options.timeoutMs,
      browserLike: options.browserLike,
      signal: options.signal,
      logger: options.logger,
      policy: options.policy,
    },
    deps,
  );
  const fileName = options.targetPath.split(/[\\/]/).at(-1) ?? options.targetPath;

  if (response.status === 304 && reusable) {
    await response.body?.cancel();
    if (resolve(reusable.path) !== resolve(options.targetPath)) {
      await copyFile(reusable.path, options.targetPath);
    }
    options.logger?.info({ url: options.url }, 'not modified; reusing cached copy');
    await updateCache(options.cachePath, options.url, { ...reusable, path: options.targetPath });
    return { fileName, sha256: reusable.sha256, bytes: reusable.bytes, notModified: true };
  }
  if (!response.body) throw new Error(`GET ${options.url}: empty response body`);

  const hash = createHash('sha256');
  let bytes = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  const tempPath = `${options.targetPath}.part`;
  try {
    await pipeline(
      Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
      tap,
      createWriteStream(tempPath),
    );
    await rename(tempPath, options.targetPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
  const sha256 = hash.digest('hex');
  const entry: CacheEntry = { path: options.targetPath, sha256, bytes };
  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');
  if (etag) entry.etag = etag;
  if (lastModified) entry.lastModified = lastModified;
  await updateCache(options.cachePath, options.url, entry);
  options.logger?.info({ url: options.url, bytes, sha256 }, 'downloaded');
  return { fileName, sha256, bytes, notModified: false };
}

/** sha256 + size of a file on disk, streamed. */
export async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

async function isIntact(entry: CacheEntry): Promise<boolean> {
  try {
    const info = await stat(entry.path);
    if (info.size !== entry.bytes) return false;
    return (await hashFile(entry.path)).sha256 === entry.sha256;
  } catch {
    return false;
  }
}

async function readCache(path: string): Promise<HttpCache> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as HttpCache;
  } catch {
    return {};
  }
}

/** Pending cache writes per cache file: parallel downloads of one source share the file. */
const cacheWrites = new Map<string, Promise<void>>();

/** Read-modify-write of one URL's entry, serialized per cache file so no update is lost. */
async function updateCache(path: string, url: string, entry: CacheEntry): Promise<void> {
  const previous = cacheWrites.get(path) ?? Promise.resolve();
  const next = previous.then(async () => {
    const cache = await readCache(path);
    cache[url] = entry;
    await mkdir(dirname(path), { recursive: true });
    const temp = join(dirname(path), `.http-cache.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(temp, `${JSON.stringify(cache, null, 2)}\n`);
    await rename(temp, path);
  });
  cacheWrites.set(
    path,
    next.catch(() => undefined),
  );
  await next;
}
