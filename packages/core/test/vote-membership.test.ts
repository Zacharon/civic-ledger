import { refreshPersonCard } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { useSeededDb } from './helpers';

/**
 * T-C (evidence-trust 2026-10-19): vote-time membership. Fixture people in the fictional
 * state ZQ, two House roll calls (117th Congress) and one Senate roll call (119th), all in
 * a test-only policy area:
 *
 * - Sam serves in the House throughout; voted on R9001, no stored record on R9002.
 * - Morgan moved House -> Senate in 2023; voted on both House roll calls and the Senate one.
 * - Sky changed party (Alpha -> Beta) on 2022-01-01, after both House roll calls.
 * - Olive has two overlapping House terms (Alpha from 2021-01-03, Beta from 2021-02-01).
 * - Lee's House term starts 2021-05-01: not serving on R9001 (March), voted on R9002.
 *
 * Source totals: R9001 4 yea / 0 nay (matches the stored positions), R9002 2 yea / 2 nay
 * (stored positions give 1 yea / 2 nay), R9003 1 yea / 0 nay.
 */
const db = useSeededDb();
const exec = (query: ReturnType<typeof sql>) => db.handle().db.execute(query);
const AREA = 'zz-vote-membership';
const PROV = sql`'dev-seed', 'test:t-c', 1, now()`;

const PEOPLE = {
  sam: 'tc-serving-sam',
  morgan: 'tc-mover-morgan',
  sky: 'tc-switcher-sky',
  olive: 'tc-overlap-olive',
  lee: 'tc-late-lee',
} as const;
type Who = keyof typeof PEOPLE;

const TERMS: Array<[Who, 'house' | 'senate', string, string, string | null]> = [
  ['sam', 'house', 'Alpha Party', '2021-01-03', null],
  ['morgan', 'house', 'Beta Party', '2021-01-03', '2023-01-03'],
  ['morgan', 'senate', 'Beta Party', '2023-01-03', null],
  ['sky', 'house', 'Alpha Party', '2021-01-03', '2022-01-01'],
  ['sky', 'house', 'Beta Party', '2022-01-01', null],
  ['olive', 'house', 'Alpha Party', '2021-01-03', '2023-01-03'],
  ['olive', 'house', 'Beta Party', '2021-02-01', '2023-01-03'],
  ['lee', 'house', 'Beta Party', '2021-05-01', null],
];

const ROLLCALLS: Array<[number, 'house' | 'senate', number, string, number, number]> = [
  // number, chamber, congress, date, source yea, source nay
  [97001, 'house', 117, '2021-03-01', 4, 0],
  [97002, 'house', 117, '2021-06-01', 2, 2],
  [97003, 'senate', 119, '2025-03-01', 1, 0],
];

const POSITIONS: Array<[Who, number, 'yea' | 'nay']> = [
  ['sam', 97001, 'yea'],
  ['morgan', 97001, 'yea'],
  ['morgan', 97002, 'nay'],
  ['morgan', 97003, 'yea'],
  ['sky', 97001, 'yea'],
  ['sky', 97002, 'nay'],
  ['olive', 97001, 'yea'],
  ['lee', 97002, 'yea'],
];

beforeAll(async () => {
  await exec(sql`insert into policy_area (id, name) values (${AREA}, 'Vote membership test')`);
  for (const chamber of ['house', 'senate'] as const) {
    await exec(sql`
      insert into office (level, chamber, state, district)
      values ('federal', ${chamber}::chamber, 'ZQ', ${chamber === 'house' ? 1 : null})`);
  }
  for (const [who, slug] of Object.entries(PEOPLE)) {
    const name = slug.split('-').slice(1).join(' ');
    await exec(sql`
      insert into person (slug, full_name, first_name, last_name, source_id, source_key,
        ingest_run_id, retrieved_at)
      values (${slug}, ${name}, ${who}, ${name.split(' ')[1] ?? who}, ${PROV})`);
  }
  for (const [who, chamber, party, start, end] of TERMS) {
    await exec(sql`
      insert into term (person_id, office_id, party, start_date, end_date, source_id, source_key,
        ingest_run_id, retrieved_at)
      select p.id, o.id, ${party}, ${start}, ${end}, ${PROV}
      from person p, office o
      where p.slug = ${PEOPLE[who]} and o.state = 'ZQ' and o.chamber = ${chamber}::chamber`);
  }
  for (const congress of [117, 119]) {
    await exec(sql`
      insert into bill (congress, bill_type, number, title, url, source_id, source_key,
        ingest_run_id, retrieved_at)
      values (${congress}, 'hr', 9901, 'Vote membership test bill (fictional)',
        'https://example.org/tc', ${PROV})`);
    await exec(sql`
      insert into bill_policy_area (bill_id, policy_area_id, source_id, source_key,
        ingest_run_id, retrieved_at)
      select id, ${AREA}, ${PROV} from bill where congress = ${congress} and number = 9901`);
  }
  for (const [number, chamber, congress, date, yea, nay] of ROLLCALLS) {
    await exec(sql`
      insert into rollcall (congress, chamber, number, vote_date, question, result, yea_count,
        nay_count, source_id, source_key, ingest_run_id, retrieved_at)
      values (${congress}, ${chamber}::chamber, ${number}, ${date}, 'On Passage', 'Passed',
        ${yea}, ${nay}, ${PROV})`);
    await exec(sql`
      insert into rollcall_bill (rollcall_id, bill_id, source_id, source_key, ingest_run_id,
        retrieved_at)
      select r.id, b.id, ${PROV} from rollcall r, bill b
      where r.number = ${number} and r.chamber = ${chamber}::chamber and r.congress = ${congress}
        and b.congress = ${congress} and b.number = 9901`);
  }
  for (const [who, number, position] of POSITIONS) {
    await exec(sql`
      insert into vote_position (rollcall_id, person_id, position, source_id, source_key,
        ingest_run_id, retrieved_at)
      select r.id, p.id, ${position}::vote_position_value, ${PROV}
      from rollcall r, person p where r.number = ${number} and p.slug = ${PEOPLE[who]}`);
  }
  await refreshPersonCard(db.handle().db);
});

