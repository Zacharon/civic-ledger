import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DbHandle } from '@civic-ledger/db';
import { syntheticGreyJpeg } from '@civic-ledger/db/seed';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectJpeg, JpegError } from '../src/adapters/member-photos/jpeg';
import { filesInListing, TREE_URL } from '../src/adapters/member-photos/plan';
import type { HttpDeps } from '../src/runtime/http';
import { runIngest } from '../src/runtime/run';
import { DEFAULT_SHRINK_GUARD } from '../src/runtime/shrink-guard';
import { FIXTURES, freshDb, ingestFixture, rows, testRuntime } from './helpers';

const PHOTOS = join(FIXTURES, 'member-photos');
let handle: DbHandle;
beforeEach(async () => {
  handle = await freshDb();
});
afterEach(() => handle.close());

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const photoRows = () =>
  rows<{
    bioguide: string;
    variant: string;
    content_type: string;
    width: number;
    height: number;
    byte_length: number;
    sha256: string;
    origin_url: string;
    source_key: string;
    hex: string;
  }>(
    handle.db,
    sql`select i.value as bioguide, p.variant, p.content_type, p.width, p.height, p.byte_length,
               p.sha256, p.origin_url, p.source_key, encode(p.data, 'hex') as hex
        from person_portrait p
        join person_identifier i on i.person_id = p.person_id and i.scheme = 'bioguide'
        order by i.value, p.variant`,
  );

async function copyPhotos(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'civic-photos-'));
  await cp(PHOTOS, dir, { recursive: true, filter: (src) => !src.endsWith('.ts') });
  return dir;
}

describe('JPEG validation', () => {
  it('reads the pixel size of a complete JPEG', () => {
    expect(inspectJpeg(syntheticGreyJpeg(225, 275))).toEqual({
      width: 225,
      height: 275,
      components: 1,
      progressive: false,
    });
    expect(inspectJpeg(syntheticGreyJpeg(450, 550))).toMatchObject({ width: 450, height: 550 });
  });

  it('rejects an HTML page, a PNG, an empty file and random bytes', () => {
    const html = new TextEncoder().encode(`<!doctype html><title>404</title>${'x'.repeat(300)}`);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...new Array<number>(200).fill(7)]);
    for (const bytes of [html, png, new Uint8Array(0), new Uint8Array(300).fill(0xab)]) {
      expect(() => inspectJpeg(bytes)).toThrow(JpegError);
    }
  });

  it('rejects a truncated JPEG, a JPEG with no scan and a zero-sized frame', () => {
    const good = syntheticGreyJpeg(225, 275);
    expect(() => inspectJpeg(good.slice(0, good.length - 10))).toThrow(/end-of-image/);
    // Markers up to the frame header only, then EOI: no scan data.
    const noScan = Uint8Array.from([...good.slice(0, 20 + 69 + 8 + 11 - 8), 0xff, 0xd9]);
    expect(() => inspectJpeg(new Uint8Array([...noScan, ...new Array(100).fill(0)]))).toThrow(
      JpegError,
    );
    const zero = Uint8Array.from(good);
    const sof = zero.findIndex((b, i) => b === 0xff && zero[i + 1] === 0xc0);
    zero.set([0, 0], sof + 5); // height
    expect(() => inspectJpeg(zero)).toThrow(/zero width or height/);
  });
});

describe('repository listing', () => {
  it('keeps only the two variant folders and counts bytes per file', () => {
    const files = filesInListing({
      truncated: false,
      tree: [
        { path: 'congress/225x275/A000001.jpg', type: 'blob', size: 10 },
        { path: 'congress/450x550/A000001.jpg', type: 'blob', size: 20 },
        { path: 'congress/original/A000001.jpg', type: 'blob', size: 99 },
        { path: 'congress/225x275', type: 'tree' },
        { path: 'congress/225x275/not-an-id.jpg', type: 'blob', size: 5 },
      ],
    });
    expect([...files]).toEqual([
      ['225x275/A000001', 10],
      ['450x550/A000001', 20],
    ]);
  });

  it('refuses a truncated listing, which would silently drop people', () => {
    expect(() => filesInListing({ truncated: true, tree: [] })).toThrow(/truncated/);
    expect(() => filesInListing({})).toThrow(/no "tree"/);
  });
});

