import { refreshPersonCard } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { useSeededDb } from './helpers';

/**
 * One resolver for a member's party on a vote date (`voteTimeTerm`): `votes.list` byParty and
 * `frameworks.evaluate` rollcallStates must name the same party for every recorded vote.
 * Fictional state ZR, House seats ZR-1 and ZR-2 and the ZR Senate seat, 117th Congress:
 *
 * - Rowan: House term (Alpha, open) and a newer overlapping Senate term (Beta, from 2021-02-01).
 *   On a House roll call the House term is used; on a Senate one the Senate term.
 * - Quinn: House Alpha 2021-01-03 to 2021-06-01, then House Beta from 2021-06-01. The end date
 *   is exclusive: a vote on 2021-06-01 is under the new (Beta) term.
 * - Pat: House Alpha ending 2021-05-30 and no later term; a recorded vote on 2021-06-01, two
 *   days after the recorded end, is inside the grace window (VOTE_DATE_GRACE_DAYS = 2): Alpha.
 * - Drew: House Alpha ending 2021-05-29; a recorded vote on 2021-06-01, three days after, is
 *   outside the window: unattributed ("Unknown", partyAtVote null, no at_vote match).
 * - Sasha (the review's case): House Alpha ending 2021-06-30 (the day before the vote) and a
 *   Senate Beta term starting 2021-07-01; a House vote on 2021-07-01 is Alpha (House only, in
 *   the window), never Beta, and never matches a Senate or Beta at_vote filter.
 * - Kim: only a Senate term, but a stored House position: no eligible term, unattributed.
 * - Tam: two House terms starting the same day (ZR-1 Alpha, ZR-2 Beta, inserted in that
 *   order) and a vote on its own roll call: the higher id (Beta) wins, deterministically,
 *   and the position is flagged ambiguous.
 */
const db = useSeededDb();
const exec = (query: ReturnType<typeof sql>) => db.handle().db.execute(query);
const AREA = 'zz-vote-party-resolver';
const PROV = sql`'dev-seed', 'test:party-resolver', 1, now()`;

const PEOPLE = {
  rowan: 'pr-mover-rowan',
  quinn: 'pr-boundary-quinn',
  pat: 'pr-after-end-pat',
  tam: 'pr-tie-tam',
  drew: 'pr-past-window-drew',
  sasha: 'pr-review-case-sasha',
  kim: 'pr-no-term-kim',
} as const;
type Who = keyof typeof PEOPLE;

// who, chamber, district (null = Senate), party, start, end
const TERMS: Array<[Who, 'house' | 'senate', number | null, string, string, string | null]> = [
  ['rowan', 'house', 1, 'Alpha Party', '2021-01-03', null],
  ['rowan', 'senate', null, 'Beta Party', '2021-02-01', null],
  ['quinn', 'house', 1, 'Alpha Party', '2021-01-03', '2021-06-01'],
  ['quinn', 'house', 1, 'Beta Party', '2021-06-01', null],
  ['pat', 'house', 2, 'Alpha Party', '2021-01-03', '2021-05-30'],
  ['tam', 'house', 1, 'Alpha Party', '2021-01-03', null],
  ['tam', 'house', 2, 'Beta Party', '2021-01-03', null],
  ['drew', 'house', 2, 'Alpha Party', '2021-01-03', '2021-05-29'],
  ['sasha', 'house', 1, 'Alpha Party', '2021-01-03', '2021-06-30'],
  ['sasha', 'senate', null, 'Beta Party', '2021-07-01', null],
  ['kim', 'senate', null, 'Beta Party', '2021-01-03', null],
];

// number, chamber, date
const ROLLCALLS: Array<[number, 'house' | 'senate', string]> = [
  [98001, 'house', '2021-03-01'],
  [98002, 'house', '2021-06-01'],
  [98003, 'senate', '2021-03-01'],
  [98004, 'house', '2021-03-01'],
  [98005, 'house', '2021-07-01'],
  [98006, 'house', '2021-03-01'],
  [98007, 'house', '2021-06-01'],
];

const POSITIONS: Array<[Who, number]> = [
  ['rowan', 98001],
  ['rowan', 98003],
  ['quinn', 98001],
  ['quinn', 98002],
  ['pat', 98002],
  ['tam', 98004],
  ['sasha', 98005],
  ['kim', 98006],
  ['drew', 98007],
];