const houseRules = [97001, 97002].map((number) => ({
  target: { kind: 'rollcall' as const, congress: 117, chamber: 'house' as const, number },
  alignedPosition: 'yea' as const,
}));
const framework = { title: 'T-C house roll calls', rules: houseRules };
const evaluate = (people: Record<string, unknown>) =>
  dispatch('frameworks.evaluate', { framework, people, limit: 600 }, db.ctx());
const statesOf = (result: Awaited<ReturnType<typeof evaluate>>, who: Who) => {
  const row = result.results.find((r) => r.person.slug === PEOPLE[who]);
  if (!row) throw new Error(`${who} is not in the result`);
  // Read through `unknown` so the red run (fields absent at base) fails on values, not types.
  const record = row as unknown as {
    rollcallStates?: Array<{ ruleIndex: number; state: string; partyAtVote: string | null }>;
  };
  return record.rollcallStates;
};
const houseVotes = async () => {
  const result = await dispatch(
    'votes.list',
    { policyArea: AREA, chamber: 'house', limit: 10 },
    db.ctx(),
  );
  const byNumber = new Map(result.items.map((i) => [i.rollcall.number, i]));
  return (n: number) => {
    const item = byNumber.get(n);
    if (!item) throw new Error(`rollcall ${n} missing`);
    return item as typeof item & Record<string, unknown>;
  };
};

