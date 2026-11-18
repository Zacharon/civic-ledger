import { refreshPersonCard } from '@civic-ledger/db';
import { SEED_MID_CONGRESS_START } from '@civic-ledger/db/seed';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { buildMonths, congressStartYear, monthsBetween } from '../src/capabilities/attendance';
import { compareSeatParties } from '../src/capabilities/chamber';
import { dispatch } from '../src/dispatch';
import { expectCapabilityError, useSeededDb } from './helpers';

const db = useSeededDb();
const exec = (query: ReturnType<typeof sql>) => db.handle().db.execute(query);
const sum = (t: { yea: number; nay: number; present: number; notVoting: number }) =>
  t.yea + t.nay + t.present + t.notVoting;

describe('votes.list party breakdown', () => {
  it('has several parties per roll call, ordered by name, and every row sums to the total', async () => {
    const page = await dispatch('votes.list', { limit: 100 }, db.ctx());
    expect(page.items.length).toBeGreaterThan(10);
    for (const item of page.items) {
      expect(item.byParty.length).toBeGreaterThanOrEqual(2);
      const names = item.byParty.map((p) => p.party);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
      for (const key of ['yea', 'nay', 'present', 'notVoting'] as const) {
        expect(
          item.byParty.reduce((n, p) => n + p[key], 0),
          key,
        ).toBe(item.tally[key]);
      }
      expect(item.byParty.reduce((n, p) => n + sum(p), 0)).toBe(sum(item.tally));
    }
  });

  it('uses the party on the term in force at the vote date, not the current party', async () => {
    const slug = 'jules-kindlewood';
    const row = (await exec(sql`select p.id from person p where p.slug = ${slug}`)).rows[0] as
      | { id: number }
      | undefined;
    if (!row) throw new Error('missing seed member');
    const id = row.id;
    // A party switch: close the current term on 2025-09-01 and open a new Independent term.
    await exec(sql`
      insert into term (person_id, office_id, party, start_date, end_date, source_id, source_key, ingest_run_id, retrieved_at)
      select person_id, office_id, 'Switched Party', '2025-09-01', null, source_id, 'test:switch', ingest_run_id, retrieved_at
      from term where person_id = ${id} and end_date is null`);
    await exec(
      sql`update term set end_date = '2025-09-01' where person_id = ${id} and source_key <> 'test:switch'`,
    );
    try {
      const votes = await dispatch('votes.list', { slug, chamber: 'house', limit: 100 }, db.ctx());
      const before = votes.items.find((v) => v.rollcall.voteDate < '2025-09-01' && v.position);
      const after = votes.items.find((v) => v.rollcall.voteDate >= '2025-09-01' && v.position);
      expect(before?.byParty.map((p) => p.party)).toContain('Prairie Party');
      expect(before?.byParty.map((p) => p.party)).not.toContain('Switched Party');
      expect(after?.byParty.map((p) => p.party)).toContain('Switched Party');
      for (const item of votes.items)
        expect(item.byParty.reduce((n, p) => n + sum(p), 0)).toBe(sum(item.tally));
    } finally {
      await exec(sql`delete from term where source_key = 'test:switch'`);
      await exec(sql`update term set end_date = null where person_id = ${id}`);
    }
  });

  it('never double counts a member whose terms overlap, and shows a member with no earlier term as Unknown', async () => {
    await exec(sql`
      insert into term (person_id, office_id, party, start_date, end_date, source_id, source_key, ingest_run_id, retrieved_at)
      select t.person_id, t.office_id, 'Overlap Party', '2025-03-01', '2026-01-01', t.source_id, 'test:overlap', t.ingest_run_id, t.retrieved_at
      from term t join person p on p.id = t.person_id where p.slug = 'avery-ashvale' and t.end_date is null`);
    try {
      const before = await dispatch('votes.list', { limit: 100 }, db.ctx());
      for (const item of before.items) {
        expect(item.byParty.reduce((n, p) => n + sum(p), 0)).toBe(sum(item.tally));
      }
    } finally {
      await exec(sql`delete from term where source_key = 'test:overlap'`);
    }
    const [original] = (
      await exec(sql`
        select t.id, t.start_date::text as start_date from term t join person p on p.id = t.person_id
        where p.slug = 'jules-kindlewood' order by t.start_date desc limit 1`)
    ).rows as { id: number; start_date: string }[];
    if (!original) throw new Error('missing seed term');
    await exec(sql`update term set start_date = '2026-06-01' where id = ${original.id}`);
    try {
      const page = await dispatch('votes.list', { limit: 100 }, db.ctx());
      const unknown = page.items.filter((i) => i.byParty.some((p) => p.party === 'Unknown'));
      expect(unknown.length).toBeGreaterThan(0);
      for (const item of unknown) {
        expect(item.byParty.at(-1)?.party, 'Unknown sorts last').toBe('Unknown');
        expect(item.byParty.reduce((n, p) => n + sum(p), 0)).toBe(sum(item.tally));
      }
    } finally {
      await exec(
        sql`update term set start_date = ${original.start_date} where id = ${original.id}`,
      );
    }
  });
});