beforeAll(async () => {
  await exec(sql`insert into policy_area (id, name) values (${AREA}, 'Party resolver test')`);
  for (const district of [1, 2, null]) {
    await exec(sql`
      insert into office (level, chamber, state, district)
      values ('federal', ${district === null ? 'senate' : 'house'}::chamber, 'ZR', ${district})`);
  }
  for (const [who, slug] of Object.entries(PEOPLE)) {
    const name = slug.split('-').slice(1).join(' ');
    await exec(sql`
      insert into person (slug, full_name, first_name, last_name, source_id, source_key,
        ingest_run_id, retrieved_at)
      values (${slug}, ${name}, ${who}, ${name.split(' ')[1] ?? who}, ${PROV})`);
  }
  // One insert per term, in array order, so Tam's ZR-2 term has the higher id.
  for (const [who, chamber, district, party, start, end] of TERMS) {
    await exec(sql`
      insert into term (person_id, office_id, party, start_date, end_date, source_id, source_key,
        ingest_run_id, retrieved_at)
      select p.id, o.id, ${party}, ${start}, ${end}, ${PROV}
      from person p, office o
      where p.slug = ${PEOPLE[who]} and o.state = 'ZR' and o.chamber = ${chamber}::chamber
        and o.district is not distinct from ${district}::int`);
  }
  await exec(sql`
    insert into bill (congress, bill_type, number, title, url, source_id, source_key,
      ingest_run_id, retrieved_at)
    values (117, 'hr', 9902, 'Party resolver test bill (fictional)', 'https://example.org/pr', ${PROV})`);
  await exec(sql`
    insert into bill_policy_area (bill_id, policy_area_id, source_id, source_key, ingest_run_id,
      retrieved_at)
    select id, ${AREA}, ${PROV} from bill where congress = 117 and number = 9902`);
  for (const [number, chamber, date] of ROLLCALLS) {
    await exec(sql`
      insert into rollcall (congress, chamber, number, vote_date, question, result, yea_count,
        nay_count, source_id, source_key, ingest_run_id, retrieved_at)
      values (117, ${chamber}::chamber, ${number}, ${date}, 'On Passage', 'Passed', 0, 0, ${PROV})`);
    await exec(sql`
      insert into rollcall_bill (rollcall_id, bill_id, source_id, source_key, ingest_run_id,
        retrieved_at)
      select r.id, b.id, ${PROV} from rollcall r, bill b
      where r.number = ${number} and r.chamber = ${chamber}::chamber and r.congress = 117
        and b.congress = 117 and b.number = 9902`);
  }
  for (const [who, number] of POSITIONS) {
    await exec(sql`
      insert into vote_position (rollcall_id, person_id, position, source_id, source_key,
        ingest_run_id, retrieved_at)
      select r.id, p.id, 'yea'::vote_position_value, ${PROV}
      from rollcall r, person p
      where r.number = ${number} and r.congress = 117 and p.slug = ${PEOPLE[who]}`);
  }
  await refreshPersonCard(db.handle().db);
});

type ByParty = Array<{ party: string; yea: number }>;

/** votes.list byParty per roll call (yea only; every fixture position is a yea). */
async function tallies(): Promise<Map<number, { byParty: ByParty; ambiguous: number }>> {
  const out = new Map<number, { byParty: ByParty; ambiguous: number }>();
  for (const chamber of ['house', 'senate'] as const) {
    const result = await dispatch('votes.list', { policyArea: AREA, chamber, limit: 10 }, db.ctx());
    for (const item of result.items) {
      out.set(item.rollcall.number, {
        byParty: item.byParty.map(({ party, yea }) => ({ party, yea })),
        ambiguous: item.ambiguousTermPositions,
      });
    }
  }
  return out;
}

/** frameworks.evaluate partyAtVote per (person, roll call) for recorded votes. */
async function states(): Promise<Map<string, { party: string | null; ambiguous: boolean }>> {
  const rules = ROLLCALLS.map(([number, chamber]) => ({
    target: { kind: 'rollcall' as const, congress: 117, chamber, number },
    alignedPosition: 'yea' as const,
  }));
  const result = await dispatch(
    'frameworks.evaluate',
    {
      framework: { title: 'party resolver', rules },
      people: { slugs: Object.values(PEOPLE) },
      limit: 50,
    },
    db.ctx(),
  );
  const out = new Map<string, { party: string | null; ambiguous: boolean }>();
  for (const row of result.results) {
    for (const s of row.rollcallStates) {
      if (s.state === 'yea') {
        out.set(`${row.person.slug}:${s.rollcall.number}`, {
          party: s.partyAtVote,
          ambiguous: s.ambiguousTerm,
        });
      }
    }
  }
  return out;
}

const key = (who: Who, number: number) => `${PEOPLE[who]}:${number}`;

/** Roll-call numbers of `who`'s votes that frameworks.evaluate keeps under `people` filters. */
async function atVote(filter: Record<string, string>, who: Who): Promise<number[]> {
  const rules = ROLLCALLS.map(([number, chamber]) => ({
    target: { kind: 'rollcall' as const, congress: 117, chamber, number },
    alignedPosition: 'yea' as const,
  }));
  const result = await dispatch(
    'frameworks.evaluate',
    {
      framework: { title: 'party resolver filters', rules },
      people: { basis: 'at_vote', slugs: [PEOPLE[who]], ...filter },
      limit: 50,
    },
    db.ctx(),
  );
  return (result.results.find((r) => r.person.slug === PEOPLE[who])?.votes ?? []).map(
    (v) => v.rollcall.number,
  );
}

