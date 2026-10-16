import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { expectCapabilityError, useSeededDb } from './helpers';

const db = useSeededDb();

describe('explore.facets@1', () => {
  it('lists the chambers, states and parties present in person_card, with counts', async () => {
    const facets = await dispatch('explore.facets', {}, db.ctx());
    const table = await dispatch('explore.table', { limit: 100 }, db.ctx());

    expect(facets.total).toBe(table.total);
    const sum = (items: { count: number }[]) => items.reduce((n, i) => n + i.count, 0);
    expect(sum(facets.chambers)).toBe(table.rows.filter((r) => r.chamber).length);
    expect(sum(facets.states)).toBe(table.rows.filter((r) => r.state).length);
    expect(sum(facets.parties)).toBe(table.rows.filter((r) => r.party).length);

    const states = facets.states.map((s) => s.value);
    expect(states).toEqual(
      [...new Set(table.rows.flatMap((r) => (r.state ? [r.state] : [])))].sort(),
    );
    expect(facets.chambers.map((c) => c.value)).toEqual(['house', 'senate']);
  });

  it('every facet value filters explore.table to exactly its count', async () => {
    const facets = await dispatch('explore.facets', {}, db.ctx());
    for (const party of facets.parties) {
      const result = await dispatch('explore.table', { filters: { party: party.value } }, db.ctx());
      expect(result.total).toBe(party.count);
    }
  });

  it('rejects unexpected input', async () => {
    await expectCapabilityError(
      dispatch('explore.facets', { state: 'ZV' }, db.ctx()),
      'invalid_input',
    );
  });
});
