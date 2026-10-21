import {
  type Db,
  districtMap,
  ingestRun,
  office,
  person,
  refreshPersonCard,
  term,
} from '@civic-ledger/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { congressOfDate, PATH_DATA_PATTERN } from '../src/capabilities/districts';
import { dispatch } from '../src/dispatch';
import { expectCapabilityError, useSeededDb } from './helpers';

const db = useSeededDb();
const HOUSE_ZV3 = 'emerson-elderquay'; // seeded current House member, ZV district 3
const SENATOR_ZV = 'avery-ashvale'; // seeded current Senator, ZV
const FORMER = 'cornelius-oakhurst'; // seeded former House member

afterEach(() => vi.useRealTimers());

/** A fictional member whose latest term has the given seat and dates. */
async function addMember(
  handle: Db,
  slug: string,
  seat: { chamber: 'house' | 'senate'; state: string; district: number | null },
  start: string,
  end: string | null,
) {
  const [run] = await handle.select({ id: ingestRun.id }).from(ingestRun).limit(1);
  const provenance = (key: string) => ({
    sourceId: 'dev-seed',
    sourceKey: key,
    ingestRunId: run?.id as number,
    retrievedAt: new Date('2026-10-01T00:00:00Z'),
  });
  const [p] = await handle
    .insert(person)
    .values({ slug, fullName: slug, firstName: 'Test', lastName: 'Member', ...provenance(slug) })
    .returning({ id: person.id });
  const [o] = await handle
    .insert(office)
    .values({ level: 'federal', ...seat })
    .onConflictDoUpdate({
      target: [office.level, office.chamber, office.state, office.district],
      set: { state: seat.state },
    })
    .returning({ id: office.id });
  await handle.insert(term).values({
    personId: p?.id as number,
    officeId: o?.id as number,
    party: 'Independent',
    startDate: start,
    endDate: end,
    ...provenance(`${slug}:term`),
  });
  await refreshPersonCard(handle);
}

describe('congressOfDate', () => {
  it('maps a date to the Congress sitting on it (each starts January 3 of an odd year)', () => {
    expect(congressOfDate('2025-01-03')).toBe(119);
    expect(congressOfDate('2025-04-02')).toBe(119); // a special-election term
    expect(congressOfDate('2026-12-31')).toBe(119);
    expect(congressOfDate('2027-01-02')).toBe(119);
    expect(congressOfDate('2027-01-03')).toBe(120);
    expect(congressOfDate('2025-01-02')).toBe(118);
    expect(congressOfDate('2024-11-05')).toBe(118);
    expect(congressOfDate('2029-01-03')).toBe(121);
  });
});

