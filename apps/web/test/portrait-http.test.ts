import { describe, expect, it } from 'vitest';
import { mediaCacheControl } from '../src/server/api/media';
import { seededStack } from './stack';

/**
 * `/api/v1/people.portrait` (and the web route `/people/<slug>/portrait`, which forwards to it)
 * serve the stored bytes with an ETag equal to their sha256, nosniff and a cache policy that
 * only becomes immutable for a matching cache-busting key.
 */
const stack = seededStack();

async function seededPortrait() {
  const { direct } = stack();
  const people = (await direct('people.search', { limit: 100 })) as {
    items: Array<{ slug: string }>;
  };
  for (const { slug } of people.items) {
    const { portrait } = (await direct('people.get', { slug })) as {
      portrait: { variants: Array<{ size: number; sha256: string }> } | null;
    };
    if (portrait) return { slug, sha256: portrait.variants[0]?.sha256 ?? '' };
  }
  throw new Error('seed has no portrait');
}

describe('portrait file over HTTP', () => {
  it('sends a JPEG with its sha256 as a strong ETag, nosniff and a length', async () => {
    const { slug, sha256 } = await seededPortrait();
    const res = await stack().http('people.portrait', { slug, size: 225 });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('etag')).toBe(`"${sha256}"`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(res.headers.get('content-length')).toBe(String(bytes.length));
    expect([...bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it('answers 304 with no body when If-None-Match matches, and 200 when it does not', async () => {
    const { slug, sha256 } = await seededPortrait();
    const hit = await stack().http(
      'people.portrait',
      { slug },
      { headers: { 'if-none-match': `"${sha256}"` } },
    );
    expect(hit.status).toBe(304);
    expect(await hit.text()).toBe('');
    expect(hit.headers.get('etag')).toBe(`"${sha256}"`);
    const miss = await stack().http(
      'people.portrait',
      { slug },
      { headers: { 'if-none-match': '"something-else"' } },
    );
    expect(miss.status).toBe(200);
  });

  it('is immutable only for the cache key of the bytes actually sent', async () => {
    const { slug, sha256 } = await seededPortrait();
    const keyed = await stack().http('people.portrait', { slug, v: sha256.slice(0, 12) });
    expect(keyed.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    for (const input of [{ slug }, { slug, v: 'deadbeefdeadbeef' }]) {
      const res = await stack().http('people.portrait', input);
      expect(res.status, JSON.stringify(input)).toBe(200);
      expect(res.headers.get('cache-control')).toBe(
        'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
      );
    }
    // Too short to identify the bytes: refused as invalid input rather than trusted.
    expect((await stack().http('people.portrait', { slug, v: sha256.slice(0, 7) })).status).toBe(
      400,
    );
  });

  it('serves nothing for an unknown member, a bad size or a stray parameter', async () => {
    const { http } = stack();
    const unknown = await http('people.portrait', { slug: 'nobody-by-this-name' });
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('content-type')).toContain('application/json');
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('not_found');
    expect((await http('people.portrait', { slug: 'x', size: 300 })).status).toBe(400);
    expect((await http('people.portrait', { slug: 'x', extra: 1 })).status).toBe(400);
  });

  it('answers HEAD without a body', async () => {
    const { slug, sha256 } = await seededPortrait();
    const res = await stack().http('people.portrait', { slug }, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe(`"${sha256}"`);
    expect(await res.text()).toBe('');
  });
});

describe('mediaCacheControl', () => {
  const sha = 'a'.repeat(64);
  it('needs a key of at least 8 hex characters that prefixes the sha256', () => {
    expect(mediaCacheControl(sha, 'a'.repeat(8))).toContain('immutable');
    expect(mediaCacheControl(sha, 'a'.repeat(7))).not.toContain('immutable');
    expect(mediaCacheControl(sha, 'b'.repeat(12))).not.toContain('immutable');
    expect(mediaCacheControl(sha, undefined)).not.toContain('immutable');
  });
});
