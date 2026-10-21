import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { registry } from '../src/capabilities/registry';
import { dispatch } from '../src/dispatch';
import { REGISTRATION_NOTICE } from '../src/races/notice';
import { placeRow } from '../src/races/placement';
import { expectCapabilityError, useSeededDb } from './helpers';

const db = useSeededDb();

interface Added {
  id: string;
  name: string | null;
  office: 'H' | 'S';
  state: string;
  district: number | null;
  committee?: string | null;
  person?: string | null;
}

/** Inserts candidate rows that copy the seed's provenance; returns a cleanup. */
async function addCandidates(rows: Added[]) {
  const { db: raw } = db.handle();
  for (const r of rows) {
    await raw.execute(sql`
      insert into candidate (fec_candidate_id, cycle, name_as_filed, party_code, election_year, office,
        state, district, incumbency, status, principal_committee_id, person_id,
        source_id, source_key, ingest_run_id, retrieved_at)
      select ${r.id}, 2026, ${r.name}, 'IND', 2026, ${r.office}, ${r.state}, ${r.district}, 'C',
        'C', ${r.committee ?? null},
        (select id from person where slug = ${r.person ?? null}),
        source_id, 'cn:' || ${r.id}, ingest_run_id, retrieved_at
      from candidate limit 1`);
  }
  return async () => {
    for (const r of rows) {
      await raw.execute(sql`delete from candidate where fec_candidate_id = ${r.id}`);
    }
  };
}

describe('placeRow', () => {
  const existing = new Set(['zv-senate', 'zv-1', 'zv-2', 'ak-al']);

  it('puts every House row of a single-seat state at large, whatever district was typed', () => {
    for (const district of [null, 0, 1, 2]) {
      expect(placeRow({ office: 'H', state: 'AK', district }, existing)).toMatchObject({
        seatKey: 'ak-al',
      });
    }
  });

  it('keeps a blank or "00" district in a state with several as filed, with no seat', () => {
    expect(placeRow({ office: 'H', state: 'ZV', district: null }, existing)).toEqual({
      seat: null,
      chamber: 'house',
      state: 'ZV',
      districtAsFiled: null,
    });
    expect(placeRow({ office: 'H', state: 'ZV', district: 0 }, existing)).toMatchObject({
      seat: null,
      districtAsFiled: 0,
    });
  });

  it('gives a district that does not exist no seat, and a Senate row where nobody sits none', () => {
    expect(placeRow({ office: 'H', state: 'ZV', district: 71 }, existing)).toMatchObject({
      seat: null,
      districtAsFiled: 71,
    });
    expect(placeRow({ office: 'S', state: 'AK', district: null }, existing)).toMatchObject({
      seat: null,
      chamber: 'senate',
    });
    expect(placeRow({ office: 'S', state: 'ZV', district: null }, existing)).toMatchObject({
      seatKey: 'zv-senate',
    });
  });
});

describe('seats that exist (DECISIONS A79)', () => {
  it('places single-seat states at large and keeps the rest as filed, with no seat page', async () => {
    const { db: raw } = db.handle();
    // A single-seat place: its delegate has a term at AK district 0 (a former member borrowed
    // for the test and removed afterwards).
    await raw.execute(sql`
      insert into office (level, chamber, state, district) values ('federal', 'house', 'AK', 0)
      on conflict do nothing`);
    await raw.execute(sql`
      insert into term (person_id, office_id, party, start_date, end_date, source_id, source_key, ingest_run_id, retrieved_at)
      select (select id from person where slug = 'philippa-wrenfield'),
        (select id from office where chamber = 'house' and state = 'AK' and district = 0),
        'Independent', '2025-01-03', '2027-01-03', source_id, 'term:test-ak', ingest_run_id, retrieved_at
      from term limit 1`);
    const cleanup = await addCandidates([
      { id: 'H6AK00001', name: 'ALASKA, BLANK', office: 'H', state: 'AK', district: null },
      { id: 'H6AK00002', name: 'ALASKA, ZERO', office: 'H', state: 'AK', district: 0 },
      { id: 'H6AK00003', name: 'ALASKA, ONE', office: 'H', state: 'AK', district: 1 },
      { id: 'H6ZV00071', name: 'NOSUCH, SEVENTYONE', office: 'H', state: 'ZV', district: 71 },
      { id: 'H6ZV00072', name: 'NOSUCH, BLANK', office: 'H', state: 'ZV', district: null },
      { id: 'H6ZV00073', name: 'NOSUCH, ZERO', office: 'H', state: 'ZV', district: 0 },
      { id: 'S6AK00001', name: 'NOSENATE, ALASKA', office: 'S', state: 'AK', district: null },
    ]);
    try {
      const list = await dispatch('races.list', {}, db.ctx());
      expect(list.items.find((i) => i.seat.key === 'ak-al')).toMatchObject({
        registrations: 3,
        seatUp: true,
      });
      expect(list.items.some((i) => i.seat.key === 'zv-71' || i.seat.key === 'zv-al')).toBe(false);
      const unplaced = new Map(
        list.unplaced.map((u) => [`${u.chamber}|${u.state}|${u.districtAsFiled}`, u]),
      );
      expect([...unplaced.keys()].sort()).toEqual([
        'house|ZV|0',
        'house|ZV|71',
        'house|ZV|null',
        'senate|AK|null',
      ]);
      expect(unplaced.get('house|ZV|71')).toMatchObject({
        registrations: 1,
        candidates: [{ fecCandidateId: 'H6ZV00071', displayName: 'Seventyone Nosuch' }],
      });
      expect(list.totals.unplacedRegistrations).toBe(4);
      expect(list.totals.registrations).toBe(16 + 3);

      const race = await dispatch('races.get', { seat: 'ak-al' }, db.ctx());
      expect(race.candidates.map((c) => c.nameAsFiled)).toEqual([
        'ALASKA, BLANK',
        'ALASKA, ONE',
        'ALASKA, ZERO',
      ]);
      for (const seat of ['zv-71', 'zv-al', 'ak-senate', 'zy-9']) {
        await expectCapabilityError(dispatch('races.get', { seat }, db.ctx()), 'not_found');
      }
      // The state filter keeps its own unplaced rows and no others.
      const zv = await dispatch('races.list', { state: 'ZV' }, db.ctx());
      expect(zv.unplaced.map((u) => u.state)).toEqual(['ZV', 'ZV', 'ZV']);
    } finally {
      await cleanup();
      await raw.execute(sql`delete from term where source_key = 'term:test-ak'`);
    }
  });
});