describe('one vote-date party resolver for votes.list and frameworks.evaluate', () => {
  it('a House vote by a member with a newer overlapping Senate term counts under the House term', async () => {
    const [t, s] = await Promise.all([tallies(), states()]);
    // 98001 (House, 2021-03-01): Rowan under the House term (Alpha), Quinn Alpha.
    expect(t.get(98001)?.byParty).toEqual([{ party: 'Alpha Party', yea: 2 }]);
    expect(s.get(key('rowan', 98001))).toEqual({ party: 'Alpha Party', ambiguous: false });
    // 98003 (Senate, same day): the Senate term.
    expect(t.get(98003)?.byParty).toEqual([{ party: 'Beta Party', yea: 1 }]);
    expect(s.get(key('rowan', 98003))).toEqual({ party: 'Beta Party', ambiguous: false });
  });

  it('treats the end date as exclusive, and keeps the latest earlier term after a recorded end', async () => {
    const [t, s] = await Promise.all([tallies(), states()]);
    // 98002 (House, 2021-06-01): Quinn's Alpha term ends that day, Beta starts it -> Beta;
    // Pat's only term ended 2021-05-30 -> Alpha (fallback), not Unknown.
    expect(s.get(key('quinn', 98002))).toEqual({ party: 'Beta Party', ambiguous: false });
    expect(s.get(key('quinn', 98001))).toEqual({ party: 'Alpha Party', ambiguous: false });
    expect(s.get(key('pat', 98002))).toEqual({ party: 'Alpha Party', ambiguous: false });
    expect(t.get(98002)?.byParty).toEqual([
      { party: 'Alpha Party', yea: 1 },
      { party: 'Beta Party', yea: 1 },
    ]);
  });

  it('breaks an equal-start tie by the highest term id, the same way on both paths, and flags it', async () => {
    const [t, s] = await Promise.all([tallies(), states()]);
    expect(s.get(key('tam', 98004))).toEqual({ party: 'Beta Party', ambiguous: true });
    expect(t.get(98004)?.byParty).toEqual([{ party: 'Beta Party', yea: 1 }]);
    expect(t.get(98004)?.ambiguous).toBe(1);
    expect(t.get(98001)?.ambiguous).toBe(0);
  });

  it("the review's case: a House vote the day a Senate term starts is credited to the House term", async () => {
    const [t, s] = await Promise.all([tallies(), states()]);
    expect(t.get(98005)?.byParty).toEqual([{ party: 'Alpha Party', yea: 1 }]);
    expect(s.get(key('sasha', 98005))).toEqual({ party: 'Alpha Party', ambiguous: false });
    // at_vote: the vote is House/Alpha membership, never Senate or Beta.
    expect(await atVote({ chamber: 'senate' }, 'sasha')).not.toContain(98005);
    expect(await atVote({ party: 'Beta Party' }, 'sasha')).not.toContain(98005);
    expect(await atVote({ chamber: 'house', party: 'Alpha Party' }, 'sasha')).toContain(98005);
  });

  it('attributes inside the 2-day window and leaves a vote 3 days after the end unattributed', async () => {
    const [t, s] = await Promise.all([tallies(), states()]);
    // Pat: 2 days after the recorded end (the boundary, inside).
    expect(s.get(key('pat', 98002))).toEqual({ party: 'Alpha Party', ambiguous: false });
    expect(await atVote({ chamber: 'house', party: 'Alpha Party' }, 'pat')).toContain(98002);
    // Drew: 3 days after (outside).
    expect(t.get(98007)?.byParty).toEqual([{ party: 'Unknown', yea: 1 }]);
    expect(s.get(key('drew', 98007))).toEqual({ party: null, ambiguous: false });
    expect(await atVote({ chamber: 'house' }, 'drew')).not.toContain(98007);
    expect(await atVote({ party: 'Alpha Party' }, 'drew')).not.toContain(98007);
  });

  it('leaves a vote with no term in its chamber unattributed, never guessed from another chamber', async () => {
    const [t, s] = await Promise.all([tallies(), states()]);
    expect(t.get(98006)?.byParty).toEqual([{ party: 'Unknown', yea: 1 }]);
    expect(t.get(98006)?.byParty.reduce((n, p) => n + p.yea, 0)).toBe(1); // still counted
    expect(s.get(key('kim', 98006))).toEqual({ party: null, ambiguous: false });
    expect(await atVote({ chamber: 'house' }, 'kim')).not.toContain(98006);
    expect(await atVote({ party: 'Beta Party' }, 'kim')).not.toContain(98006);
    // The 'current' basis is unchanged: it filters by the person card, not the vote date.
    expect(await atVote({ basis: 'current' }, 'kim')).toContain(98006);
  });

  it('byParty equals the per-party count of frameworks.evaluate states on every roll call', async () => {
    const [t, s] = await Promise.all([tallies(), states()]);
    for (const [number] of ROLLCALLS) {
      const fromStates = new Map<string, number>();
      for (const [k, v] of s) {
        if (!k.endsWith(`:${number}`)) continue;
        const party = v.party ?? 'Unknown'; // an unattributed vote is the Unknown row
        fromStates.set(party, (fromStates.get(party) ?? 0) + 1);
      }
      const fromTally = new Map(t.get(number)?.byParty.map((p) => [p.party, p.yea]));
      expect(fromTally, `roll call ${number}`).toEqual(fromStates);
    }
  });
});