describe('votes.list party fallback for a late end date', () => {
  // A source can record a member's last day slightly before their last vote. That vote keeps
  // the term's party only within VOTE_DATE_GRACE_DAYS (2) of the recorded end; later votes are
  // unattributed ("Unknown"), still counted, never guessed (DECISIONS A98).
  it('keeps the party within 2 days of the recorded last day, and leaves later votes unattributed', async () => {
    const row = (
      await exec(
        sql`select t.id, t.end_date::text as end_date from term t join person p on p.id = t.person_id where p.slug = 'jules-kindlewood'`,
      )
    ).rows[0] as { id: number; end_date: string | null } | undefined;
    if (!row) throw new Error('missing seed term');
    // The seed member votes on 2025-08-09 (2 days after this end) and from 2025-09-10 on.
    await exec(sql`update term set end_date = '2025-08-07' where id = ${row.id}`);
    try {
      const page = await dispatch('votes.list', { slug: 'jules-kindlewood', limit: 100 }, db.ctx());
      const voted = page.items.filter((i) => i.position);
      const inWindow = voted.filter((i) => i.rollcall.voteDate === '2025-08-09');
      const after = voted.filter((i) => i.rollcall.voteDate > '2025-08-09');
      expect(inWindow.length).toBeGreaterThan(0);
      expect(after.length).toBeGreaterThan(0);
      for (const item of inWindow) {
        expect(item.byParty.map((p) => p.party)).not.toContain('Unknown');
        expect(item.byParty.map((p) => p.party)).toContain('Prairie Party');
      }
      for (const item of after) expect(item.byParty.map((p) => p.party)).toContain('Unknown');
      for (const item of voted) {
        expect(item.byParty.reduce((n, p) => n + sum(p), 0)).toBe(sum(item.tally));
      }
    } finally {
      await exec(sql`update term set end_date = ${row.end_date} where id = ${row.id}`);
    }
  });
});

describe('votes.attendance pure month logic', () => {
  it('counts months from January of the Congress to the through month', () => {
    expect(congressStartYear(119)).toBe(2025);
    expect(congressStartYear(1)).toBe(1789);
    expect(monthsBetween(119, '2025-03')).toEqual(['2025-01', '2025-02', '2025-03']);
    expect(monthsBetween(119, '2026-12')).toHaveLength(24);
  });

  it('keeps not yet serving, no votes held, no longer serving and no record distinct', () => {
    const months = monthsBetween(119, '2025-07');
    const counts = new Map([
      ['2025-04', { eligible: 5, missed: 1, present: 1, voted: 3 }],
      ['2025-05', { eligible: 2, missed: 0, present: 0, voted: 2 }],
    ]);
    const held = new Map([
      ['2025-02', 4],
      ['2025-04', 5],
      ['2025-05', 2],
      ['2025-07', 3],
    ]);
    const out = buildMonths({
      months,
      counts,
      held,
      terms: [{ startDate: '2025-04-10', endDate: '2025-06-20' }],
    });
    const status = Object.fromEntries(out.map((m) => [m.month, m.status]));
    expect(status).toEqual({
      '2025-01': 'not_yet_serving',
      '2025-02': 'not_yet_serving', // votes were held, but the member was not serving yet
      '2025-03': 'not_yet_serving',
      '2025-04': 'served',
      '2025-05': 'served',
      '2025-06': 'no_votes_held', // serving until the 20th, no votes held at all
      '2025-07': 'no_longer_serving',
    });
    const served = buildMonths({
      months: ['2025-08'],
      counts: new Map(),
      held: new Map([['2025-08', 6]]),
      terms: [{ startDate: '2025-01-03', endDate: null }],
    });
    expect(served[0]).toMatchObject({ status: 'no_record', rollcallsHeld: 6, eligible: 0 });
  });

  it('treats a gap between terms as not serving, and trusts recorded positions over term dates', () => {
    const out = buildMonths({
      months: ['2025-01', '2025-02', '2025-03'],
      counts: new Map([['2025-02', { eligible: 1, missed: 0, present: 0, voted: 1 }]]),
      held: new Map(),
      terms: [
        { startDate: '2025-01-03', endDate: '2025-01-31' },
        { startDate: '2025-03-01', endDate: null },
      ],
    });
    expect(out.map((m) => m.status)).toEqual(['no_votes_held', 'served', 'no_votes_held']);
  });
});

