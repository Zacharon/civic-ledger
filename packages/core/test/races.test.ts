import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { parseSeatKey, seatKey } from '../src/races/seat';
import { expectCapabilityError, useSeededDb } from './helpers';

const db = useSeededDb();

describe('seat keys', () => {
  it('round-trips senate, district and at-large seats', () => {
    const cases = [
      ['ga-senate', { chamber: 'senate', state: 'GA', district: null }],
      ['ga-10', { chamber: 'house', state: 'GA', district: 10 }],
      ['ak-al', { chamber: 'house', state: 'AK', district: 0 }],
    ] as const;
    for (const [key, seat] of cases) {
      expect(parseSeatKey(key)).toEqual(seat);
      expect(seatKey(seat)).toBe(key);
    }
  });

  it('rejects keys that are not canonical', () => {
    for (const key of ['ga-01', 'ga-0', 'ga-00', 'GA-10', 'ga-senator', 'georgia-10', 'ga10']) {
      expect(parseSeatKey(key), key).toBeNull();
    }
  });
});

describe('races.list@1', () => {
  it('lists the seats of the latest cycle with registration, active and money counts', async () => {
    const result = await dispatch('races.list', {}, db.ctx());
    expect(result.cycle).toBe(2026);
    expect(result.seatsUpOn).toBe('2027-01-03');
    const byKey = new Map(result.items.map((i) => [i.seat.key, i]));
    expect(byKey.get('zv-senate')).toMatchObject({
      seat: { chamber: 'senate', state: 'ZV', district: null },
      seatUp: true,
      incumbents: [{ slug: 'blair-brindlemoor', party: 'Prairie Party' }],
      registrations: 5,
      activeCandidates: 4,
      candidatesWithMoneyReports: 3,
    });
    expect(byKey.get('zz-3')).toMatchObject({
      seat: { chamber: 'house', state: 'ZZ', district: 3 },
      seatUp: true,
      incumbents: [{ slug: 'kai-lanternfield' }],
      registrations: 3,
      candidatesWithMoneyReports: 2,
    });
    expect(byKey.get('zw-3')).toMatchObject({
      registrations: 2,
      activeCandidates: 1,
      candidatesWithMoneyReports: 0,
    });
    // A seat that is up but has no registration is still listed, with explicit zeros.
    expect(byKey.get('zv-2')).toMatchObject({
      seatUp: true,
      registrations: 0,
      activeCandidates: 0,
      candidatesWithMoneyReports: 0,
    });
    expect(result.totals.registrations).toBe(16);
    expect(result.totals.candidatesWithMoneyReports).toBe(10);
    expect(result.totals.candidatesWithoutMoneyReports).toBe(6);
    expect(result.totals.seatsWithoutRegistrations).toBeGreaterThan(0);
  });

  it('orders seats by state, Senate first, then district, never by money', async () => {
    const result = await dispatch('races.list', { state: 'ZV' }, db.ctx());
    const keys = result.items.map((i) => i.seat.key);
    expect(keys.slice(0, 3)).toEqual(['zv-senate', 'zv-1', 'zv-2']);
    expect(keys).toEqual(
      [...keys].sort((a, b) => {
        const rank = (k: string) =>
          k.endsWith('-senate') ? -1 : k.endsWith('-al') ? 0 : Number(k.split('-')[1]);
        return rank(a) - rank(b);
      }),
    );
  });

  it('filters by chamber and state', async () => {
    const senate = await dispatch('races.list', { chamber: 'senate' }, db.ctx());
    expect(senate.items.every((i) => i.seat.chamber === 'senate')).toBe(true);
    const zw = await dispatch('races.list', { state: 'ZW', chamber: 'house' }, db.ctx());
    expect(zw.items.every((i) => i.seat.state === 'ZW' && i.seat.chamber === 'house')).toBe(true);
    const none = await dispatch('races.list', { cycle: 2024 }, db.ctx());
    expect(none.items.every((i) => i.registrations === 0)).toBe(true);
  });

  it('narrows to the seats of one member: registered there, or sitting there with the seat up', async () => {
    const keys = async (person: string) =>
      (await dispatch('races.list', { person }, db.ctx())).items.map((i) => i.seat.key);
    expect(await keys('blair-brindlemoor')).toEqual(['zv-senate']);
    expect(await keys('cameron-corrowind')).toEqual(['zv-1']);
    // A former member who registered again is found through the matched FEC id.
    expect(await keys('cornelius-oakhurst')).toEqual(['zv-1']);
    // Sitting, but the term ends in 2029 and no registration: no 2026 race.
    expect(await keys('avery-ashvale')).toEqual([]);
    const counted = await dispatch('races.list', { person: 'blair-brindlemoor' }, db.ctx());
    expect(counted.items[0]?.registrations).toBe(5);
    await expectCapabilityError(
      dispatch('races.list', { person: 'nobody-by-this-name' }, db.ctx()),
      'not_found',
    );
  });

  it('counts an appointed senator whose term ends at the November special election', async () => {
    const { db: raw } = db.handle();
    const who = sql`(select id from person where slug = 'jordan-juniperfield')`;
    await raw.execute(
      sql`update term set end_date = '2026-11-03' where person_id = ${who} and end_date is null`,
    );
    try {
      const race = await dispatch('races.get', { seat: 'zw-senate' }, db.ctx());
      expect(race.seatUp).toBe(true);
      expect(race.incumbents).toMatchObject([
        { slug: 'jordan-juniperfield', termEnd: '2026-11-03' },
      ]);
      // A term that ends before the election season is not a seat up in the cycle.
      await raw.execute(
        sql`update term set end_date = '2026-10-25' where person_id = ${who} and end_date = '2026-11-03'`,
      );
      const early = await dispatch('races.get', { seat: 'zw-senate' }, db.ctx());
      expect(early.seatUp).toBe(false);
    } finally {
      await raw.execute(
        sql`update term set end_date = null where person_id = ${who} and end_date in ('2026-11-03', '2026-10-25')`,
      );
    }
    const back = await dispatch('races.get', { seat: 'zw-senate' }, db.ctx());
    expect(back.incumbents[0]?.termEnd).toBe('2027-01-03');
  });

  it('carries the provenance of each source behind the counts', async () => {
    const { sources } = await dispatch('races.list', {}, db.ctx());
    expect(sources.candidates?.sourceKey).toMatch(/^cn:/);
    expect(sources.moneyReports?.sourceKey).toMatch(/^weball:/);
    expect(sources.outsideSpending?.sourceKey).toMatch(/^ie:/);
    expect(sources.terms?.sourceKey).toMatch(/^term:/);
    expect(sources.candidates?.retrievedAt).toMatch(/^2026-/);
  });

  it('decides "seat up" from the term end date when there is one', async () => {
    const { db: raw } = db.handle();
    // Blair Brindlemoor's term now ends in 2029: the seat is no longer up in 2026, but the
    // five FEC registrations stay.
    await raw.execute(sql`
      update term set end_date = '2029-01-03'
      where person_id = (select id from person where slug = 'blair-brindlemoor')
        and end_date is null`);
    try {
      const moved = await dispatch('races.get', { seat: 'zv-senate' }, db.ctx());
      expect(moved.seatUp).toBe(false);
      expect(moved.incumbents).toEqual([]);
      expect(moved.counts.registrations).toBe(5);
    } finally {
      await raw.execute(sql`
        update term set end_date = null
        where person_id = (select id from person where slug = 'blair-brindlemoor')
          and end_date = '2029-01-03'`);
    }
    const back = await dispatch('races.get', { seat: 'zv-senate' }, db.ctx());
    expect(back.seatUp).toBe(true);
  });
});

