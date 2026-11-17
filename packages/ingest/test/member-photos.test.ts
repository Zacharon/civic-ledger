import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DbHandle } from '@civic-ledger/db';
import { syntheticGreyJpeg } from '@civic-ledger/db/seed';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectJpeg, JpegError, stripJpegMetadata } from '../src/adapters/member-photos/jpeg';
import { filesInListing, fitsVariantBox, TREE_URL } from '../src/adapters/member-photos/plan';
import type { HttpDeps } from '../src/runtime/http';
import { runIngest } from '../src/runtime/run';
import { DEFAULT_SHRINK_GUARD } from '../src/runtime/shrink-guard';
import { FIXTURES, freshDb, ingestFixture, rows, testRuntime } from './helpers';
import {
  adobeSegment,
  commentSegment,
  exifSegment,
  iccSegment,
  jfxxSegment,
  photoshopSegment,
  withJfifThumbnail,
  withSegments,
  withTrailingSegment,
} from './support/jpeg-segments';

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
    origin_sha256: string;
    origin_byte_length: number;
    origin_url: string;
    source_key: string;
    hex: string;
  }>(
    handle.db,
    sql`select i.value as bioguide, p.variant, p.content_type, p.width, p.height, p.byte_length,
               p.sha256, p.origin_sha256, p.origin_byte_length, p.origin_url, p.source_key, encode(p.data, 'hex') as hex
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

  it('accepts 1, 3 and 4 colour components (browsers decode CMYK) but not 2', () => {
    const good = syntheticGreyJpeg(225, 275);
    const sof = good.findIndex((b, i) => b === 0xff && good[i + 1] === 0xc0);
    for (const [components, ok] of [
      [1, true],
      [3, true],
      [4, true],
      [2, false],
      [0, false],
    ] as const) {
      const bytes = Uint8Array.from(good);
      bytes[sof + 9] = components;
      if (ok) expect(inspectJpeg(bytes).components).toBe(components);
      else expect(() => inspectJpeg(bytes)).toThrow(/colour components/);
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

describe('variant box', () => {
  const small = { width: 225, height: 275 };
  it('accepts photos fitted to the box and small originals, rejects larger or tiny files', () => {
    expect(fitsVariantBox(225, 275, small)).toBe(true);
    expect(fitsVariantBox(183, 275, small)).toBe(true); // narrower than the box
    expect(fitsVariantBox(225, 150, small)).toBe(true); // a wide crop upstream also keeps
    expect(fitsVariantBox(225, 275, { width: 450, height: 550 })).toBe(true); // small original
    expect(fitsVariantBox(226, 275, small)).toBe(false);
    expect(fitsVariantBox(225, 276, small)).toBe(false);
    expect(fitsVariantBox(40, 50, small)).toBe(false); // thumbnail
  });
});

describe('metadata stripping', () => {
  const base = syntheticGreyJpeg(225, 275, 150);
  const rich = withSegments(base, [
    exifSegment({ gps: true, thumbnail: true }),
    commentSegment('a comment'),
    photoshopSegment(),
    jfxxSegment(),
    iccSegment(),
    adobeSegment(),
  ]);

  it('drops EXIF/XMP, comments, APP13 and JFXX; keeps JFIF, ICC and Adobe; changes no pixel data', () => {
    expect(() => inspectJpeg(rich)).not.toThrow();
    const result = stripJpegMetadata(rich);
    expect(result.dropped).toEqual({ APP1: 1, COM: 1, APP13: 1, APP0: 1 });
    expect(result.hadExif).toBe(true);
    expect(result.hadGps).toBe(true);
    expect(result.hadThumbnail).toBe(true);
    expect(result.removedBytes).toBe(rich.length - result.bytes.length);
    // What remains is the original plus exactly the kept segments, nothing from the dropped ones.
    expect(result.bytes).toEqual(withSegments(base, [iccSegment(), adobeSegment()]));
    expect(inspectJpeg(result.bytes)).toMatchObject({ width: 225, height: 275 });
    const text = Buffer.from(result.bytes).toString('latin1');
    for (const gone of ['SERIAL-0000-FAKE', 'a comment', 'FAKE-IPTC', 'JFXX', 'Exif']) {
      expect(text).not.toContain(gone);
    }
  });

  it('reports EXIF without GPS or a thumbnail as such, and is a no-op on a clean file', () => {
    const plain = stripJpegMetadata(
      withSegments(base, [exifSegment({ gps: false, thumbnail: false })]),
    );
    expect(plain).toMatchObject({ hadExif: true, hadGps: false, hadThumbnail: false });
    const clean = stripJpegMetadata(base);
    expect(clean.bytes).toEqual(base);
    expect(clean).toMatchObject({ removedBytes: 0, dropped: {}, hadExif: false });
  });

  it('zeroes a JFIF thumbnail instead of dropping the JFIF header', () => {
    const withThumb = withJfifThumbnail(base);
    expect(() => inspectJpeg(withThumb)).not.toThrow();
    const result = stripJpegMetadata(withThumb);
    expect(result.hadThumbnail).toBe(true);
    expect(result.bytes).toEqual(base);
  });

  it('drops a comment that follows the scan and leaves the entropy data alone', () => {
    const late = withTrailingSegment(base, commentSegment('after the scan'));
    expect(() => inspectJpeg(late)).not.toThrow();
    expect(stripJpegMetadata(late).bytes).toEqual(base);
  });

  it('never alters stuffed bytes, restart markers or fill inside the scan', () => {
    // 0xFF00 (stuffed) and 0xFFD0 (restart) in entropy data are data, not segment markers.
    const sos = base.findIndex((b, i) => b === 0xff && base[i + 1] === 0xda);
    const header = sos + 2 + (((base[sos + 2] ?? 0) << 8) | (base[sos + 3] ?? 0));
    const entropy = Uint8Array.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xff, 0x00]);
    const crafted = Uint8Array.from([
      ...base.subarray(0, header),
      ...entropy,
      ...commentSegment('after the scan'),
      0xff,
      0xd9,
    ]);
    expect(Array.from(stripJpegMetadata(crafted).bytes)).toEqual([
      ...base.subarray(0, header),
      ...entropy,
      0xff,
      0xd9,
    ]);
  });
});

describe('repository listing', () => {
  it('keeps only the two variant folders and counts bytes per file', () => {
    const sha1 = 'a'.repeat(40);
    const { files, treeSha } = filesInListing({
      truncated: false,
      sha: 'b'.repeat(40),
      tree: [
        { path: 'congress/225x275/A000001.jpg', type: 'blob', size: 10, sha: sha1 },
        { path: 'congress/450x550/A000001.jpg', type: 'blob', size: 20, sha: sha1 },
        { path: 'congress/original/A000001.jpg', type: 'blob', size: 99, sha: sha1 },
        { path: 'congress/225x275', type: 'tree' },
        { path: 'congress/225x275/not-an-id.jpg', type: 'blob', size: 5, sha: sha1 },
        { path: 'congress/225x275/A000002.jpg', type: 'blob', size: 5, sha: 'nothex' },
      ],
    });
    expect(treeSha).toBe('b'.repeat(40));
    expect([...files]).toEqual([
      ['225x275/A000001', { size: 10, sha: sha1 }],
      ['450x550/A000001', { size: 20, sha: sha1 }],
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
      portraits: 9,
      people_with_portrait: 5,
      people_without_450: 1,
      people_in_scope: 7,
      people_without_portrait: 3,
      files_rejected: 3,
      rejected_missing_1x: 0,
      rejected_not_jpeg: 2,
      files_with_exif: 2,
      files_with_gps: 1,
      files_with_thumbnail: 1,
      rejected_wrong_size: 1,
      bioguide_not_in_legislators: 1,
      stale_portraits_deleted: 0,
    });

    const stored = await photoRows();
    expect(stored.map((r) => `${r.bioguide}/${r.variant}`)).toEqual([
      'A000375/225x275',
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
      // Stored bytes are the downloaded file without its metadata; the downloaded file's own
      // sha256 and size are kept as provenance.
      const stripped = stripJpegMetadata(file).bytes;
      expect(row.hex).toBe(Buffer.from(stripped).toString('hex'));
      expect(row.sha256).toBe(sha(stripped));
      expect(row.byte_length).toBe(stripped.length);
      expect(row.origin_sha256).toBe(sha(file));
      expect(row.origin_byte_length).toBe(file.length);
      expect(row.content_type).toBe('image/jpeg');
      const dims = inspectJpeg(stripped);
      expect([row.width, row.height]).toEqual([dims.width, dims.height]);
      expect(row.origin_url).toBe(
        `https://unitedstates.github.io/images/congress/${row.variant}/${row.bioguide}.jpg`,
      );
      expect(row.source_key).toBe(`portrait:${row.bioguide}:${row.variant}`);
    }
    // Upstream fits photos to the box keeping their proportions: a narrower file is kept as is.
    expect(stored.find((r) => r.bioguide === 'N000147' && r.variant === '225x275')).toMatchObject({
      width: 183,
      height: 275,
    });
    expect(stored.find((r) => r.bioguide === 'N000147' && r.variant === '450x550')).toMatchObject({
      width: 450,
      height: 550,
    });
    // C000127's files carried EXIF (GPS, thumbnail), a comment, Photoshop data and a JFXX
    // thumbnail: none of it is stored, the ICC profile and Adobe segment are.
    const c000127 = stored.find((r) => r.bioguide === 'C000127' && r.variant === '225x275');
    expect(c000127?.sha256).not.toBe(c000127?.origin_sha256);
    expect(c000127?.byte_length).toBeLessThan(c000127?.origin_byte_length ?? 0);
    expect(c000127?.hex).not.toContain(Buffer.from('SERIAL-0000-FAKE').toString('hex'));
    expect(c000127?.hex).not.toContain(Buffer.from('fake photographer').toString('hex'));
    expect(c000127?.hex).toContain(Buffer.from('ICC_PROFILE').toString('hex'));
    expect(c000127?.hex).toContain(Buffer.from('Adobe').toString('hex'));
    expect(receipt.counts.origin_bytes).toBe(
      (receipt.counts.portrait_bytes ?? 0) + (receipt.counts.metadata_bytes_removed ?? 0),
    );
    expect(receipt.counts.metadata_bytes_removed).toBeGreaterThan(0);
    // A rejected person stores nothing; a person with only the 1x file is stored without a 2x.
    expect(stored.some((r) => ['V000133', 'K000401', 'H001096'].includes(r.bioguide))).toBe(false);
    expect(stored.filter((r) => r.bioguide === 'A000375').map((r) => r.variant)).toEqual([
      '225x275',
    ]);
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
    expect(n?.n).toBe(9);
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
    expect(receipt.counts).toMatchObject({ rejected_too_large: 1, people_with_portrait: 4 });
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
    expect((await photoRows()).length).toBe(9);

    const override = await testRuntime(handle, {
      shrinkGuard: { ...DEFAULT_SHRINK_GUARD, minBaseline: 2, allow: true },
    });
    const applied = await ingestFixture(override, 'member-photos', thin);
    expect(applied.status).toBe('succeeded');
    expect(applied.note).toMatch(/shrink guard overridden/);
    expect(applied.counts.stale_portraits_deleted).toBe(6);
    expect((await photoRows()).length).toBe(3);
  });
});

