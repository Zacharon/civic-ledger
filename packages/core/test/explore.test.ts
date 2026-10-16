import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPLORE_SORT, EXPLORE_SORT_COLUMNS } from '../src/capabilities/explore';
import { dispatch } from '../src/dispatch';
import { expectCapabilityError, useSeededDb } from './helpers';

const db = useSeededDb();

describe('explore.table@1', () => {
  it('defaults to a neutral sort: state, then name', async () => {
    const result = await dispatch('explore.table', {}, db.ctx());
    expect(result.sort).toEqual(DEFAULT_EXPLORE_SORT);
    expect(result.sort.map((s) => s.column)).not.toContain('dwNominateDim1');
    const keys = result.rows.map((r) => `${r.state}|${r.sortName}`);
    expect(keys).toEqual([...keys].sort());
    expect(result.total).toBe(40);
  });

  it('attributes every scorecard column', async () => {
    const result = await dispatch('explore.table', { limit: 1 }, db.ctx());
    expect(result.scorecardColumns.map((c) => c.publisherId)).toEqual([
      'sample-civic-action-fund',
      'sample-taxpayer-league',
    ]);
    for (const column of result.scorecardColumns) {
      expect(column.selfDescribedOrientation).not.toBe('');
      expect(column.methodologyUrl).toMatch(/^https:\/\//);
    }
  });

  it('sorts by an allowlisted column with nulls last', async () => {
    const result = await dispatch(
      'explore.table',
      { sort: [{ column: 'totalReceiptsCents', direction: 'desc' }], limit: 100 },
      db.ctx(),
    );
    const values = result.rows.map((r) => r.totalReceiptsCents);
    const present = values.filter((v) => v !== null);
    expect(present).toEqual([...present].sort((a, b) => b - a));
    expect(values.slice(present.length).every((v) => v === null)).toBe(true);
    expect(values.at(-1)).toBeNull();
  });

  it('sorts by a cleared scorecard publisher', async () => {
    const result = await dispatch(
      'explore.table',
      { sort: [{ column: 'scorecard:sample-taxpayer-league', direction: 'asc' }], limit: 100 },
      db.ctx(),
    );
    const scores = result.rows.flatMap((r) =>
      r.scorecards.filter((s) => s.publisherId === 'sample-taxpayer-league').map((s) => s.score),
    );
    expect(scores.length).toBeGreaterThan(0);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });

  it('rejects sort columns outside the allowlist', async () => {
    const error = await expectCapabilityError(
      dispatch('explore.table', { sort: [{ column: 'full_name; drop table person' }] }, db.ctx()),
      'invalid_input',
    );
    expect(error.issues?.[0]?.message).toContain('Unknown sort column');
    await expectCapabilityError(
      dispatch(
        'explore.table',
        { sort: [{ column: 'scorecard:sample-policy-institute' }] },
        db.ctx(),
      ),
      'invalid_input',
    );
  });

  it('filters and paginates; no match is an empty page, not an error', async () => {
    const house = await dispatch(
      'explore.table',
      { filters: { chamber: 'house', state: 'ZX' } },
      db.ctx(),
    );
    expect(house.total).toBe(6);
    expect(house.rows.every((r) => r.chamber === 'house' && r.state === 'ZX')).toBe(true);
    const none = await dispatch('explore.table', { filters: { state: 'QQ' } }, db.ctx());
    expect(none).toMatchObject({ rows: [], total: 0 });
  });

  it('rejects malformed filters', async () => {
    await expectCapabilityError(
      dispatch('explore.table', { filters: { chamber: 'upper' } }, db.ctx()),
      'invalid_input',
    );
  });

  it('shows coverage instead of a silent zero', async () => {
    const result = await dispatch('explore.table', { limit: 100 }, db.ctx());
    const noMoney = result.rows.filter((r) => r.totalReceiptsCents === null);
    expect(noMoney.length).toBeGreaterThan(0);
    expect(noMoney.every((r) => r.industryCodingCoverage === null && r.pacShare === null)).toBe(
      true,
    );
    expect(
      result.rows.some((r) => r.industryCodingCoverage !== null && r.industryCodingCoverage < 1),
    ).toBe(true);
  });
});

describe('person_card indexes', () => {
  it('indexes every allowlisted sort column', async () => {
    const indexes = await db
      .handle()
      .db.execute<{ def: string }>(
        sql`select indexdef as def from pg_indexes where tablename = 'person_card'`,
      );
    const leading = indexes.rows.map((r) => /\((?:"?)(\w+)/.exec(r.def)?.[1]);
    for (const column of Object.values(EXPLORE_SORT_COLUMNS)) {
      expect(leading, column.name).toContain(column.name);
    }
    const scorecard = await db
      .handle()
      .db.execute<{ def: string }>(
        sql`select indexdef as def from pg_indexes where tablename = 'person_card_scorecard'`,
      );
    expect(scorecard.rows.map((r) => r.def).join('\n')).toContain('(publisher_id, normalized)');
  });

  it('serves the default sort from an index when the planner may use one', async () => {
    const { db: database } = db.handle();
    const plan = await database.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      return tx.execute<{ 'QUERY PLAN': string }>(
        sql`explain select * from person_card order by state, sort_name limit 50`,
      );
    });
    expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n')).toContain(
      'person_card_state_sort_name_idx',
    );
  });
});
