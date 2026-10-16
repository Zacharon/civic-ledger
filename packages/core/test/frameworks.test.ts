import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { type RollcallClaim, scoreVotes } from '../src/frameworks/score';
import { expectCapabilityError, useSeededDb } from './helpers';

const db = useSeededDb();

describe('scoreVotes', () => {
  const claims = new Map<number, RollcallClaim>([
    [10, { ruleIndex: 0, alignedPosition: 'yea', weight: 1 }],
    [11, { ruleIndex: 1, alignedPosition: 'nay', weight: 3 }],
    [12, { ruleIndex: 2, alignedPosition: 'yea', weight: 1 }],
  ]);

  it('counts aligned X of Y over yea/nay votes only', () => {
    const scores = scoreVotes(claims, [
      { personId: 1, rollcallId: 10, position: 'yea' },
      { personId: 1, rollcallId: 11, position: 'yea' },
      { personId: 1, rollcallId: 12, position: 'not_voting' },
      { personId: 1, rollcallId: 99, position: 'yea' },
      { personId: 2, rollcallId: 11, position: 'nay' },
      { personId: 2, rollcallId: 12, position: 'present' },
    ]);
    expect(scores.get(1)).toMatchObject({
      aligned: 1,
      considered: 2,
      notCounted: 1,
      weightedAligned: 1,
      weightedConsidered: 4,
    });
    expect(scores.get(1)?.votes.map((v) => v.aligned)).toEqual([true, false, null]);
    expect(scores.get(2)).toMatchObject({
      aligned: 1,
      considered: 1,
      notCounted: 1,
      weightedAligned: 3,
    });
  });

  it('ignores votes on unclaimed rollcalls', () => {
    expect(scoreVotes(claims, [{ personId: 1, rollcallId: 99, position: 'yea' }]).size).toBe(0);
  });
});

describe('frameworks.list@1', () => {
  it('lists attributed frameworks whose spec is directly evaluable', async () => {
    const list = await dispatch('frameworks.list', {}, db.ctx());
    expect(list.items.map((f) => f.statedOrientation).sort()).toEqual([
      'fiscally conservative',
      'progressive',
    ]);
    for (const f of list.items) {
      expect(f.author).not.toBe('');
      expect(f.provenance.sourceId).toBe('dev-seed');
      expect(f.spec.rules.some((r) => r.target.kind === 'bill')).toBe(true);
      const result = await dispatch('frameworks.evaluate', { framework: f.spec }, db.ctx());
      expect(result.rules.every((r) => r.status === 'resolved')).toBe(true);
    }
  });

  it('rejects unexpected input (no not_found case: it takes no parameters)', async () => {
    await expectCapabilityError(
      dispatch('frameworks.list', { slug: 'x' }, db.ctx()),
      'invalid_input',
    );
  });
});

