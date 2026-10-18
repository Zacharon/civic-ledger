import { join } from 'node:path';
import type { SourceId } from '@civic-ledger/core';
import type { Db, DbHandle } from '@civic-ledger/db';
import { getTableName, type SQL, sql, type Table } from 'drizzle-orm';
import { beforeAll, expect, it } from 'vitest';
import type { LoadContext, SourceAdapter } from '../../src/adapter';
import { ADAPTERS } from '../../src/adapters/registry';
import { runIngest } from '../../src/runtime/run';
import { FIXTURES, ingestFixture, rows, SCOPES, testRuntime } from '../helpers';

/**
 * H3R3 / H3R2-02 residual: every statement boundary of the FEC loader, on PGlite
 * (cancellation-fec-boundaries.test.ts) and Postgres (test-pg/cancellation-fec-boundaries
 * .pgtest.ts). Method of the round-3 review: load legislators then FEC, record every
 * public table except `ingest_run` and both materialized views (count + checksum of the
 * sorted rows), then reload FEC with `forceReplay` while only the loader's database is
 * wrapped. Right after a chosen awaited statement resolves, the real operator signal is
 * aborted; every later loader `execute`, query-builder entry (`select*`, `insert`,
 * `update`, `delete`) and `transaction` is recorded, in transaction callbacks too. The
 * SAVEPOINT the driver awaits before a transaction callback is a trigger point as well.
 * The run must say `cancelled`, the loader must issue no statement after the abort, and the
 * recorded state must equal the baseline. The terminal `cancelled` receipt is written by
 * the runtime outside the loader, so it is not counted.
 */
const STATEMENTS = new Set([
  'execute',
  'transaction',
  'select',
  'selectDistinct',
  'selectDistinctOn',
  'insert',
  'update',
  'delete',
]);
/** Builder steps that return the awaited query object (`select().from()`, `insert().values()`, `update().set()`). */
const BUILDER_STEPS = ['from', 'values', 'set'];

type Thenable = { then: (ok?: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => unknown };

/** Calls `onResolved` after `query` resolves and before its awaiting caller continues. */
function afterResolve<T>(query: T, onResolved: () => Promise<void> | void): T {
  const q = query as unknown as Record<string, unknown>;
  if (q && typeof q.then === 'function') {
    const then = (q as unknown as Thenable).then;
    // biome-ignore lint/suspicious/noThenProperty: intentionally re-hooks the query's own thenable.
    q.then = function (this: unknown, ok?: (v: unknown) => unknown, ko?: (e: unknown) => unknown) {
      return then.call(
        this,
        async (out: unknown) => {
          await onResolved();
          return ok ? ok(out) : out;
        },
        ko,
      );
    };
    return query;
  }
  for (const step of BUILDER_STEPS) {
    const fn = q?.[step];
    if (typeof fn === 'function') {
      q[step] = (...args: unknown[]) =>
        afterResolve((fn as (...a: unknown[]) => unknown).apply(q, args), onResolved);
    }
  }
  return query;
}

const sqlText = (db: Db, query: unknown) =>
  (db as unknown as { dialect: { sqlToQuery(q: SQL): { sql: string } } }).dialect
    .sqlToQuery(query as SQL)
    .sql.replace(/\s+/g, ' ')
    .trim();

function label(db: Db, prop: string, args: unknown[]): string {
  if (prop === 'execute') return `execute: ${sqlText(db, args[0]).slice(0, 70)}`;
  if (prop === 'insert' || prop === 'update' || prop === 'delete') {
    return `${prop} ${getTableName(args[0] as Table)}`;
  }
  return prop;
}

/** Fires once, right after the statement for which `when(label, index)` holds resolves. */
export interface Trigger {
  when: (label: string, index: number) => boolean;
  /** Default: the operator abort (SIGINT). */
  action?: (abort: AbortController) => Promise<void> | void;
}

export interface Recording {
  fired: boolean;
  /** Label of the statement after which the trigger fired. */
  firedAfter: string | null;
  /** Every awaited loader statement, in order. */
  statements: string[];
  /** Loader statement entries (incl. `transaction`) after the trigger fired. */
  afterAbort: string[];
}

const sigint = (abort: AbortController) => abort.abort(new Error('interrupted (SIGINT)'));

/** The fec-bulk adapter with its database wrapped; `trigger: 'end'` aborts as `load` returns. */
export function instrumentedFec(trigger: Trigger | 'end', abort: AbortController) {
  const rec: Recording = { fired: false, firedAfter: null, statements: [], afterAbort: [] };
  const fire = async (what: string) => {
    if (rec.fired) return;
    rec.fired = true;
    rec.firedAfter = what;
    await (trigger === 'end' ? sigint(abort) : (trigger.action ?? sigint)(abort));
  };
  /** A statement resolved: record it, and fire if it is the trigger. */
  const resolved = async (what: string) => {
    const index = rec.statements.length;
    rec.statements.push(what);
    if (!rec.fired && trigger !== 'end' && trigger.when(what, index)) await fire(what);
  };
  const wrap = (db: Db): Db =>
    new Proxy(db, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (typeof value !== 'function') return value;
        const name = String(prop);
        if (!STATEMENTS.has(name)) return value.bind(target);
        return (...args: unknown[]) => {
          const what = label(target, name, args);
          if (rec.fired) rec.afterAbort.push(what);
          if (name === 'transaction') {
            const [callback, ...rest] = args as [(tx: Db) => unknown, ...unknown[]];
            // The driver awaits its SAVEPOINT before it calls the callback: that is a
            // boundary too, after which the callback's first statement must not start.
            return value.call(
              target,
              async (tx: Db) => {
                await resolved('savepoint (transaction callback entered)');
                return callback(wrap(tx));
              },
              ...rest,
            );
          }
          return afterResolve(value.apply(target, args), () => resolved(what));
        };
      },
    });
  const base = ADAPTERS['fec-bulk'];
  const adapter = {
    ...base,
    load: async (records: AsyncIterable<unknown>, ctx: LoadContext) => {
      const counts = await base.load(records as never, { ...ctx, db: wrap(ctx.db) });
      if (trigger === 'end') await fire('end of load');
      return counts;
    },
  } as SourceAdapter<unknown>;
  return { adapters: { ...ADAPTERS, 'fec-bulk': adapter } as Partial<typeof ADAPTERS>, rec };
}