describe('votes.attendance@1', () => {
  it('matches the Explore eligible and missed figures for every member with votes', async () => {
    const people = await dispatch('people.search', { scope: 'all', limit: 100 }, db.ctx());
    let withVotes = 0;
    for (const { slug } of people.items) {
      const [attendance, profile] = await Promise.all([
        dispatch('votes.attendance', { slug }, db.ctx()),
        dispatch('people.get', { slug }, db.ctx()),
      ]);
      const { card } = profile;
      if (card.votesEligible === null) {
        expect(attendance.totals.eligible, slug).toBe(0);
        expect(attendance.months, slug).toEqual([]);
        expect(attendance.congress, slug).toBeNull();
        continue;
      }
      withVotes++;
      expect(attendance.totals.eligible, slug).toBe(card.votesEligible);
      expect(attendance.totals.missedRate, slug).toBe(card.missedVoteRate);
      const monthly = attendance.months.reduce((n, m) => n + m.eligible, 0);
      expect(monthly, slug).toBe(card.votesEligible);
      for (const m of attendance.months) {
        expect(m.voted + m.present + m.missed, `${slug} ${m.month}`).toBe(m.eligible);
        expect(m.status === 'served', `${slug} ${m.month}`).toBe(m.eligible > 0);
      }
      expect(attendance.provenance?.sourceId).toBe('dev-seed');
    }
    expect(withVotes).toBeGreaterThan(30);
  });

  it('marks months before a mid-Congress start as not yet serving and recess months as no votes held', async () => {
    const result = await dispatch('votes.attendance', { slug: 'jules-kindlewood' }, db.ctx());
    expect(result.congress).toBe(119);
    expect(result.chambers).toEqual(['house']);
    const byMonth = new Map(result.months.map((m) => [m.month, m]));
    expect(SEED_MID_CONGRESS_START).toBe('2025-06-10');
    // Votes were held in the House in February to May 2025, before this member was sworn in.
    for (const month of ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05']) {
      expect(byMonth.get(month)?.status, month).toBe('not_yet_serving');
    }
    expect(byMonth.get('2025-02')?.rollcallsHeld).toBeGreaterThan(0);
    // Serving, but the House held no votes in June or July 2025, nor in December.
    for (const month of ['2025-06', '2025-07', '2025-12', '2026-01']) {
      expect(byMonth.get(month), month).toMatchObject({
        status: 'no_votes_held',
        rollcallsHeld: 0,
      });
    }
    expect(byMonth.get('2025-08')?.status).toBe('served');
    expect(result.throughMonth).toBe(result.months.at(-1)?.month);
  });

  it('reads an explicit Congress, and returns empty results rather than errors when nothing exists', async () => {
    const explicit = await dispatch(
      'votes.attendance',
      { slug: 'avery-ashvale', congress: 119 },
      db.ctx(),
    );
    expect(explicit.months.length).toBeGreaterThan(12);
    const none = await dispatch(
      'votes.attendance',
      { slug: 'avery-ashvale', congress: 100 },
      db.ctx(),
    );
    expect(none).toMatchObject({ congress: 100, months: [], throughMonth: null });
    expect(none.totals).toEqual({ eligible: 0, missed: 0, present: 0, voted: 0, missedRate: null });
    const former = await dispatch('votes.attendance', { slug: 'cornelius-oakhurst' }, db.ctx());
    expect(former).toMatchObject({ congress: null, months: [] });
  });

  it('rejects unknown people and bad input', async () => {
    await expectCapabilityError(
      dispatch('votes.attendance', { slug: 'nobody-here' }, db.ctx()),
      'not_found',
    );
    await expectCapabilityError(dispatch('votes.attendance', {}, db.ctx()), 'invalid_input');
    await expectCapabilityError(
      dispatch('votes.attendance', { slug: 'a-b', congress: 0 }, db.ctx()),
      'invalid_input',
    );
  });
});

describe('chamber.composition pure ordering', () => {
  it('orders Democrat, Independent, Republican, then other parties alphabetically', () => {
    const shuffled = [
      'Republican',
      'Libertarian',
      'Independent',
      'Democrat',
      'Green',
      'Aardvark Party',
    ];
    expect(shuffled.toSorted(compareSeatParties)).toEqual([
      'Democrat',
      'Independent',
      'Republican',
      'Aardvark Party',
      'Green',
      'Libertarian',
    ]);
  });
});