describe('districts.shape@1 by place', () => {
  it('returns the outline and one numbered district with Congress, vintage, as-of date and provenance', async () => {
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
      congress: 119,
      asOf: '2026-10-01',
    });
    expect(shape.statePath).toMatch(PATH_DATA_PATTERN);
    expect(shape.districtPath).toMatch(PATH_DATA_PATTERN);
    expect(shape.districtPath).not.toBe(shape.statePath);
    // The fictional seed says so in every field a caption is built from.
    expect(shape.vintage).toContain('fictional');
    expect(shape.publisher).toContain('fictional');
    expect(shape.caveat).toBe(
      'Shows district lines as of October 1, 2026. A state that redrew its districts after that date is not reflected.',
    );
    // Both the drawn district's and the outline's sources are cited.
    expect(shape.provenance).toMatchObject({ sourceId: 'dev-seed', sourceKey: 'districtmap:ZV:3' });
    expect(shape.stateProvenance).toMatchObject({
      sourceId: 'dev-seed',
      sourceKey: 'districtmap:ZV:state',
    });
  });

  it('shows the whole state when no district is given', async () => {
    const senate = await dispatch('districts.shape', { state: 'ZX' }, db.ctx());
    expect(senate).toMatchObject({ scope: 'state', district: null, districtPath: null });
    expect(senate.description).toBe('Map of Xanterra with the whole state highlighted');
    expect(senate.provenance).toEqual(senate.stateProvenance);
  });

  it('refuses district 0 (at-large) for a state that has numbered districts', async () => {
    const error = await expectCapabilityError(
      dispatch('districts.shape', { state: 'ZX', district: 0 }, db.ctx()),
      'not_found',
    );
    expect(error.message).toContain('has numbered districts');
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

  it('rejects bad input: lower case, empty, negative, unknown keys, and slug mixed with place', async () => {
    for (const input of [
      { state: 'zv' },
      {},
      { district: 3 },
      { state: 'ZV', district: -1 },
      { state: 'ZV', district: 1, extra: true },
      { slug: HOUSE_ZV3, state: 'ZV' },
      { slug: HOUSE_ZV3, district: 3 },
    ]) {
      await expectCapabilityError(dispatch('districts.shape', input, db.ctx()), 'invalid_input');
    }
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

  it('refuses to return stored path data that is not plain drawing commands', async () => {
    const original = (
      await db
        .handle()
        .db.select()
        .from(districtMap)
        .where(and(eq(districtMap.state, 'ZW'), isNull(districtMap.district)))
        .limit(1)
    )[0];
    await db
      .handle()
      .db.update(districtMap)
      .set({ path: 'M0 0L10 10" onload="alert(1)Z' })
      .where(eq(districtMap.id, original?.id as number));
    try {
      await expect(dispatch('districts.shape', { state: 'ZW' }, db.ctx())).rejects.toThrow();
    } finally {
      await db
        .handle()
        .db.update(districtMap)
        .set({ path: original?.path as string })
        .where(eq(districtMap.id, original?.id as number));
    }
  });
});

describe('districts.shape@1 by member', () => {
  it('maps a current House member to the district they hold', async () => {
    const shape = await dispatch('districts.shape', { slug: HOUSE_ZV3 }, db.ctx());
    expect(shape).toMatchObject({ state: 'ZV', district: 3, scope: 'district', congress: 119 });
    const byPlace = await dispatch('districts.shape', { state: 'ZV', district: 3 }, db.ctx());
    expect(shape).toEqual(byPlace);
  });

  it('maps a current Senator to the whole state', async () => {
    const shape = await dispatch('districts.shape', { slug: SENATOR_ZV }, db.ctx());
    expect(shape).toMatchObject({
      state: 'ZV',
      district: null,
      scope: 'state',
      districtPath: null,
    });
  });

  it('draws nothing for a former member, an unknown member, or a House seat without a district', async () => {
    const former = await expectCapabilityError(
      dispatch('districts.shape', { slug: FORMER }, db.ctx()),
      'not_found',
    );
    expect(former.message).toContain('current members only');
    await expectCapabilityError(
      dispatch('districts.shape', { slug: 'nobody-by-this-name' }, db.ctx()),
      'not_found',
    );
    await addMember(
      db.handle().db,
      'zz-no-district',
      { chamber: 'house', state: 'ZV', district: null },
      '2025-01-03',
      '2027-01-03',
    );
    const unknown = await expectCapabilityError(
      dispatch('districts.shape', { slug: 'zz-no-district' }, db.ctx()),
      'not_found',
    );
    expect(unknown.message).toContain('no district number');
  });

  it('draws no House district for a member whose term began in a later Congress (2027-01-03)', async () => {
    await addMember(
      db.handle().db,
      'zz-120th-house',
      { chamber: 'house', state: 'ZV', district: 3 },
      '2027-01-03',
      '2029-01-03',
    );
    await addMember(
      db.handle().db,
      'zz-120th-senate',
      { chamber: 'senate', state: 'ZV', district: null },
      '2027-01-03',
      '2033-01-03',
    );
    await addMember(
      db.handle().db,
      'zz-ended-2027',
      { chamber: 'house', state: 'ZV', district: 2 },
      '2025-01-03',
      '2027-01-03',
    );
    // The 120th Congress is seated: today is after 2027-01-03, so these members are current.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-02-01T12:00:00Z'));
    const [clock] = (await db.handle().db.execute(sql`select current_date::text as d`))
      .rows as Array<{ d: string }>;
    expect(clock?.d).toBe('2027-02-01');

    const house = await expectCapabilityError(
      dispatch('districts.shape', { slug: 'zz-120th-house' }, db.ctx()),
      'not_found',
    );
    expect(house.message).toContain('120th Congress');
    expect(house.message).toContain('119th');
    // A Senate seat is the whole state: unaffected by redistricting.
    const senate = await dispatch('districts.shape', { slug: 'zz-120th-senate' }, db.ctx());
    expect(senate).toMatchObject({ scope: 'state', districtPath: null });
    // A member whose term ended 2027-01-03 is former by then: no map either.
    await expectCapabilityError(
      dispatch('districts.shape', { slug: 'zz-ended-2027' }, db.ctx()),
      'not_found',
    );
  });

  it('draws a House member whose term began in the boundary Congress, even mid-term', async () => {
    await addMember(
      db.handle().db,
      'zz-special-election',
      { chamber: 'house', state: 'ZV', district: 2 },
      '2025-04-02',
      '2027-01-03',
    );
    const shape = await dispatch('districts.shape', { slug: 'zz-special-election' }, db.ctx());
    expect(shape).toMatchObject({ district: 2, scope: 'district' });
  });
});
