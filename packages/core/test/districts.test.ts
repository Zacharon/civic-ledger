import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { expectCapabilityError, useSeededDb } from './helpers';

const db = useSeededDb();

describe('districts.shape@1', () => {
  it('returns the state outline and one numbered district with the vintage and as-of date', async () => {
    const shape = await dispatch('districts.shape', { state: 'ZV', district: 3 }, db.ctx());
    expect(shape).toMatchObject({
      state: 'ZV',
      stateName: 'Zevland',
      district: 3,
      scope: 'district',
      description: 'Map of Zevland with congressional district 3 highlighted',
      viewBox: '0 0 240 180',
      width: 240,
      height: 180,
      asOf: '2026-10-01',
    });
    expect(shape.statePath).toMatch(/^M[\d. L-]+Z$/);
    expect(shape.districtPath).toMatch(/^M[\d. L-]+Z$/);
    expect(shape.districtPath).not.toBe(shape.statePath);
    // The fictional seed says so in every field a caption is built from.
    expect(shape.vintage).toContain('fictional');
    expect(shape.publisher).toContain('fictional');
    expect(shape.caveat).toContain('2026-10-01');
    expect(shape.provenance).toMatchObject({ sourceId: 'dev-seed' });
    expect(shape.provenance.sourceKey).toBe('districtmap:ZV:3');
  });

  it('shows the whole state for a Senate seat (no district) and for an at-large seat (0)', async () => {
    const senate = await dispatch('districts.shape', { state: 'ZX' }, db.ctx());
    const atLarge = await dispatch('districts.shape', { state: 'ZX', district: 0 }, db.ctx());
    expect(senate).toMatchObject({ scope: 'state', district: null, districtPath: null });
    expect(senate.description).toBe('Map of Xanterra with the whole state highlighted');
    expect(atLarge).toMatchObject({ scope: 'state', district: 0, districtPath: null });
    expect(atLarge.statePath).toBe(senate.statePath);
    expect(atLarge.provenance.sourceKey).toBe('districtmap:ZX:state');
  });

  it('is not found for a state or district without a map', async () => {
    await expectCapabilityError(
      dispatch('districts.shape', { state: 'GA' }, db.ctx()),
      'not_found',
    );
    await expectCapabilityError(
      dispatch('districts.shape', { state: 'ZV', district: 6 }, db.ctx()),
      'not_found',
    );
  });

  it('rejects bad input', async () => {
    await expectCapabilityError(
      dispatch('districts.shape', { state: 'zv' }, db.ctx()),
      'invalid_input',
    );
    await expectCapabilityError(dispatch('districts.shape', {}, db.ctx()), 'invalid_input');
    await expectCapabilityError(
      dispatch('districts.shape', { state: 'ZV', district: -1 }, db.ctx()),
      'invalid_input',
    );
    await expectCapabilityError(
      dispatch('districts.shape', { state: 'ZV', district: 1, extra: true }, db.ctx()),
      'invalid_input',
    );
  });

  it('keeps every seeded path inside its viewBox', async () => {
    for (const state of ['ZV', 'ZW', 'ZX', 'ZY', 'ZZ']) {
      for (const district of [undefined, 1, 2, 3, 4, 5]) {
        const shape = await dispatch('districts.shape', { state, district }, db.ctx());
        for (const path of [shape.statePath, shape.districtPath]) {
          if (!path) continue;
          const numbers = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
          expect(numbers.length).toBeGreaterThan(6);
          numbers.forEach((n, i) => {
            expect(n).toBeGreaterThanOrEqual(0);
            expect(n).toBeLessThanOrEqual(i % 2 === 0 ? shape.width : shape.height);
          });
        }
      }
    }
  });
});
