import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { expectCapabilityError, useSeededDb } from './helpers';

// The seed has 40 current members and 3 fictional former members (DECISIONS A30).
const db = useSeededDb();
const FORMER = ['cornelius-oakhurst', 'desmond-quillfeather', 'philippa-wrenfield'];

describe('member scope', () => {
  it('explore.table defaults to current members and can include former members', async () => {
    const current = await dispatch('explore.table', { limit: 100 }, db.ctx());
    expect(current.total).toBe(40);
    expect(current.rows.every((r) => r.isCurrent)).toBe(true);

    const all = await dispatch(
      'explore.table',
      { filters: { scope: 'all' }, limit: 100 },
      db.ctx(),
    );
    expect(all.total).toBe(43);
    const former = all.rows.filter((r) => !r.isCurrent).map((r) => r.slug);
    expect(former.sort()).toEqual(FORMER);
  });

  it('explore.facets counts both scopes and filters vocabularies by the requested one', async () => {
    const current = await dispatch('explore.facets', {}, db.ctx());
    expect(current).toMatchObject({
      scope: 'current',
      scopes: { current: 40, all: 43 },
      total: 40,
    });
    const all = await dispatch('explore.facets', { scope: 'all' }, db.ctx());
    expect(all.total).toBe(43);
    const independents = (f: typeof all) =>
      f.parties.find((p) => p.value === 'Independent')?.count ?? 0;
    expect(independents(all)).toBe(independents(current) + 1);
  });

  it('people.search finds former members by default, current members first', async () => {
    const result = await dispatch('people.search', { limit: 100 }, db.ctx());
    expect(result.total).toBe(43);
    const flags = result.items.map((i) => i.isCurrent);
    expect(flags.indexOf(false)).toBe(40);
    const oakhurst = await dispatch('people.search', { q: 'Oakhurst' }, db.ctx());
    expect(oakhurst.items).toEqual([
      expect.objectContaining({
        slug: 'cornelius-oakhurst',
        isCurrent: false,
        serviceStart: '1995-01-03',
        termEnd: '2009-01-03',
      }),
    ]);
    const currentOnly = await dispatch(
      'people.search',
      { q: 'Oakhurst', scope: 'current' },
      db.ctx(),
    );
    expect(currentOnly.total).toBe(0);
  });

  it('people.get labels a former member with years actually served', async () => {
    const result = await dispatch('people.get', { slug: 'cornelius-oakhurst' }, db.ctx());
    expect(result.card).toMatchObject({
      isCurrent: false,
      serviceStart: '1995-01-03',
      termEnd: '2009-01-03',
      tenureYears: 14,
      totalReceiptsCents: null,
    });
    // Resigned mid-term: the last term ends on the resignation date, not the scheduled end.
    const resigned = await dispatch('people.get', { slug: 'desmond-quillfeather' }, db.ctx());
    expect(resigned.card).toMatchObject({ isCurrent: false, termEnd: '2025-06-30' });
    expect(resigned.card.tenureYears).toBeCloseTo(6.5, 1);
  });

  it('people.compare accepts a former member next to current ones', async () => {
    const result = await dispatch(
      'people.compare',
      { slugs: ['avery-ashvale', 'philippa-wrenfield'] },
      db.ctx(),
    );
    expect(result.people.map((p) => p.isCurrent)).toEqual([true, false]);
  });

  it('rejects an unknown scope', async () => {
    await expectCapabilityError(
      dispatch('explore.table', { filters: { scope: 'former' } }, db.ctx()),
      'invalid_input',
    );
    await expectCapabilityError(
      dispatch('explore.facets', { scope: 'everyone' }, db.ctx()),
      'invalid_input',
    );
  });
});