describe('member-photos ingest over HTTP (fake server, no network)', () => {
  const TREE_SHA = 'c'.repeat(40);
  const gitBlobSha = (bytes: Uint8Array) =>
    createHash('sha1').update(`blob ${bytes.length} `).update(bytes).digest('hex');

  /** The repository listing as GitHub states it: real size and git blob SHA-1 of each fixture. */
  const TREE = async (names: string[], extra: object = {}) => ({
    truncated: false,
    sha: TREE_SHA,
    tree: await Promise.all(
      names.map(async (path) => {
        const bytes = await readFile(join(PHOTOS, path.replace('congress/', '')));
        return { path, type: 'blob', size: bytes.length, sha: gitBlobSha(bytes) };
      }),
    ),
    ...extra,
  });

  /** A fake GitHub API + Pages: serves the committed fixture files, with ETag/304. */
  function fakeServer(options: {
    tree: object;
    missing?: Set<string>;
    oversize?: Set<string>;
    /** Same size, one byte flipped: the listing's git blob SHA-1 no longer matches. */
    corrupt?: Set<string>;
  }) {
    const log: { url: string; conditional: boolean; authorization?: string }[] = [];
    const deps: HttpDeps = {
      fetch: async (input, init) => {
        const url = String(input);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        log.push({
          url,
          conditional: 'if-none-match' in headers,
          authorization: headers.authorization,
        });
        if (url === TREE_URL) return Response.json(options.tree);
        const match = /\/congress\/(225x275|450x550)\/([A-Z]\d{6})\.jpg$/.exec(url);
        if (!match) return new Response('nope', { status: 404 });
        const path = `${match[1]}/${match[2]}.jpg`;
        if (options.missing?.has(path)) return new Response('missing', { status: 404 });
        if (options.oversize?.has(path)) {
          return new Response(Buffer.alloc(3 * 1024 * 1024, 1), { status: 200 });
        }
        const bytes = await readFile(join(PHOTOS, match[1] ?? '', `${match[2]}.jpg`));
        if (options.corrupt?.has(path))
          bytes[bytes.length - 3] = (bytes[bytes.length - 3] ?? 0) ^ 1;
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
      tree: await TREE([...complete, 'congress/225x275/A000375.jpg']),
    });
    const rt = await testRuntime(handle, { http: server.deps });
    await ingestFixture(rt, 'congress-legislators');
    const receipt = await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt);
    expect(receipt.status).toBe('succeeded');
    // Scope: B000546 (last term ended in 1790) and Z999999 (unknown) are never requested;
    // A000375 has only the 225x275 file and is requested without a 2x; "original" never is.
    const imageUrls = server.log.map((l) => l.url).filter((u) => u !== TREE_URL);
    expect(imageUrls.sort()).toEqual(
      [
        ...['C000127', 'N000147', 'B001282'].flatMap((id) => [
          `https://unitedstates.github.io/images/congress/225x275/${id}.jpg`,
          `https://unitedstates.github.io/images/congress/450x550/${id}.jpg`,
        ]),
        'https://unitedstates.github.io/images/congress/225x275/A000375.jpg',
      ].sort(),
    );
    expect(receipt.counts).toMatchObject({
      portraits: 7,
      people_with_portrait: 4,
      people_without_450: 1,
    });
    // The upstream tree id is in the receipt, and every file was verified against its blob SHA-1.
    expect(receipt.note).toBe(
      `unitedstates/images gh-pages tree ${TREE_SHA}; 7 files verified against their git blob SHA-1`,
    );

    // The run's evidence is retained in its own directory, named by its locator.
    const locator = receipt.snapshotLocator ?? '';
    expect(locator.startsWith(`member-photos/${new Date().toISOString().slice(0, 10)}/`)).toBe(
      true,
    );
    const manifest = JSON.parse(
      await readFile(join(rt.rawRoot, ...locator.split('/'), 'manifest.json'), 'utf8'),
    ) as {
      source: string;
      note?: string;
      files: { fileName: string; sha256: string; bytes: number; from: string }[];
    };
    expect(manifest.source).toBe('member-photos');
    expect(manifest.note).toContain(TREE_SHA);
    expect(manifest.files).toHaveLength(7);
    for (const file of manifest.files) {
      expect(file.sha256).toBe(sha(await readFile(join(PHOTOS, file.fileName))));
      expect(file.from).toMatch(/^https:\/\/unitedstates\.github\.io\/images\/congress\//);
    }

    server.log.length = 0;
    const again = await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt);
    expect(again).toMatchObject({ runId: receipt.runId, deduplicated: true });
    const images = server.log.filter((l) => l.url !== TREE_URL);
    expect(images).toHaveLength(7);
    expect(images.every((l) => l.conditional)).toBe(true);
  });

  it('refuses a download whose git blob SHA-1 differs from the listing, loading nothing', async () => {
    const server = fakeServer({
      tree: await TREE(complete),
      corrupt: new Set(['450x550/N000147.jpg']),
    });
    const rt = await testRuntime(handle, { http: server.deps });
    await ingestFixture(rt, 'congress-legislators');
    const receipt = await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt);
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/N000147\.jpg: the body .* does not match the listing/);
    expect(await photoRows()).toEqual([]);
    // The bad body never reached its final name: a failed run retains no evidence (its
    // staging directory is removed), and the body was never cached for a later 304.
    const dir = join(rt.rawRoot, 'member-photos');
    const retained = (await readdir(dir, { withFileTypes: true })).filter(
      (e) => e.isDirectory() && !e.name.startsWith('.'),
    );
    expect(retained).toEqual([]);
    expect(await readdir(join(dir, '.staging')).catch(() => [])).toEqual([]);
    const cache = JSON.parse(
      await readFile(join(dir, 'http-cache.json'), 'utf8').catch(() => '{}'),
    ) as Record<string, unknown>;
    expect(Object.keys(cache).filter((url) => url.endsWith('/450x550/N000147.jpg'))).toEqual([]);
  });

  it('does not offer a cached copy that no longer matches the listing for a 304', async () => {
    const first = fakeServer({ tree: await TREE(complete) });
    const rt = await testRuntime(handle, { http: first.deps });
    await ingestFixture(rt, 'congress-legislators');
    expect((await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt)).status).toBe(
      'succeeded',
    );
    // Damage the cached copy (the one a 304 would reuse) but keep its size: the sha256 check
    // and the listing's SHA-1 both catch it, so the file is fetched in full again.
    const cacheIndex = JSON.parse(
      await readFile(join(rt.rawRoot, 'member-photos', 'http-cache.json'), 'utf8'),
    ) as Record<string, { path: string }>;
    const cachedUrl = Object.keys(cacheIndex).find((u) => u.endsWith('/225x275/C000127.jpg'));
    const cached = cacheIndex[cachedUrl ?? '']?.path ?? '';
    expect(cached).not.toBe('');
    const damaged = await readFile(cached);
    damaged[damaged.length - 3] = (damaged[damaged.length - 3] ?? 0) ^ 1;
    await writeFile(cached, damaged);
    const second = fakeServer({ tree: await TREE(complete) });
    rt.http = second.deps;
    await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt);
    const refetched = second.log.find((l) => l.url.endsWith('/225x275/C000127.jpg'));
    expect(refetched?.conditional).toBe(false);
    expect(await readFile(cached)).toEqual(await readFile(join(PHOTOS, '225x275', 'C000127.jpg')));
  });

  it('skips people who have only the 450x550 file (no 1x image)', async () => {
    const tree = (await TREE(complete)) as { tree: object[] };
    tree.tree.push({
      path: 'congress/450x550/A000375.jpg',
      type: 'blob',
      size: 10,
      sha: 'd'.repeat(40),
    });
    const server = fakeServer({ tree });
    const rt = await testRuntime(handle, { http: server.deps });
    await ingestFixture(rt, 'congress-legislators');
    await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt);
    expect(server.log.some((l) => l.url.includes('A000375'))).toBe(false);
  });

  it('sends GITHUB_TOKEN only to the listing request, and never logs or records it', async () => {
    const secret = 'ghp_test_token_value_123';
    process.env.GITHUB_TOKEN = secret;
    try {
      const server = fakeServer({ tree: await TREE(complete) });
      const lines: string[] = [];
      const logger = pino({ level: 'trace' }, { write: (line: string) => void lines.push(line) });
      const rt = await testRuntime(handle, { http: server.deps, logger });
      await ingestFixture(rt, 'congress-legislators');
      const receipt = await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt);
      expect(receipt.status).toBe('succeeded');
      const listing = server.log.find((l) => l.url === TREE_URL);
      expect(listing?.authorization).toBe(`Bearer ${secret}`);
      expect(server.log.filter((l) => l.url !== TREE_URL && l.authorization)).toEqual([]);
      expect(JSON.stringify(receipt)).not.toContain(secret);
      expect(lines.join('\n')).not.toContain(secret);
    } finally {
      delete process.env.GITHUB_TOKEN;
    }
  });

  it('fails the run, loading nothing, when a listed file is missing upstream (404)', async () => {
    const server = fakeServer({
      tree: await TREE(complete),
      missing: new Set(['450x550/N000147.jpg']),
    });
    const rt = await testRuntime(handle, { http: server.deps });
    await ingestFixture(rt, 'congress-legislators');
    const receipt = await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt);
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/N000147\.jpg failed: HTTP 404/);
    expect(await photoRows()).toEqual([]);
  });

  it('enforces the per-file download cap on a body larger than any real portrait', async () => {
    const server = fakeServer({
      tree: await TREE(complete),
      oversize: new Set(['225x275/B001282.jpg']),
    });
    const rt = await testRuntime(handle, { http: server.deps });
    await ingestFixture(rt, 'congress-legislators');
    const receipt = await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt);
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/exceeds the 2097152-byte download cap/);
    expect(await photoRows()).toEqual([]);
  });

  it('refuses a listing whose selected files exceed the total cap, before any download', async () => {
    const server = fakeServer({ tree: await TREE(complete) });
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
    const server = fakeServer({ tree: await TREE(complete, { truncated: true }) });
    const rt = await testRuntime(handle, { http: server.deps });
    await ingestFixture(rt, 'congress-legislators');
    const receipt = await runIngest({ source: 'member-photos', scope: { kind: 'all' } }, rt);
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/listing is truncated/);
  });
});
