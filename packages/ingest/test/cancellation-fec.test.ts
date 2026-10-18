import type { Db, DbHandle } from '@civic-ledger/db';
import type { SQL } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LoadContext, SourceAdapter } from '../src/adapter';
import { ADAPTERS } from '../src/adapters/registry';
import { freshDb, ingestFixture, tableCounts, testRuntime } from './helpers';

/**
 * H3R2-02: an abort during the FEC loader's SQL post-processing (pas2 / IE dedupe of the
 * staged rows, then the kept pages) must stop the loader at the next statement: no further
 * stats query, page read, page write, sweep or cleanup after the abort. The run rolls back
 * and its receipt says `cancelled`; the previous load stays as it was.
 */
let handle: DbHandle;
beforeEach(async () => {
  handle = await freshDb();
});
afterEach(() => handle.close());

/** Query-builder entry points: any call after the abort is a new statement or write. */
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

/**
 * Wraps the loader's database (the load transaction) so that the operator aborts right
 * after the first statement matching `trigger` returns, and records every statement the
 * loader issues after that.
 */
function abortAfter(trigger: RegExp, abort: AbortController, afterAbort: string[]) {
  const text = (db: Db, query: unknown) =>
    (db as unknown as { dialect: { sqlToQuery(q: SQL): { sql: string } } }).dialect
      .sqlToQuery(query as SQL)
      .sql.replace(/\s+/g, ' ')
      .trim();
  const wrap = (db: Db): Db =>
    new Proxy(db, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (typeof value !== 'function') return value;
        if (!STATEMENTS.has(String(prop))) return value.bind(target);
        return (...args: unknown[]) => {
          if (abort.signal.aborted) {
            afterAbort.push(
              prop === 'execute' ? `execute: ${text(target, args[0]).slice(0, 60)}` : String(prop),
            );
          }
          const result = value.apply(target, args);
          if (prop !== 'execute') return result;
          return (result as Promise<unknown>).then((out) => {
            if (!abort.signal.aborted && trigger.test(text(target, args[0]))) {
              abort.abort(new Error('interrupted (SIGINT)'));
            }
            return out;
          });
        };
      },
    });
  const base = ADAPTERS['fec-bulk'];
  const adapter = {
    ...base,
    // A new adapter version, so the same fixture is loaded again instead of deduplicated.
    version: 'fec-bulk@cancel-test',
    load: (records: AsyncIterable<unknown>, ctx: LoadContext) =>
      base.load(records as never, { ...ctx, db: wrap(ctx.db) }),
  } as SourceAdapter<unknown>;
  return { ...ADAPTERS, 'fec-bulk': adapter } as Partial<typeof ADAPTERS>;
}

const factCounts = async () => {
  const { ingest_run: _runs, ...facts } = await tableCounts(handle.db);
  return facts;
};

describe('FEC cancellation at statement boundaries (H3R2-02)', () => {
  const cases: [string, RegExp][] = [
    ['pas2: right after the kept table is built', /^create temp table fec_pas2_kept/],
    ['pas2: right after the first kept page is read', /^select \* from "fec_pas2_kept"/],
    ['IE: right after the kept table is built', /^create temp table fec_ie_kept/],
    ['IE: right after the first kept page is read', /^select \* from "fec_ie_kept"/],
  ];
  for (const [name, trigger] of cases) {
    it(`an abort ${name} issues no further statement and rolls back`, async () => {
      const rt = await testRuntime(handle);
      await ingestFixture(rt, 'congress-legislators');
      const loaded = await ingestFixture(rt, 'fec-bulk');
      expect(loaded.status).toBe('succeeded');
      const before = await factCounts();

      const abort = new AbortController();
      const afterAbort: string[] = [];
      const receipt = await ingestFixture(
        await testRuntime(handle, {
          signal: abort.signal,
          adapters: abortAfter(trigger, abort, afterAbort),
        }),
        'fec-bulk',
      );
      expect(abort.signal.aborted).toBe(true);
      expect(afterAbort).toEqual([]);
      expect(receipt.status).toBe('cancelled');
      expect(receipt.error).toMatch(/^cancelled: interrupted \(SIGINT\)\. Rolled back/);
      expect(await factCounts()).toEqual(before);
    });
  }
});
