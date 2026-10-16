import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { expectCapabilityError, useSeededDb } from './helpers';

const db = useSeededDb();

describe('policy.areas@1', () => {
  it('lists policy areas by name with bill and rollcall counts', async () => {
    const result = await dispatch('policy.areas', {}, db.ctx());
    expect(result.items).toHaveLength(8);
    const names = result.items.map((a) => a.name);
    expect(names).toEqual([...names].sort());
    expect(result.items.find((a) => a.id === 'health')).toMatchObject({ billCount: 2 });
    expect(result.items.every((a) => a.rollcallCount >= a.billCount)).toBe(true);
  });

  it('rejects unexpected input (it takes no parameters, so there is no not_found case)', async () => {
    await expectCapabilityError(
      dispatch('policy.areas', { area: 'health' }, db.ctx()),
      'invalid_input',
    );
  });
});

describe('sources.status@1', () => {
  it('reports each source with its latest run receipt and coverage', async () => {
    const result = await dispatch('sources.status', {}, db.ctx());
    const seed = result.sources.find((s) => s.id === 'dev-seed');
    expect(seed?.lastRun?.status).toBe('succeeded');
    expect(seed?.lastSuccess?.id).toBe(seed?.lastRun?.id);
    expect(seed?.lastRun?.counts.people).toBe(40);
    const { coverage } = result.coverage.industryCoding;
    expect(coverage).toBeGreaterThan(0);
    expect(coverage).toBeLessThan(1);
    expect(result.readModelRefreshedAt).not.toBeNull();
  });

  it('rejects unexpected input (no not_found case: it takes no parameters)', async () => {
    await expectCapabilityError(dispatch('sources.status', null, db.ctx()), 'invalid_input');
  });
});
