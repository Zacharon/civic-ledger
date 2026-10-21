import { createHash } from 'node:crypto';
import { hasSeedPortrait } from '@civic-ledger/db/seed';
import { describe, expect, it } from 'vitest';
import { buildSeedData } from '../../db/src/seed/fixtures';
import { PORTRAIT_CREDIT, portraitPath } from '../src/capabilities/portraits';
import { registry } from '../src/capabilities/registry';
import { dispatch } from '../src/dispatch';
import { expectCapabilityError, useSeededDb } from './helpers';

const db = useSeededDb();
const people = buildSeedData().people;
const withPortrait = people.find((_, index) => hasSeedPortrait(index));
const without = people.find((_, index) => !hasSeedPortrait(index));

describe('people.get@1 portrait', () => {
  it('states portrait facts, credit and provenance for a member who has one', async () => {
    if (!withPortrait) throw new Error('seed has no portrait');
    const { portrait } = await dispatch('people.get', { slug: withPortrait.slug }, db.ctx());
    expect(portrait).toMatchObject({
      width: 225,
      height: 275,
      credit: PORTRAIT_CREDIT,
      sourceUrl: expect.stringMatching(/^https:\/\/example\.org\/dev-seed\/portraits\/225x275\//),
      provenance: { sourceId: 'dev-seed' },
    });
    expect(portrait?.asOf).toMatch(/^2026-10-01T/);
    expect(portrait?.variants.map((v) => [v.size, v.width, v.height])).toEqual([
      [225, 225, 275],
      [450, 450, 550],
    ]);
    expect(portrait?.url).toBe(
      portraitPath(withPortrait.slug, 225, portrait?.variants[0]?.sha256 ?? ''),
    );
    expect(portrait?.url).toMatch(/^\/people\/[a-z-]+\/portrait\?size=225&v=[0-9a-f]{12}$/);
  });

  it('is null (not an empty object) for a member without one', async () => {
    if (!without) throw new Error('seed has no member without a portrait');
    const result = await dispatch('people.get', { slug: without.slug }, db.ctx());
    expect(result.portrait).toBeNull();
  });
});

describe('people.portrait@1', () => {
  it('is a public binary read capability', () => {
    expect(registry['people.portrait']).toMatchObject({
      audience: 'public',
      kind: 'read',
      transport: 'binary',
    });
  });

  it('returns JPEG bytes whose sha256 and length match the stored facts', async () => {
    if (!withPortrait) throw new Error('seed has no portrait');
    for (const size of [225, 450] as const) {
      const result = await dispatch('people.portrait', { slug: withPortrait.slug, size }, db.ctx());
      expect(result.contentType).toBe('image/jpeg');
      expect(result.width).toBe(size);
      expect(result.height).toBe(size === 225 ? 275 : 550);
      expect([...result.bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
      expect(result.byteLength).toBe(result.bytes.length);
      expect(createHash('sha256').update(result.bytes).digest('hex')).toBe(result.sha256);
    }
  });

  it('defaults to 225 and agrees with people.get on the cache key', async () => {
    if (!withPortrait) throw new Error('seed has no portrait');
    const [image, profile] = await Promise.all([
      dispatch('people.portrait', { slug: withPortrait.slug }, db.ctx()),
      dispatch('people.get', { slug: withPortrait.slug }, db.ctx()),
    ]);
    expect(image.size).toBe(225);
    expect(profile.portrait?.variants[0]?.sha256).toBe(image.sha256);
  });

  it('accepts a cache key without letting it choose a file', async () => {
    if (!withPortrait) throw new Error('seed has no portrait');
    const plain = await dispatch('people.portrait', { slug: withPortrait.slug }, db.ctx());
    const keyed = await dispatch(
      'people.portrait',
      { slug: withPortrait.slug, v: 'deadbeefdeadbeef' },
      db.ctx(),
    );
    expect(keyed.sha256).toBe(plain.sha256);
  });

  it('is not_found for an unknown slug and for a member without a portrait', async () => {
    await expectCapabilityError(
      dispatch('people.portrait', { slug: 'nobody-here' }, db.ctx()),
      'not_found',
    );
    if (!without) throw new Error('seed has no member without a portrait');
    await expectCapabilityError(
      dispatch('people.portrait', { slug: without.slug }, db.ctx()),
      'not_found',
    );
  });

  it('rejects unsupported sizes, malformed keys and unknown parameters', async () => {
    if (!withPortrait) throw new Error('seed has no portrait');
    const slug = withPortrait.slug;
    for (const bad of [{ size: 300 }, { size: '225' }, { v: 'XYZ' }, { extra: 1 }]) {
      await expectCapabilityError(
        dispatch('people.portrait', { slug, ...bad }, db.ctx()),
        'invalid_input',
      );
    }
  });
});