describe('member-photos ingest from a snapshot directory', () => {
  async function load() {
    const rt = await testRuntime(handle);
    expect((await ingestFixture(rt, 'congress-legislators')).status).toBe('succeeded');
    return { rt, receipt: await ingestFixture(rt, 'member-photos') };
  }

  it('stores validated pairs with bytes, sha256, size and provenance; rejects the rest', async () => {
    const { receipt } = await load();
    expect(receipt).toMatchObject({ status: 'succeeded', actor: 'operator', error: null });
    expect(receipt.counts).toMatchObject({
      portraits: 8,
      people_with_portrait: 4,
      people_in_scope: 7,
      people_without_portrait: 4,
      files_rejected: 4,
      rejected_incomplete_pair: 1,
      rejected_not_jpeg: 2,
      rejected_wrong_size: 1,
      bioguide_not_in_legislators: 1,
      stale_portraits_deleted: 0,
    });

    const stored = await photoRows();
    expect(stored.map((r) => `${r.bioguide}/${r.variant}`)).toEqual([
      'B000546/225x275',
      'B000546/450x550',
      'B001282/225x275',
      'B001282/450x550',
      'C000127/225x275',
      'C000127/450x550',
      'N000147/225x275',
      'N000147/450x550',
    ]);
    for (const row of stored) {
      const file = await readFile(join(PHOTOS, row.variant, `${row.bioguide}.jpg`));
      expect(row.hex).toBe(file.toString('hex'));
      expect(row.sha256).toBe(sha(file));
      expect(row.byte_length).toBe(file.length);
      expect(row.content_type).toBe('image/jpeg');
      expect([row.width, row.height]).toEqual(row.variant === '225x275' ? [225, 275] : [450, 550]);
      expect(row.origin_url).toBe(
        `https://unitedstates.github.io/images/congress/${row.variant}/${row.bioguide}.jpg`,
      );
      expect(row.source_key).toBe(`portrait:${row.bioguide}:${row.variant}`);
    }
    // A rejected pair stores nothing, not even the half that was fine.
    expect(
      stored.some((r) => ['A000375', 'V000133', 'K000401', 'H001096'].includes(r.bioguide)),
    ).toBe(false);
    const [provenance] = await rows<{ source_id: string; run: number }>(
      handle.db,
      sql`select distinct source_id, ingest_run_id as run from person_portrait`,
    );
    expect(provenance?.source_id).toBe('member-photos');
  });

  it('is idempotent: the same snapshot returns the current run without a second load', async () => {
    const { rt, receipt } = await load();
    const again = await ingestFixture(rt, 'member-photos');
    expect(again).toMatchObject({ runId: receipt.runId, deduplicated: true });
    const [n] = await rows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from person_portrait`,
    );
    expect(n?.n).toBe(8);
  });

  it('fails a snapshot with no images and writes nothing', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    const empty = await mkdtemp(join(tmpdir(), 'civic-photos-empty-'));
    const receipt = await ingestFixture(rt, 'member-photos', empty);
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/has no 225x275 or 450x550 \.jpg files/);
    expect(await photoRows()).toEqual([]);
  });

  it('rejects an oversized file by its size, before reading it', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    const dir = await copyPhotos();
    const huge = Buffer.alloc(2 * 1024 * 1024 + 1, 1);
    huge.set(syntheticGreyJpeg(225, 275).slice(0, 4));
    await writeFile(join(dir, '225x275', 'C000127.jpg'), huge);
    const receipt = await ingestFixture(rt, 'member-photos', dir);
    expect(receipt.status).toBe('succeeded');
    expect(receipt.counts).toMatchObject({ rejected_too_large: 1, people_with_portrait: 3 });
    expect((await photoRows()).some((r) => r.bioguide === 'C000127')).toBe(false);
  });

  it('keeps a person’s previous good pair when a later download is corrupt', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    await ingestFixture(rt, 'member-photos');
    const before = (await photoRows()).filter((r) => r.bioguide === 'C000127');

    const dir = await copyPhotos();
    await writeFile(join(dir, '450x550', 'C000127.jpg'), '<html>maintenance</html>'.repeat(20));
    const receipt = await ingestFixture(rt, 'member-photos', dir);
    expect(receipt.status).toBe('succeeded');
    expect(receipt.counts).toMatchObject({
      rejected_not_jpeg: 3,
      rejected_kept_previous: expect.any(Number),
      stale_portraits_deleted: 0,
    });
    expect((await photoRows()).filter((r) => r.bioguide === 'C000127')).toEqual(before);
  });

  it('is refused by the shrink guard when most portraits vanish, and applies with the override', async () => {
    const strict = await testRuntime(handle, {
      shrinkGuard: { ...DEFAULT_SHRINK_GUARD, minBaseline: 2 },
    });
    await ingestFixture(strict, 'congress-legislators');
    expect((await ingestFixture(strict, 'member-photos')).status).toBe('succeeded');

    const thin = await copyPhotos();
    for (const id of ['N000147', 'B001282', 'B000546']) {
      await rm(join(thin, '225x275', `${id}.jpg`));
      await rm(join(thin, '450x550', `${id}.jpg`));
    }
    const refused = await ingestFixture(strict, 'member-photos', thin);
    expect(refused.status).toBe('failed');
    expect(refused.error).toMatch(/^shrink guard: /);
    expect(refused.error).toMatch(/person_portrait/);
    expect((await photoRows()).length).toBe(8);

    const override = await testRuntime(handle, {
      shrinkGuard: { ...DEFAULT_SHRINK_GUARD, minBaseline: 2, allow: true },
    });
    const applied = await ingestFixture(override, 'member-photos', thin);
    expect(applied.status).toBe('succeeded');
    expect(applied.note).toMatch(/shrink guard overridden/);
    expect(applied.counts.stale_portraits_deleted).toBe(6);
    expect((await photoRows()).length).toBe(2);
  });
});

describe('member-photos ingest over HTTP (fake server, no network)', () => {
  const TREE = (names: string[], extra: object = {}) => ({
    truncated: false,
    tree: names.map((path) => ({ path, type: 'blob', size: 600 })),
    ...extra,
  });

  /** A fake GitHub API + Pages: serves the committed fixture files, with ETag/304. */
  function fakeServer(options: { tree: object; missing?: Set<string>; oversize?: Set<string> }) {
    const log: { url: string; conditional: boolean }[] = [];
    const deps: HttpDeps = {
      fetch: async (input, init) => {
        const url = String(input);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        log.push({ url, conditional: 'if-none-match' in headers });
        if (url === TREE_URL) return Response.json(options.tree);
        const match = /\/congress\/(225x275|450x550)\/([A-Z]\d{6})\.jpg$/.exec(url);
        if (!match) return new Response('nope', { status: 404 });
        const path = `${match[1]}/${match[2]}.jpg`;
        if (options.missing?.has(path)) return new Response('missing', { status: 404 });
        if (options.oversize?.has(path)) {
          return new Response(Buffer.alloc(3 * 1024 * 1024, 1), { status: 200 });
        }
        const bytes = await readFile(join(PHOTOS, match[1] ?? '', `${match[2]}.jpg`));
        const etag = `"${sha(bytes).slice(0, 16)}"`;
        if (headers['if-none-match'] === etag) return new Response(null, { status: 304 });
        return new Response(bytes, {
          status: 200,
          headers: { etag, 'content-type': 'image/jpeg' },
        });
      },
      sleep: async () => undefined,
      random: () => 0,
    };
    return { deps, log };
  }
  const complete = ['C000127', 'N000147', 'B001282', 'B000546', 'Z999999'].flatMap((id) => [
    `congress/225x275/${id}.jpg`,
    `congress/450x550/${id}.jpg`,
  ]);

  it('downloads only people in scope with both sizes, writes a manifest, and reruns as 304s', async () => {
    const server = fakeServer({
      tree: TREE([...complete, 'congress/225x275/A000375.jpg', 'congress/original/C000127.jpg']),
    });
    const rt = await testRuntime(handle, { http: server.deps });
    await ingestFixture(rt, 'congress-legislators');
    const receipt = await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt);
    expect(receipt.status).toBe('succeeded');
    // Scope: B000546 (last term ended in 1790) and Z999999 (unknown) are never requested;
    // A000375 has only one size, so it is skipped; "original" is never requested.
    const imageUrls = server.log.map((l) => l.url).filter((u) => u !== TREE_URL);
    expect(imageUrls.sort()).toEqual(
      ['C000127', 'N000147', 'B001282']
        .flatMap((id) => [
          `https://unitedstates.github.io/images/congress/225x275/${id}.jpg`,
          `https://unitedstates.github.io/images/congress/450x550/${id}.jpg`,
        ])
        .sort(),
    );
    expect(receipt.counts).toMatchObject({ portraits: 6, people_with_portrait: 3 });

    const [directory] = await readdir(join(rt.rawRoot, 'member-photos'), {
      withFileTypes: true,
    }).then((entries) => entries.filter((e) => e.isDirectory()));
    const manifest = JSON.parse(
      await readFile(
        join(rt.rawRoot, 'member-photos', directory?.name ?? '', 'manifest.json'),
        'utf8',
      ),
    ) as {
      source: string;
      files: { fileName: string; sha256: string; bytes: number; from: string }[];
    };
    expect(manifest.source).toBe('member-photos');
    expect(manifest.files).toHaveLength(6);
    for (const file of manifest.files) {
      expect(file.sha256).toBe(sha(await readFile(join(PHOTOS, file.fileName))));
      expect(file.from).toMatch(/^https:\/\/unitedstates\.github\.io\/images\/congress\//);
    }

    server.log.length = 0;
    const again = await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt);
    expect(again).toMatchObject({ runId: receipt.runId, deduplicated: true });
    const images = server.log.filter((l) => l.url !== TREE_URL);
    expect(images).toHaveLength(6);
    expect(images.every((l) => l.conditional)).toBe(true);
  });

  it('fails the run, loading nothing, when a listed file is missing upstream (404)', async () => {
    const server = fakeServer({ tree: TREE(complete), missing: new Set(['450x550/N000147.jpg']) });
    const rt = await testRuntime(handle, { http: server.deps });
    await ingestFixture(rt, 'congress-legislators');
    const receipt = await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt);
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/N000147\.jpg failed: HTTP 404/);
    expect(await photoRows()).toEqual([]);
  });

  it('enforces the per-file download cap on a body larger than any real portrait', async () => {
    const server = fakeServer({ tree: TREE(complete), oversize: new Set(['225x275/B001282.jpg']) });
    const rt = await testRuntime(handle, { http: server.deps });
    await ingestFixture(rt, 'congress-legislators');
    const receipt = await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt);
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/exceeds the 2097152-byte download cap/);
    expect(await photoRows()).toEqual([]);
  });

  it('refuses a listing whose selected files exceed the total cap, before any download', async () => {
    const server = fakeServer({ tree: TREE(complete) });
    const rt = await testRuntime(handle, { http: server.deps });
    await ingestFixture(rt, 'congress-legislators');
    process.env.INGEST_MAX_PORTRAIT_TOTAL_BYTES = '1000';
    try {
      const receipt = await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt);
      expect(receipt.status).toBe('failed');
      expect(receipt.error).toMatch(/INGEST_MAX_PORTRAIT_TOTAL_BYTES cap; nothing was downloaded/);
      expect(server.log.filter((l) => l.url !== TREE_URL)).toHaveLength(0);
    } finally {
      delete process.env.INGEST_MAX_PORTRAIT_TOTAL_BYTES;
    }
  });

  it('fails clearly when the repository listing is truncated', async () => {
    const server = fakeServer({ tree: TREE(complete, { truncated: true }) });
    const rt = await testRuntime(handle, { http: server.deps });
    await ingestFixture(rt, 'congress-legislators');
    const receipt = await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt);
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/listing is truncated/);
  });
});
