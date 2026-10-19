import { refreshPersonCard } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { expectCapabilityError, useSeededDb } from './helpers';

/**
 * T-S2b (evidence-trust 2026-10-19): bill and roll-call pages. Fictional fixtures in the
 * unassigned state QB, on top of the seed:
 *
 * - H.R. 1 exists in the 118th and the 119th Congress with different titles. The 118th one
 *   has a linked sponsor and a latest action; the 119th one has neither (both unknown).
 * - S. 5 (119th) has a long official title and no roll calls.
 * - The 119th H.R. 1 has four House roll calls: a motion to recommit, two different
 *   amendments that share the same question wording, and final passage.
 * - Final passage (sequence 97104, roll 120, session 1): Ana and Bo vote yea, Cy nay, Di yea
 *   with two overlapping terms (Alpha and Beta), Ed serves but has no stored record, Flo's
 *   term starts after the vote. Source totals: 4 yea / 1 nay (the stored positions give 3 / 1).
 */
const db = useSeededDb();
const exec = (query: ReturnType<typeof sql>) => db.handle().db.execute(query);
const PROV = sql`'dev-seed', 'test:t-s2b', 1, now()`;

const PEOPLE = ['ana', 'bo', 'cy', 'di', 'ed', 'flo'] as const;
type Who = (typeof PEOPLE)[number];
const slug = (who: Who) => `s2b-${who}-member`;

const TERMS: Array<[Who, string, string, string | null]> = [
  ['ana', 'Alpha Party', '2023-01-03', null],
  ['bo', 'Beta Party', '2023-01-03', null],
  ['cy', 'Beta Party', '2023-01-03', null],
  ['di', 'Alpha Party', '2023-01-03', '2027-01-03'],
  ['di', 'Beta Party', '2025-01-03', '2027-01-03'],
  ['ed', 'Alpha Party', '2023-01-03', null],
  ['flo', 'Beta Party', '2025-12-01', null],
];

const LONG_TITLE = `A bill to ${'amend the fictional statutes with respect to many matters, '.repeat(6)}and for other purposes.`;

// number, congress, type, title, sponsor, latest action text, latest action date
const BILLS: Array<[number, number, string, string, Who | null, string | null, string | null]> = [
  [1, 118, 'hr', 'Fictional Harbor Act of 2023', 'ana', 'Referred to a fictional committee.', '2023-02-01'],
  [1, 119, 'hr', 'Fictional Lantern Act of 2025', null, null, null],
  [5, 119, 's', LONG_TITLE, null, null, null],
];

// sequence number, clerk number, date, question, description, final passage, yea, nay
const ROLLCALLS: Array<[number, number, string, string, string, boolean, number, number]> = [
  [97101, 101, '2025-03-04', 'On Motion to Recommit', 'Motion to recommit with instructions (fictional)', false, 2, 3],
  [97102, 105, '2025-03-05', 'On Agreeing to the Amendment', 'Amendment No. 3 to strike section 2 (fictional)', false, 3, 2],
  [97103, 106, '2025-03-05', 'On Agreeing to the Amendment', 'Amendment No. 7 to add a reporting rule (fictional)', false, 1, 4],
  [97104, 120, '2025-03-06', 'On Passage', 'Fictional Lantern Act of 2025 (passage)', true, 4, 1],
];

const PASSAGE: Array<[Who, 'yea' | 'nay']> = [
  ['ana', 'yea'],
  ['bo', 'yea'],
  ['cy', 'nay'],
  ['di', 'yea'],
];