/** Count and checksum of every public table except `ingest_run`, and of both materialized views. */
export async function publicState(handle: DbHandle): Promise<Record<string, string>> {
  const relations = await rows<{ name: string }>(
    handle.db,
    sql`select table_name::text as name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'ingest_run'
      union all select matviewname::text from pg_matviews where schemaname = 'public'
      order by 1`,
  );
  const out: Record<string, string> = {};
  for (const { name } of relations) {
    const [row] = await rows<{ n: number; sum: string }>(
      handle.db,
      sql.raw(`select count(*)::int as n,
        coalesce(md5(string_agg(t::text, E'\\n' order by t::text)), '') as sum from "${name}" t`),
    );
    out[name] = `${row?.n ?? 0}:${row?.sum ?? ''}`;
  }
  return out;
}

/** Reloads the FEC fixture with `forceReplay`, the loader instrumented with `trigger`. */
export async function cancelledReload(
  handle: DbHandle,
  trigger: Trigger | 'end',
  overrides: { abort?: AbortController } = {},
) {
  const abort = overrides.abort ?? new AbortController();
  const { adapters, rec } = instrumentedFec(trigger, abort);
  const receipt = await runIngest(
    {
      source: 'fec-bulk' as SourceId,
      scope: SCOPES['fec-bulk'],
      snapshotPath: join(FIXTURES, 'fec-bulk'),
      forceReplay: true,
    },
    await testRuntime(handle, { signal: abort.signal, adapters }),
  );
  return { receipt, rec };
}

const first = (pattern: RegExp) => {
  let seen = false;
  return (what: string) => {
    if (seen || !pattern.test(what)) return false;
    seen = true;
    return true;
  };
};

/**
 * The named trigger points: the review's thirteen (PAS2 and IE initial DROP, stage
 * CREATE, stage INSERT, kept-table CREATE, statistics query, first kept-page read, plus
 * the first sweep DELETE), and every other DELETE of the cycle sweep.
 */