describe('races.get@1', () => {
  it('returns every registered candidate, alphabetical by name as filed by default', async () => {
    const race = await dispatch('races.get', { seat: 'zv-senate' }, db.ctx());
    expect(race.sort).toBe('name');
    expect(race.candidates.map((c) => c.nameAsFiled)).toEqual([
      'BRINDLEMOOR, BLAIR',
      'MCCRAE, DESMOND "DEZ"',
      "O'LEARY-VANCE, PRIYA MS.",
      'QUILLON, MARGUERITE ANNE DR.',
      'TOWNSEND-FELL, ROWAN',
    ]);
    expect(race.counts).toEqual({
      registrations: 5,
      activeCandidates: 4,
      withMoneyReports: 3,
      withoutMoneyReports: 2,
    });
    expect(race.seatUp).toBe(true);
    expect(race.senateSeatsUp).toBe(1);
    expect(race.incumbents.map((i) => i.slug)).toEqual(['blair-brindlemoor']);
  });

  it('uses the person name when matched and a readable name when not, keeping both', async () => {
    const race = await dispatch('races.get', { seat: 'zv-senate' }, db.ctx());
    const by = new Map(race.candidates.map((c) => [c.fecCandidateId, c]));
    expect(by.get('S4ZV00002')).toMatchObject({
      displayName: 'Blair Brindlemoor',
      nameAsFiled: 'BRINDLEMOOR, BLAIR',
      person: { slug: 'blair-brindlemoor', fullName: 'Blair Brindlemoor' },
      incumbency: 'I',
      incumbencyLabel: 'Incumbent',
      status: 'C',
      statusLabel: 'Statutory candidate',
    });
    expect(by.get('S6ZV00002')).toMatchObject({
      displayName: 'Dr. Marguerite Anne Quillon',
      nameAsFiled: 'QUILLON, MARGUERITE ANNE DR.',
      person: null,
      party: { code: 'IND', name: 'Independent' },
      incumbencyLabel: 'Challenger',
      fecUrl: 'https://www.fec.gov/data/candidate/S6ZV00002/',
    });
    expect(by.get('S6ZV00003')?.displayName).toBe('Desmond "Dez" McCrae');
    expect(by.get('S6ZV00004')).toMatchObject({
      displayName: "Priya O'Leary-Vance",
      status: 'N',
      statusLabel: 'Not yet a statutory candidate',
    });
    // Unknown party codes are shown as filed.
    expect(by.get('S4ZV00002')?.party).toEqual({ code: 'PRA', name: null });
  });

  it('reports money as filed, including negative cash and a missing report', async () => {
    const race = await dispatch('races.get', { seat: 'zv-senate' }, db.ctx());
    const by = new Map(race.candidates.map((c) => [c.fecCandidateId, c]));
    expect(by.get('S6ZV00002')?.money).toMatchObject({
      totalReceiptsCents: 31_045_000,
      cashOnHandCents: -1_200_000,
      coverageEndDate: '2026-09-30',
      provenance: { sourceKey: 'weball:S6ZV00002:2026' },
    });
    expect(by.get('S6ZV00003')?.money).toBeNull();
    expect(by.get('S6ZV00004')?.money).toBeNull();
  });

  it('keeps outside money for candidates with no person row, from the same rows as money.summary', async () => {
    const race = await dispatch('races.get', { seat: 'zv-senate' }, db.ctx());
    const by = new Map(race.candidates.map((c) => [c.fecCandidateId, c]));
    expect(by.get('S6ZV00001')?.person).toBeNull();
    expect(by.get('S6ZV00001')?.outsideSpending).toEqual({
      supportCents: 40_000_000,
      opposeCents: 7_500_000,
      expenditures: 2,
    });
    expect(by.get('S6ZV00003')?.outsideSpending).toEqual({
      supportCents: 0,
      opposeCents: 0,
      expenditures: 0,
    });
    // For a matched candidate the race view and the member's money view add up the same rows.
    const money = await dispatch(
      'money.summary',
      { slug: 'blair-brindlemoor', cycle: 2026 },
      db.ctx(),
    );
    expect(by.get('S4ZV00002')?.outsideSpending).toEqual({
      supportCents: money.outsideSpending.supportCents,
      opposeCents: money.outsideSpending.opposeCents,
      expenditures: money.outsideSpending.itemCount,
    });
  });

  it('sorts by receipts only when asked, with missing reports last', async () => {
    const race = await dispatch('races.get', { seat: 'zv-senate', sort: 'receipts' }, db.ctx());
    expect(race.sort).toBe('receipts');
    expect(race.candidates.map((c) => c.fecCandidateId)).toEqual([
      'S4ZV00002',
      'S6ZV00001',
      'S6ZV00002',
      'S6ZV00003',
      'S6ZV00004',
    ]);
  });

  it('handles open seats and matched challengers', async () => {
    const open = await dispatch('races.get', { seat: 'zz-3' }, db.ctx());
    expect(open.seat).toEqual({ key: 'zz-3', chamber: 'house', state: 'ZZ', district: 3 });
    // An open seat: the sitting member is not registered, every candidate is FEC "Open seat".
    expect(open.seatUp).toBe(true);
    expect(open.incumbents.map((i) => i.slug)).toEqual(['kai-lanternfield']);
    expect(open.candidates.some((c) => c.person?.slug === 'kai-lanternfield')).toBe(false);
    expect(open.senateSeatsUp).toBeNull();
    expect(open.candidates.every((c) => c.incumbencyLabel === 'Open seat')).toBe(true);

    const district = await dispatch('races.get', { seat: 'zv-1' }, db.ctx());
    const oakhurst = district.candidates.find((c) => c.fecCandidateId === 'H6ZV01003');
    expect(oakhurst).toMatchObject({
      displayName: 'Cornelius Oakhurst',
      person: { slug: 'cornelius-oakhurst' },
      incumbencyLabel: 'Challenger',
      money: null,
    });
    expect(district.incumbents.map((i) => i.slug)).toEqual(['cameron-corrowind']);
  });

  it('shows a seat that is up even when nobody has registered', async () => {
    const race = await dispatch('races.get', { seat: 'zv-2' }, db.ctx());
    expect(race.candidates).toEqual([]);
    expect(race.counts.registrations).toBe(0);
    expect(race.seatUp).toBe(true);
  });

  it('answers not_found for a seat with no registration and no member up, and invalid_input for bad keys', async () => {
    await expectCapabilityError(dispatch('races.get', { seat: 'zy-al' }, db.ctx()), 'not_found');
    await expectCapabilityError(dispatch('races.get', { seat: 'zy-9' }, db.ctx()), 'not_found');
    await expectCapabilityError(dispatch('races.get', { seat: 'ZV-1' }, db.ctx()), 'invalid_input');
    await expectCapabilityError(
      dispatch('races.get', { seat: 'zv-01' }, db.ctx()),
      'invalid_input',
    );
    await expectCapabilityError(
      dispatch('races.get', { seat: 'zv-1', sort: 'ideology' }, db.ctx()),
      'invalid_input',
    );
    await expectCapabilityError(dispatch('races.get', {}, db.ctx()), 'invalid_input');
  });
});