describe('vote-time membership (T-C)', () => {
  it('1: a serving member with no stored record reads "unavailable", not non-membership', async () => {
    const result = await evaluate({ slugs: Object.values(PEOPLE) });
    expect(statesOf(result, 'sam')?.map((s) => s.state)).toEqual(['yea', 'unavailable']);
    // Lee's only term starts after R9001: confirmed not serving in the House then.
    expect(statesOf(result, 'lee')?.map((s) => s.state)).toEqual(['not_serving', 'yea']);
  });

  it('2: a House -> Senate mover keeps historical House votes on the vote-time basis', async () => {
    // v1 default: "people currently in this chamber" still excludes the mover.
    const current = await evaluate({ chamber: 'house' });
    expect(current.results.map((r) => r.person.slug)).not.toContain(PEOPLE.morgan);

    const atVote = await evaluate({ chamber: 'house', basis: 'at_vote' });
    const morgan = atVote.results.find((r) => r.person.slug === PEOPLE.morgan);
    expect(morgan?.votes.map((v) => v.position)).toEqual(['yea', 'nay']);
    expect(statesOf(atVote, 'morgan')?.map((s) => s.state)).toEqual(['yea', 'nay']);
    expect(atVote.results.map((r) => r.person.slug).sort()).toEqual(Object.values(PEOPLE).sort());
  });

  it('3: a party changer is grouped by the party held on the vote date', async () => {
    const item = await houseVotes();
    expect(item(97001).byParty).toEqual([
      { party: 'Alpha Party', yea: 2, nay: 0, present: 0, notVoting: 0 },
      { party: 'Beta Party', yea: 2, nay: 0, present: 0, notVoting: 0 },
    ]);
    expect(item(97002).byParty).toEqual([
      { party: 'Alpha Party', yea: 0, nay: 1, present: 0, notVoting: 0 },
      { party: 'Beta Party', yea: 1, nay: 1, present: 0, notVoting: 0 },
    ]);

    const result = await evaluate({ slugs: [PEOPLE.sky] });
    expect(result.results[0]?.person.party).toBe('Beta Party'); // current-party metadata
    expect(statesOf(result, 'sky')?.map((s) => s.partyAtVote)).toEqual([
      'Alpha Party',
      'Alpha Party',
    ]);
    // A party filter on the vote-time basis selects votes cast as an Alpha member.
    const alpha = await evaluate({ party: 'Alpha Party', basis: 'at_vote' });
    expect(alpha.results.map((r) => r.person.slug)).toContain(PEOPLE.sky);
    const currentAlpha = await evaluate({ party: 'Alpha Party' });
    expect(currentAlpha.results.map((r) => r.person.slug)).not.toContain(PEOPLE.sky);
  });

  it('4: two overlapping terms and one yea count one yea and flag the ambiguity', async () => {
    const item = await houseVotes();
    expect(item(97001).tally).toEqual({ yea: 4, nay: 0, present: 0, notVoting: 0 });
    expect(item(97001).ambiguousTermPositions).toBe(1);
    expect(item(97002).ambiguousTermPositions).toBe(0);
    const result = await evaluate({ slugs: [PEOPLE.olive] });
    // Deterministic: the covering term with the latest start date.
    expect(statesOf(result, 'olive')?.[0]).toMatchObject({
      state: 'yea',
      partyAtVote: 'Beta Party',
      ambiguousTerm: true,
    });
  });

  it('5: reconstructed tallies are reported beside the source totals', async () => {
    const item = await houseVotes();
    expect(item(97001).sourceTally).toEqual({ yea: 4, nay: 0 });
    expect(item(97001).tallyCheck).toEqual({
      status: 'matches_source',
      yeaDifference: 0,
      nayDifference: 0,
    });
    expect(item(97002).tally).toMatchObject({ yea: 1, nay: 2 });
    expect(item(97002).sourceTally).toEqual({ yea: 2, nay: 2 });
    expect(item(97002).tallyCheck).toEqual({
      status: 'differs_from_source',
      yeaDifference: -1,
      nayDifference: 0,
    });
  });

  it('6: every state value the API can return is one documented enum', async () => {
    const core = (await import('../src/index')) as Record<string, unknown>;
    expect(core.MEMBER_VOTE_STATES).toEqual([
      'yea',
      'nay',
      'present',
      'not_voting',
      'not_serving',
      'unavailable',
    ]);
    const result = await evaluate({ slugs: Object.values(PEOPLE), basis: 'at_vote' });
    const seen = new Set(result.results.flatMap((r) => statesOf(result, slugKey(r.person.slug))));
    for (const s of seen) expect(core.MEMBER_VOTE_STATES).toContain(s?.state);
  });
});

function slugKey(slug: string): Who {
  const entry = Object.entries(PEOPLE).find(([, s]) => s === slug);
  if (!entry) throw new Error(`unknown slug ${slug}`);
  return entry[0] as Who;
}

describe('v1 compatibility on the seed (T-C)', () => {
  it('without filters both bases score the same people and votes; states agree with votes', async () => {
    const list = await dispatch('frameworks.list', {}, db.ctx());
    for (const f of list.items) {
      const run = (people: Record<string, unknown>) =>
        dispatch('frameworks.evaluate', { framework: f.spec, people, limit: 600 }, db.ctx());
      const [current, atVote] = await Promise.all([run({}), run({ basis: 'at_vote' })]);
      expect(current.peopleBasis).toBe('current');
      expect(atVote.peopleBasis).toBe('at_vote');
      const strip = (r: typeof current) =>
        r.results.map(({ person, aligned, considered, notCounted, votes }) => ({
          slug: person.slug,
          aligned,
          considered,
          notCounted,
          votes,
        }));
      expect(strip(atVote)).toEqual(strip(current));
      for (const r of current.results) {
        const recorded = r.rollcallStates.filter(
          (s) => s.state !== 'not_serving' && s.state !== 'unavailable',
        );
        expect(recorded.map((s) => [s.ruleIndex, s.rollcall, s.state])).toEqual(
          r.votes.map((v) => [v.ruleIndex, v.rollcall, v.position]),
        );
      }
    }
  });

  it('seed tallies reconcile with the seeded source totals', async () => {
    const result = await dispatch('votes.list', { limit: 100 }, db.ctx());
    const seed = result.items.filter((i) => i.policyArea?.id !== AREA);
    expect(seed.length).toBeGreaterThan(0);
    for (const item of seed) {
      expect(item.tallyCheck.status).toBe('matches_source');
      expect(item.sourceTally).toEqual({ yea: item.tally.yea, nay: item.tally.nay });
      expect(item.ambiguousTermPositions).toBe(0);
    }
  });
});
