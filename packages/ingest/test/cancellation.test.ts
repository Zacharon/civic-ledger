import type { DbHandle } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SourceAdapter } from '../src/adapter';
import { ADAPTERS } from '../src/adapters/registry';
import { freshDb, ingestFixture, rows, testRuntime } from './helpers';

/**
 * H3-04: an operator abort (SIGINT) or the run deadline must stop a run before its effects
 * become visible. The irrevocable boundary is the commit; up to it, an abort rolls back
 * and the receipt says `cancelled`.
 */
let handle: DbHandle;
beforeEach(async () => {
  handle = await freshDb();
});
afterEach(() => handle.close());

const people = async () => {
  const [row] = await rows<{ n: number }>(handle.db, sql`select count(*)::int as n from person`);
  return row?.n ?? 0;
};

/** congress-legislators whose parse stream calls `onRecord(i)` before yielding record i. */
function instrumented(onRecord: (i: number) => void): Partial<typeof ADAPTERS> {
  const base = ADAPTERS['congress-legislators'];
  const adapter: SourceAdapter<unknown> = {
    ...base,
    parse: async function* (snapshot, scope) {
      let i = 0;
      for await (const record of base.parse(snapshot, scope)) {
        onRecord(i++);
        yield record;
      }
    },
  } as SourceAdapter<unknown>;
  return { ...ADAPTERS, 'congress-legislators': adapter } as Partial<typeof ADAPTERS>;
}

describe('cancellation (H3-04)', () => {
  it('P5: a run whose signal is already aborted loads nothing and says cancelled', async () => {
    const abort = new AbortController();
    abort.abort(new Error('interrupted (SIGINT)'));
    const receipt = await ingestFixture(
      await testRuntime(handle, { signal: abort.signal }),
      'congress-legislators',
    );
    expect(await people()).toBe(0);
    expect(receipt.status).toBe('cancelled');
    expect(receipt.error).toMatch(/^cancelled: interrupted \(SIGINT\)/);
  });

  it('an abort during the load rolls the load back', async () => {
    const abort = new AbortController();
    const rt = await testRuntime(handle, {
      signal: abort.signal,
      adapters: instrumented((i) => {
        if (i === 3) abort.abort(new Error('interrupted (SIGINT)'));
      }),
    });
    const receipt = await ingestFixture(rt, 'congress-legislators');
    expect(await people()).toBe(0);
    expect(receipt.status).toBe('cancelled');
  });

  it('an abort during publication (read-model refresh) rolls everything back', async () => {
    const abort = new AbortController();
    const rt = await testRuntime(handle, {
      signal: abort.signal,
      refreshReadModel: async () => {
        abort.abort(new Error('interrupted (SIGINT)'));
      },
    });
    const receipt = await ingestFixture(rt, 'congress-legislators');
    expect(await people()).toBe(0);
    expect(receipt.status).toBe('cancelled');
  });

  it('a whole-run deadline cancels a run that outlives it', async () => {
    const rt = await testRuntime(handle, {
      deadlineMs: 50,
      adapters: instrumented(() => {
        const until = Date.now() + 20;
        while (Date.now() < until) {
          // Busy-wait: a slow parse that crosses the deadline.
        }
      }),
    });
    const receipt = await ingestFixture(rt, 'congress-legislators');
    expect(await people()).toBe(0);
    expect(receipt.status).toBe('cancelled');
    expect(receipt.error).toMatch(/^cancelled: .*deadline/);
  });
});