describe('duplicate registrations and shared committees', () => {
  it('links a person’s other registration, the committee they share and same-name rows', async () => {
    const { db: raw } = db.handle();
    await raw.execute(
      sql`update candidate set principal_committee_id = 'C99009999' where fec_candidate_id = 'S4ZV00002'`,
    );
    const cleanup = await addCandidates([
      {
        id: 'H4ZV09999',
        name: 'BRINDLEMOOR, BLAIR',
        office: 'H',
        state: 'ZV',
        district: 1,
        committee: 'C99009999',
        person: 'blair-brindlemoor',
      },
      { id: 'H6ZV01090', name: 'TWIN, PAT', office: 'H', state: 'ZV', district: 1 },
      { id: 'H6ZV01091', name: 'TWIN, PAT', office: 'H', state: 'ZV', district: 1 },
    ]);
    try {
      const senate = await dispatch('races.get', { seat: 'zv-senate' }, db.ctx());
      const blair = senate.candidates.find((c) => c.fecCandidateId === 'S4ZV00002');
      expect(blair?.alsoRegisteredFor).toEqual([
        {
          fecCandidateId: 'H4ZV09999',
          seat: 'zv-1',
          chamber: 'house',
          state: 'ZV',
          sameCommittee: true,
        },
      ]);
      expect(blair?.sharedCommitteeWith).toEqual(['H4ZV09999']);

      const house = await dispatch('races.get', { seat: 'zv-1' }, db.ctx());
      const copy = house.candidates.find((c) => c.fecCandidateId === 'H4ZV09999');
      expect(copy?.alsoRegisteredFor).toMatchObject([
        { fecCandidateId: 'S4ZV00002', seat: 'zv-senate', sameCommittee: true },
      ]);
      const twins = house.candidates.filter((c) => c.nameAsFiled === 'TWIN, PAT');
      expect(twins.map((c) => c.sameNameAsFiledAs)).toEqual([['H6ZV01091'], ['H6ZV01090']]);
      expect(twins.every((c) => c.alsoRegisteredFor.length === 0)).toBe(true);
      // Each registration names the cn row it came from.
      expect(copy?.registration.sourceKey).toBe('cn:H4ZV09999');
    } finally {
      await cleanup();
      await raw.execute(
        sql`update candidate set principal_committee_id = null where fec_candidate_id = 'S4ZV00002'`,
      );
    }
  });

  it('shows a row with no name as null and sorts it last', async () => {
    const cleanup = await addCandidates([
      { id: 'H6ZV01095', name: null, office: 'H', state: 'ZV', district: 1 },
    ]);
    try {
      const race = await dispatch('races.get', { seat: 'zv-1' }, db.ctx());
      expect(race.candidates.at(-1)).toMatchObject({
        fecCandidateId: 'H6ZV01095',
        displayName: null,
        nameAsFiled: null,
      });
    } finally {
      await cleanup();
    }
  });
});

describe('notice and input checks', () => {
  it('carries the registration notice in both outputs and tool summaries', async () => {
    const list = await dispatch('races.list', {}, db.ctx());
    const race = await dispatch('races.get', { seat: 'zv-senate' }, db.ctx());
    expect(list.notice).toBe(REGISTRATION_NOTICE);
    expect(race.notice).toBe(REGISTRATION_NOTICE);
    expect(registry['races.list'].summary).toContain(REGISTRATION_NOTICE);
    expect(registry['races.get'].summary).toContain(REGISTRATION_NOTICE);
  });

  it('rejects cycles that are odd or out of range', async () => {
    for (const cycle of [2025, 1900, 2101]) {
      await expectCapabilityError(dispatch('races.list', { cycle }, db.ctx()), 'invalid_input');
      await expectCapabilityError(
        dispatch('races.get', { seat: 'zv-1', cycle }, db.ctx()),
        'invalid_input',
      );
    }
  });
});