export const NAMED_TRIGGERS: [string, RegExp][] = [
  ['pas2: initial stage DROP', /^execute: drop table if exists fec_pas2_stage/],
  ['pas2: stage CREATE', /^execute: create temp table fec_pas2_stage /],
  ['pas2: stage INSERT', /^execute: insert into "fec_pas2_stage"/],
  ['pas2: kept-table CREATE', /^execute: create temp table fec_pas2_kept/],
  ['pas2: statistics query', /^execute: with g as/],
  ['pas2: first kept-page read', /^execute: select \* from "fec_pas2_kept"/],
  ['IE: initial stage DROP', /^execute: drop table if exists fec_ie_stage/],
  ['IE: stage CREATE', /^execute: create temp table fec_ie_stage /],
  ['IE: stage INSERT', /^execute: insert into "fec_ie_stage"/],
  ['IE: kept-table CREATE', /^execute: create temp table fec_ie_kept/],
  ['IE: statistics query', /^execute: select \(count\(\*\) filter/],
  ['IE: first kept-page read', /^execute: select \* from "fec_ie_kept"/],
  ['sweep: DELETE 1 (committee_contribution)', /^delete committee_contribution$/],
  ['sweep: DELETE 2 (independent_expenditure)', /^delete independent_expenditure$/],
  ['sweep: DELETE 3 (candidate_cycle_totals)', /^delete candidate_cycle_totals$/],
  ['sweep: DELETE 4 (committee_link)', /^delete committee_link$/],
  ['sweep: DELETE 5 (candidate_cycle_summary)', /^delete candidate_cycle_summary$/],
];

/**
 * Registers the scenarios. `getHandle` returns the suite's database, created before
 * these hooks run; all cases share it, since every reload is cancelled and rolled back.
 */
export function fecBoundaryScenarios(getHandle: () => DbHandle) {
  let baseline: Record<string, string>;

  beforeAll(async () => {
    const handle = getHandle();
    const rt = await testRuntime(handle);
    expect((await ingestFixture(rt, 'congress-legislators')).status).toBe('succeeded');
    expect((await ingestFixture(rt, 'fec-bulk')).status).toBe('succeeded');
    baseline = await publicState(handle);
    // The baseline holds the money facts and both read models the reload would replace.
    for (const name of [
      'committee_contribution',
      'independent_expenditure',
      'candidate_cycle_totals',
      'candidate_cycle_summary',
      'committee_link',
      'person_card',
      'person_card_scorecard',
    ]) {
      expect(baseline[name], name).toBeDefined();
    }
    expect(baseline.committee_contribution?.startsWith('0:')).toBe(false);
    expect(baseline.candidate_cycle_summary?.startsWith('0:')).toBe(false);
  });

  for (const [name, pattern] of NAMED_TRIGGERS) {
    it(`an abort right after ${name} issues no further loader statement and rolls back`, async () => {
      const handle = getHandle();
      const { receipt, rec } = await cancelledReload(handle, { when: first(pattern) });
      expect(rec.fired, 'trigger statement reached').toBe(true);
      expect(rec.afterAbort).toEqual([]);
      expect(receipt.status).toBe('cancelled');
      expect(receipt.error).toMatch(/^cancelled: interrupted \(SIGINT\)\. Rolled back/);
      expect(await publicState(handle)).toEqual(baseline);
    });
  }

  it('an abort after ANY loader statement or savepoint issues no further loader statement and rolls back', async () => {
    const handle = getHandle();
    // Reference: the full statement list of one reload, cancelled as the loader returns.
    const reference = await cancelledReload(handle, 'end');
    expect(reference.receipt.status).toBe('cancelled');
    expect(reference.rec.afterAbort).toEqual([]);
    expect(await publicState(handle)).toEqual(baseline);
    const all = reference.rec.statements;
    expect(all.length).toBeGreaterThan(30);
    // For the evidence report: FEC_BOUNDARY_LIST=1 prints the boundaries this sweep covers.
    if (process.env.FEC_BOUNDARY_LIST) console.info(all.map((s, i) => `${i}: ${s}`).join('\n'));

    const violations: { index: number; after: string; issued: string[]; status: string }[] = [];
    for (let index = 0; index < all.length; index++) {
      const { receipt, rec } = await cancelledReload(handle, { when: (_, i) => i === index });
      const restored = JSON.stringify(await publicState(handle)) === JSON.stringify(baseline);
      if (!rec.fired || rec.afterAbort.length > 0 || receipt.status !== 'cancelled' || !restored) {
        violations.push({
          index,
          after: rec.firedAfter ?? `(not reached: ${all[index]})`,
          issued: rec.afterAbort,
          status: restored ? receipt.status : `${receipt.status}, state differs from baseline`,
        });
      }
    }
    expect(violations, `${all.length} statement boundaries checked`).toEqual([]);
  }, 600_000);
}