beforeAll(async () => {
  await exec(sql`
    insert into office (level, chamber, state, district)
    values ('federal', 'house'::chamber, 'QB', 1)`);
  for (const who of PEOPLE) {
    await exec(sql`
      insert into person (slug, full_name, first_name, last_name, source_id, source_key,
        ingest_run_id, retrieved_at)
      values (${slug(who)}, ${`${who} Member`}, ${who}, ${`Qb${who}`}, ${PROV})`);
  }
  for (const [who, party, start, end] of TERMS) {
    await exec(sql`
      insert into term (person_id, office_id, party, start_date, end_date, source_id, source_key,
        ingest_run_id, retrieved_at)
      select p.id, o.id, ${party}, ${start}, ${end}, ${PROV}
      from person p, office o where p.slug = ${slug(who)} and o.state = 'QB'`);
  }
  for (const [number, congress, type, title, sponsor, actionText, actionDate] of BILLS) {
    await exec(sql`
      insert into bill (congress, bill_type, number, title, introduced_date, sponsor_person_id,
        latest_action_text, latest_action_date, url, source_id, source_key, ingest_run_id,
        retrieved_at)
      values (${congress}, ${type}, ${number}, ${title}, ${`${congress + 1905}-01-09`},
        (select id from person where slug = ${sponsor ? slug(sponsor) : null}),
        ${actionText}, ${actionDate}, ${`https://example.org/${congress}/${type}/${number}`},
        ${PROV})`);
  }
  await exec(sql`
    insert into bill_policy_area (bill_id, policy_area_id, source_id, source_key, ingest_run_id,
      retrieved_at)
    select b.id, 'health', ${PROV} from bill b where b.congress = 119 and b.bill_type = 'hr'
      and b.number = 1`);
  for (const subject of ['Fictional subject B', 'Fictional subject A']) {
    await exec(sql`
      insert into bill_subject (bill_id, subject, source_id, source_key, ingest_run_id,
        retrieved_at)
      select b.id, ${subject}, ${PROV} from bill b where b.congress = 119 and b.bill_type = 'hr'
        and b.number = 1`);
  }
  for (const [number, clerk, date, question, description, finalPassage, yea, nay] of ROLLCALLS) {
    await exec(sql`
      insert into rollcall (congress, chamber, number, session, clerk_number, vote_date, question,
        description, result, yea_count, nay_count, source_id, source_key, ingest_run_id,
        retrieved_at)
      values (119, 'house'::chamber, ${number}, 1, ${clerk}, ${date}, ${question}, ${description},
        ${yea > nay ? 'Passed' : 'Failed'}, ${yea}, ${nay}, ${PROV})`);
    await exec(sql`
      insert into rollcall_bill (rollcall_id, bill_id, is_final_passage, source_id, source_key,
        ingest_run_id, retrieved_at)
      select r.id, b.id, ${finalPassage}, ${PROV} from rollcall r, bill b
      where r.number = ${number} and r.chamber = 'house' and r.congress = 119
        and b.congress = 119 and b.bill_type = 'hr' and b.number = 1`);
  }
  for (const [who, position] of PASSAGE) {
    await exec(sql`
      insert into vote_position (rollcall_id, person_id, position, source_id, source_key,
        ingest_run_id, retrieved_at)
      select r.id, p.id, ${position}::vote_position_value, ${PROV}
      from rollcall r, person p
      where r.number = 97104 and r.chamber = 'house' and r.congress = 119 and p.slug = ${slug(who)}`);
  }
  await refreshPersonCard(db.handle().db);
});

const passageKey = { congress: 119, chamber: 'house' as const, number: 97104 };

describe('bills.search@1', () => {
  it('resolves "H.R. 1" in every congress separately, newest congress first', async () => {
    for (const q of ['H.R. 1', 'hr1', 'HR 1', 'h.r.1']) {
      const result = await dispatch('bills.search', { q }, db.ctx());
      expect(result.query).toEqual({ interpretedAs: 'bill_number', billType: 'hr', number: 1 });
      expect(result.items.map((b) => [b.congress, b.label, b.title])).toEqual([
        [119, 'H.R. 1', 'Fictional Lantern Act of 2025'],
        [118, 'H.R. 1', 'Fictional Harbor Act of 2023'],
      ]);
      expect(result.total).toBe(2);
    }
    const only118 = await dispatch('bills.search', { q: 'hr1', congress: 118 }, db.ctx());
    expect(only118.items.map((b) => b.title)).toEqual(['Fictional Harbor Act of 2023']);
    expect(only118.items[0]?.provenance.sourceKey).toBe('test:t-s2b');
  });

  it('parses Senate numbers and falls back to title text', async () => {
    const senate = await dispatch('bills.search', { q: 'S 5' }, db.ctx());
    expect(senate.items.map((b) => [b.congress, b.billType, b.number, b.label])).toEqual([
      [119, 's', 5, 'S. 5'],
    ]);
    const text = await dispatch('bills.search', { q: 'lantern act' }, db.ctx());
    expect(text.query.interpretedAs).toBe('title_text');
    expect(text.items.map((b) => b.label)).toEqual(['H.R. 1']);
    // LIKE wildcards in the query are literal text.
    const wildcard = await dispatch('bills.search', { q: '%_%' }, db.ctx());
    expect(wildcard.total).toBe(0);
  });

  it('pages deterministically over every bill when no query is given', async () => {
    const all = await dispatch('bills.search', { limit: 100 }, db.ctx());
    expect(all.query.interpretedAs).toBe('none');
    const keys = all.items.map((b) => `${b.congress}-${b.billType}-${b.number}`);
    const [first, second] = await Promise.all([
      dispatch('bills.search', { limit: 3 }, db.ctx()),
      dispatch('bills.search', { limit: 3, offset: 3 }, db.ctx()),
    ]);
    expect([...first.items, ...second.items].map((b) => `${b.congress}-${b.billType}-${b.number}`))
      .toEqual(keys.slice(0, 6));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('rejects unknown keys and over-long queries', async () => {
    await expectCapabilityError(dispatch('bills.search', { query: 'x' }, db.ctx()), 'invalid_input');
    await expectCapabilityError(
      dispatch('bills.search', { q: 'x'.repeat(201) }, db.ctx()),
      'invalid_input',
    );
  });
});

describe('bills.get@1', () => {
  it('keeps the same number in two congresses apart', async () => {
    const [old, current] = await Promise.all([
      dispatch('bills.get', { congress: 118, billType: 'hr', number: 1 }, db.ctx()),
      dispatch('bills.get', { congress: 119, billType: 'hr', number: 1 }, db.ctx()),
    ]);
    expect(old.bill.title).toBe('Fictional Harbor Act of 2023');
    expect(current.bill.title).toBe('Fictional Lantern Act of 2025');
    expect(old.bill.url).toBe('https://example.org/118/hr/1');
    expect(old.rollcalls).toEqual([]);
    expect(current.rollcalls).toHaveLength(4);
  });

  it('states an unknown sponsor and latest action explicitly', async () => {
    const old = await dispatch('bills.get', { congress: 118, billType: 'hr', number: 1 }, db.ctx());
    expect(old.sponsor).toEqual({
      status: 'recorded',
      person: { slug: slug('ana'), fullName: 'ana Member' },
    });
    expect(old.latestAction).toEqual({
      status: 'recorded',
      text: 'Referred to a fictional committee.',
      date: '2023-02-01',
    });

    const current = await dispatch(
      'bills.get',
      { congress: 119, billType: 'hr', number: 1 },
      db.ctx(),
    );
    expect(current.sponsor).toEqual({ status: 'unknown', person: null });
    expect(current.latestAction).toEqual({ status: 'unknown', text: null, date: null });
    expect(current.policyAreas.map((a) => a.id)).toEqual(['health']);
    expect(current.subjects.map((s) => s.subject)).toEqual([
      'Fictional subject A',
      'Fictional subject B',
    ]);
    expect(current.subjects[0]?.provenance.sourceKey).toBe('test:t-s2b');
  });

  it('keeps two different motions with the same question apart, with their source wording', async () => {
    const bill = await dispatch('bills.get', { congress: 119, billType: 'hr', number: 1 }, db.ctx());
    expect(
      bill.rollcalls.map((r) => [
        r.rollcall.number,
        r.rollcall.session,
        r.rollcall.clerkNumber,
        r.rollcall.question,
        r.rollcall.description,
        r.isFinalPassage,
        r.questionKind,
      ]),
    ).toEqual([
      [97101, 1, 101, 'On Motion to Recommit', 'Motion to recommit with instructions (fictional)', false, 'motion'],
      [97102, 1, 105, 'On Agreeing to the Amendment', 'Amendment No. 3 to strike section 2 (fictional)', false, 'amendment'],
      [97103, 1, 106, 'On Agreeing to the Amendment', 'Amendment No. 7 to add a reporting rule (fictional)', false, 'amendment'],
      [97104, 1, 120, 'On Passage', 'Fictional Lantern Act of 2025 (passage)', true, 'final_passage'],
    ]);
    for (const r of bill.rollcalls) {
      expect(r.rollcall.provenance.sourceKey).toBe('test:t-s2b');
      expect(r.linkProvenance.sourceKey).toBe('test:t-s2b');
    }
  });

  it('is not_found for a bill that does not exist and rejects unknown bill types', async () => {
    await expectCapabilityError(
      dispatch('bills.get', { congress: 117, billType: 'hr', number: 1 }, db.ctx()),
      'not_found',
    );
    await expectCapabilityError(
      dispatch('bills.get', { congress: 119, billType: 'HR', number: 1 }, db.ctx()),
      'invalid_input',
    );
    await expectCapabilityError(
      dispatch('bills.get', { congress: 119, billType: 'hr', number: 1, extra: 1 }, db.ctx()),
      'invalid_input',
    );
  });
});

describe('rollcalls.get@1', () => {
  it('counts each stored position once and shows the source totals beside it', async () => {
    const result = await dispatch('rollcalls.get', passageKey, db.ctx());
    expect(result.rollcall.question).toBe('On Passage');
    expect(result.rollcall.description).toBe('Fictional Lantern Act of 2025 (passage)');
    expect([result.rollcall.session, result.rollcall.clerkNumber]).toEqual([1, 120]);
    expect(result.tally).toEqual({ yea: 3, nay: 1, present: 0, notVoting: 0 });
    expect(result.sourceTally).toEqual({ yea: 4, nay: 1 });
    expect(result.tallyCheck).toEqual({
      status: 'differs_from_source',
      yeaDifference: -1,
      nayDifference: 0,
    });
    expect(result.ambiguousTermPositions).toBe(1);
    expect(result.byParty).toEqual([
      { party: 'Alpha Party', yea: 1, nay: 0, present: 0, notVoting: 0 },
      { party: 'Beta Party', yea: 2, nay: 1, present: 0, notVoting: 0 },
    ]);
  });

  it('lists every member once with the vote-time state, including serving members without a record', async () => {
    const result = await dispatch('rollcalls.get', { ...passageKey, limit: 100 }, db.ctx());
    const fixture = result.members.filter((m) => m.person.slug.startsWith('s2b-'));
    expect(fixture.map((m) => [m.person.slug, m.state, m.partyAtVote, m.ambiguousTerm])).toEqual([
      [slug('ana'), 'yea', 'Alpha Party', false],
      [slug('bo'), 'yea', 'Beta Party', false],
      [slug('cy'), 'nay', 'Beta Party', false],
      [slug('di'), 'yea', 'Beta Party', true],
      [slug('ed'), 'unavailable', 'Alpha Party', false],
    ]);
    expect(fixture.find((m) => m.state === 'unavailable')?.provenance).toBeNull();
    expect(fixture[0]?.provenance?.sourceKey).toBe('test:t-s2b');
    expect(fixture.every((m) => m.seatStateAtVote === 'QB')).toBe(true);
    const slugs = result.members.map((m) => m.person.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(result.unavailableMembers).toBe(
      result.members.filter((m) => m.state === 'unavailable').length,
    );
    expect(result.total).toBe(result.members.length);

    const [first, rest] = await Promise.all([
      dispatch('rollcalls.get', { ...passageKey, limit: 2 }, db.ctx()),
      dispatch('rollcalls.get', { ...passageKey, limit: 100, offset: 2 }, db.ctx()),
    ]);
    expect([...first.members, ...rest.members].map((m) => m.person.slug)).toEqual(slugs);
    expect(first.tally).toEqual(result.tally);

    const nays = await dispatch('rollcalls.get', { ...passageKey, memberState: 'nay' }, db.ctx());
    expect(nays.members.map((m) => m.person.slug)).toEqual([slug('cy')]);
    expect(nays.total).toBe(1);
  });

  it('links the bill with its final-passage flag', async () => {
    const result = await dispatch('rollcalls.get', passageKey, db.ctx());
    expect(
      result.bills.map((b) => [b.bill.congress, b.bill.label, b.isFinalPassage, b.questionKind]),
    ).toEqual([[119, 'H.R. 1', true, 'final_passage']]);
  });

  it('agrees with votes.list on every seeded roll call', async () => {
    const votes = await dispatch('votes.list', { congress: 119, limit: 100 }, db.ctx());
    expect(votes.items.length).toBeGreaterThan(5);
    for (const v of votes.items) {
      const { congress, chamber, number } = v.rollcall;
      const detail = await dispatch('rollcalls.get', { congress, chamber, number }, db.ctx());
      expect(detail.tally, `${chamber} ${number}`).toEqual(v.tally);
      expect(detail.byParty, `${chamber} ${number}`).toEqual(v.byParty);
      expect(detail.sourceTally).toEqual(v.sourceTally);
      expect(detail.tallyCheck).toEqual(v.tallyCheck);
      expect(detail.ambiguousTermPositions).toBe(v.ambiguousTermPositions);
      expect(detail.rollcall.provenance).toEqual(v.rollcall.provenance);
    }
  });

  it('is not_found for an unknown roll call and rejects bad keys', async () => {
    await expectCapabilityError(
      dispatch('rollcalls.get', { ...passageKey, number: 1 }, db.ctx()),
      'not_found',
    );
    await expectCapabilityError(
      dispatch('rollcalls.get', { ...passageKey, chamber: 'lords' }, db.ctx()),
      'invalid_input',
    );
    await expectCapabilityError(
      dispatch('rollcalls.get', { ...passageKey, memberState: 'absent' }, db.ctx()),
      'invalid_input',
    );
  });
});