describe('frameworks.evaluate@1', () => {
  it('matches an independent SQL count of aligned and considered votes for every person', async () => {
    const list = await dispatch('frameworks.list', {}, db.ctx());
    const spec = list.items[0]?.spec;
    if (!spec) throw new Error('seed has no frameworks');
    const result = await dispatch('frameworks.evaluate', { framework: spec, limit: 600 }, db.ctx());

    const used = result.rules.flatMap((r) =>
      r.rollcalls.map(
        (rc) => sql`(${rc.chamber}::chamber, ${rc.number}::int, ${r.alignedPosition}::text)`,
      ),
    );
    const expected = await db
      .handle()
      .db.execute<{ slug: string; aligned: number; considered: number }>(sql`
      with used(chamber, number, aligned) as (values ${sql.join(used, sql`, `)})
      select p.slug,
             (count(*) filter (where vp.position::text = u.aligned))::int as aligned,
             (count(*) filter (where vp.position in ('yea', 'nay')))::int as considered
      from used u
      join rollcall r on r.chamber = u.chamber and r.number = u.number
      join vote_position vp on vp.rollcall_id = r.id
      join person p on p.id = vp.person_id
      group by p.slug`);

    expect(result.total).toBe(expected.rows.length);
    const actual = Object.fromEntries(
      result.results.map((r) => [r.person.slug, [r.aligned, r.considered]]),
    );
    const fromSql = Object.fromEntries(
      expected.rows.map((r) => [r.slug, [r.aligned, r.considered]]),
    );
    expect(actual).toEqual(fromSql);
    for (const r of result.results) {
      expect(r.alignmentRate).toBe(r.considered > 0 ? r.aligned / r.considered : null);
      expect(r.votes.length).toBe(r.considered + r.notCounted);
    }
  });

  it('resolves a bill to its final-passage rollcalls only and never double counts', async () => {
    const result = await dispatch(
      'frameworks.evaluate',
      {
        framework: {
          title: 'Resolution check',
          rules: [
            {
              target: { kind: 'rollcall', congress: 119, chamber: 'house', number: 9002 },
              alignedPosition: 'yea',
            },
            {
              target: { kind: 'bill', congress: 119, billType: 'hr', number: 99001 },
              alignedPosition: 'yea',
            },
            {
              target: { kind: 'bill', congress: 119, billType: 'hr', number: 99003 },
              alignedPosition: 'nay',
              weight: 2,
            },
            {
              target: { kind: 'rollcall', congress: 119, chamber: 'house', number: 1 },
              alignedPosition: 'yea',
            },
            {
              target: { kind: 'bill', congress: 119, billType: 's', number: 1 },
              alignedPosition: 'yea',
            },
          ],
        },
      },
      db.ctx(),
    );
    expect(result.rules.map((r) => [r.status, r.reason])).toEqual([
      ['resolved', null],
      ['unresolved', 'duplicate_rollcall'],
      ['resolved', null],
      ['unresolved', 'rollcall_not_found'],
      ['unresolved', 'bill_not_found'],
    ]);
    expect(result.rules[1]?.bill?.number).toBe(99001);
    expect(result.rules[2]?.rollcalls.map((r) => r.chamber).sort()).toEqual(['house', 'senate']);
    expect(result.rules[2]?.rollcalls.every((r) => r.question === 'On Passage')).toBe(true);
    const anyone = result.results.find((r) => r.considered > 0);
    expect(anyone?.weightedConsidered).toBeGreaterThanOrEqual(anyone?.considered ?? 0);
  });

  it('scopes people by filter and paginates in a neutral order', async () => {
    const framework = {
      title: 'Senate only',
      rules: [
        {
          target: { kind: 'bill', congress: 119, billType: 's', number: 99002 },
          alignedPosition: 'yea',
        },
      ],
    };
    const all = await dispatch(
      'frameworks.evaluate',
      { framework, people: { chamber: 'senate' } },
      db.ctx(),
    );
    expect(all.total).toBe(10);
    expect(all.results.every((r) => r.person.chamber === 'senate')).toBe(true);
    const states = all.results.map((r) => r.person.state ?? '');
    expect(states).toEqual([...states].sort());
    const page = await dispatch(
      'frameworks.evaluate',
      { framework, people: { chamber: 'senate' }, limit: 3, offset: 3 },
      db.ctx(),
    );
    expect(page.results.map((r) => r.person.slug)).toEqual(
      all.results.slice(3, 6).map((r) => r.person.slug),
    );
  });

  it('reports unknown targets as unresolved rules instead of not_found', async () => {
    const result = await dispatch(
      'frameworks.evaluate',
      {
        framework: {
          title: 'Nothing',
          rules: [
            {
              target: { kind: 'rollcall', congress: 1, chamber: 'senate', number: 1 },
              alignedPosition: 'nay',
            },
          ],
        },
      },
      db.ctx(),
    );
    expect(result).toMatchObject({ results: [], total: 0 });
    expect(result.rules[0]?.reason).toBe('rollcall_not_found');
  });

  it('rejects malformed specs', async () => {
    const target = { kind: 'rollcall', congress: 119, chamber: 'house', number: 9002 };
    for (const framework of [
      { title: 'Empty', rules: [] },
      { title: 'Zero weight', rules: [{ target, alignedPosition: 'yea', weight: 0 }] },
      { title: 'Bad position', rules: [{ target, alignedPosition: 'abstain' }] },
      {
        title: 'Bad kind',
        rules: [{ target: { ...target, kind: 'amendment' }, alignedPosition: 'yea' }],
      },
    ]) {
      await expectCapabilityError(
        dispatch('frameworks.evaluate', { framework }, db.ctx()),
        'invalid_input',
      );
    }
  });
});
