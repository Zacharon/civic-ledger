import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { downloadToFile } from '../src/runtime/download';
import type { HttpDeps } from '../src/runtime/http';

/**
 * H3R2-03: a cached copy reused on 304 must respect the CURRENT download cap, and the
 * integrity check of the cached copy must stop when the run is cancelled. Mocked fetch
 * only: no request leaves the process.
 */
const URL_ = 'https://example.org/file.csv';

/** Scripted fetch: each call takes the next response; records conditional headers. */
function scripted(responses: (() => Response)[]) {
  const calls: Record<string, string>[] = [];
  const deps: HttpDeps = {
    fetch: async (_input, init) => {
      calls.push({ ...(init?.headers as Record<string, string>) });
      const next = responses.shift();
      if (!next) throw new Error('unexpected extra request');
      return next();
    },
    sleep: async () => {},
    random: () => 0,
  };
  return { deps, calls };
}

const body = (bytes: number) => () =>
  new Response(Buffer.alloc(bytes, 'x'), { status: 200, headers: { etag: '"v1"' } });
const notModified = () => () => new Response(null, { status: 304 });

async function cachedDownload(bytes: number, steps: (() => Response)[]) {
  const dir = await mkdtemp(join(tmpdir(), 'civic-cache-cap-'));
  const cachePath = join(dir, 'http-cache.json');
  const { deps, calls } = scripted([body(bytes), ...steps]);
  const first = await downloadToFile(
    { url: URL_, targetPath: join(dir, 'day1', 'file.csv'), cachePath, maxBytes: 2 * bytes },
    deps,
  );
  expect(first).toMatchObject({ bytes, notModified: false });
  return { dir, cachePath, deps, calls };
}

describe('cached 304 reuse and the download cap (H3R2-03)', () => {
  it('refuses to reuse a cached copy larger than a lowered cap', async () => {
    const { dir, cachePath, deps, calls } = await cachedDownload(4_096, [notModified()]);
    const target = join(dir, 'day2', 'file.csv');
    await expect(
      downloadToFile({ url: URL_, targetPath: target, cachePath, maxBytes: 1_024 }, deps),
    ).rejects.toThrow(/4096 bytes.*1024-byte download cap/);
    // The over-cap copy was not offered for revalidation and nothing was copied.
    expect(calls[1]?.['if-none-match']).toBeUndefined();
    expect(await readdir(join(dir, 'day2')).catch(() => [])).toEqual([]);
  });

  it('still reuses an intact cached copy within the cap', async () => {
    const { dir, cachePath, deps, calls } = await cachedDownload(4_096, [notModified()]);
    const target = join(dir, 'day2', 'file.csv');
    const second = await downloadToFile(
      { url: URL_, targetPath: target, cachePath, maxBytes: 4_096 },
      deps,
    );
    expect(second).toMatchObject({ bytes: 4_096, notModified: true });
    expect(calls[1]?.['if-none-match']).toBe('"v1"');
    expect((await readFile(target)).length).toBe(4_096);
  });

  it('stops validating the cached copy when the run is cancelled', async () => {
    // 32 MiB: hashing it takes hundreds of reads, so the abort lands while it runs.
    const size = 32 * 1024 * 1024;
    const { dir, cachePath, deps, calls } = await cachedDownload(size, [notModified()]);
    const abort = new AbortController();
    const pending = downloadToFile(
      {
        url: URL_,
        targetPath: join(dir, 'day2', 'file.csv'),
        cachePath,
        maxBytes: 2 * size,
        signal: abort.signal,
      },
      deps,
    );
    setTimeout(() => abort.abort(new Error('interrupted (SIGINT)')), 0);
    await expect(pending).rejects.toThrow('interrupted (SIGINT)');
    // Cancelled before the conditional request: no second fetch was made.
    expect(calls).toHaveLength(1);
  });
});