describe('chamber.composition@1', () => {
  it('counts the partial seed roster without inventing vacancies', async () => {
    const result = await dispatch('chamber.composition', {}, db.ctx());
    const house = result.chambers.find((c) => c.chamber === 'house');
    const senate = result.chambers.find((c) => c.chamber === 'senate');
    expect(house?.seats).toBe(435);
    expect(senate?.seats).toBe(100);
    expect(house?.members).toBe(30);
    expect(senate?.members).toBe(10);
    // 30 of 435 is a partial load, not 405 empty seats.
    expect(house?.vacancies).toBeNull();
    expect(senate?.vacancies).toBeNull();
    expect(house?.nonVoting).toEqual({ total: 0, parties: [], jurisdictions: [] });
    const parties = (house?.voting ?? []).map((p) => p.party);
    expect(parties).toEqual(['Independent', 'Harbor Party', 'Prairie Party']);
    expect(result.provenance?.sourceId).toBe('dev-seed');
    expect(result.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('counts delegates apart from the 435, derives vacancies from a near-complete roster, and agrees with Explore', async () => {
    await exec(sql`
      insert into person (slug, full_name, first_name, last_name, source_id, source_key, ingest_run_id, retrieved_at)
      select 'roster-' || g, 'Roster Member ' || g, 'Roster', 'Member ' || g, 'dev-seed', 'test:roster:' || g,
        (select min(id) from ingest_run), now()
      from generate_series(1, 395 + 6 + 88) g`);
    await exec(sql`
      insert into office (level, chamber, state, district)
      select 'federal'::office_level, 'house'::chamber, 'ZR', g from generate_series(1, 395) g
      union all select 'federal'::office_level, 'house'::chamber, s, 0 from unnest(array['AS','DC','GU','MP','PR','VI']) s
      union all select 'federal'::office_level, 'senate'::chamber, chr(78 + g / 26) || chr(65 + g % 26), null::int from generate_series(0, 43) g
      on conflict do nothing`);
    // 395 more voting House members (425 in all), 6 delegates and 88 more senators (98 in all).
    const seat = (n: ReturnType<typeof sql>) => sql`
      case
        when ${n} <= 395 then (select id from office where chamber = 'house' and state = 'ZR' and district = ${n})
        when ${n} <= 401 then (select id from office where chamber = 'house' and district = 0
          and state = (array['AS','DC','GU','MP','PR','VI'])[${n} - 395])
        else (select id from office where chamber = 'senate' and state = chr(78 + ((${n} - 402) / 2) / 26) || chr(65 + ((${n} - 402) / 2) % 26))
      end`;
    await exec(sql`
      insert into term (person_id, office_id, party, start_date, end_date, source_id, source_key, ingest_run_id, retrieved_at)
      select p.id, ${seat(sql`n.n`)},
        (array['Democrat','Republican','Independent','Libertarian'])[1 + (n.n % 4)],
        '2025-01-03', null, 'dev-seed', 'test:roster-term:' || n.n, (select min(id) from ingest_run), now()
      from person p
      cross join lateral (select substring(p.slug from 8)::int as n) n
      where p.slug like 'roster-%'`);
    await refreshPersonCard(db.handle().db);

    const result = await dispatch('chamber.composition', {}, db.ctx());
    const house = result.chambers.find((c) => c.chamber === 'house');
    const senate = result.chambers.find((c) => c.chamber === 'senate');
    expect(house?.nonVoting.total).toBe(6);
    expect(house?.nonVoting.jurisdictions).toEqual(['AS', 'DC', 'GU', 'MP', 'PR', 'VI']);
    const votingTotal = house?.voting.reduce((n, p) => n + p.count, 0);
    expect(votingTotal).toBe(house?.members);
    expect(house?.vacancies).toBe(435 - (house?.members ?? 0));
    expect(house?.members).toBeGreaterThan(400);
    expect(house?.members).toBeLessThanOrEqual(435);
    expect(senate?.vacancies).toBe(100 - (senate?.members ?? 0));
    expect(house?.voting.map((p) => p.party)).toEqual([
      'Democrat',
      'Independent',
      'Republican',
      'Harbor Party',
      'Libertarian',
      'Prairie Party',
    ]);

    // Explore (current scope) counts every one of these members, voting or not.
    const facets = await dispatch('explore.facets', { scope: 'current' }, db.ctx());
    const chamberCount = (c: string) => facets.chambers.find((x) => x.value === c)?.count ?? 0;
    expect((house?.members ?? 0) + (house?.nonVoting.total ?? 0)).toBe(chamberCount('house'));
    expect(senate?.members).toBe(chamberCount('senate'));
  });
});
