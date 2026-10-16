import {
  type CapabilityContext,
  createDb,
  type DbHandle,
  dispatchByName,
  publicCapabilities,
} from '@civic-ledger/core';
import { runMigrations } from '@civic-ledger/db/migrate';
import { seedDevData } from '@civic-ledger/db/seed';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCapabilityHandler } from '../apps/web/src/server/api/handler';
import { createLogger } from '../apps/web/src/server/api/logger';
import { ORIGIN, POST_ONLY, plain, toQuery } from '../apps/web/test/stack';
import { type MigratedDatabase, migratedDatabase } from './helpers';

/**
 * Representative inputs for every public capability, run against seeded Postgres and compared
 * with the same inputs on seeded PGlite (the engine the default suite uses) and through the
 * real /api/v1 handler. Differences between engines (ordering, casts, timestamps) show here.
 */
let pgDb: MigratedDatabase;
let lite: DbHandle;
let pgCtx: CapabilityContext;
let liteCtx: CapabilityContext;
let cases: Record<string, Array<Record<string, unknown>>>;

/** Wall-clock stamps (read-model refresh times) differ between two seeds; shape must not. */
const stamps = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<time>'),
  );

beforeAll(async () => {
  pgDb = await migratedDatabase();
  await seedDevData(pgDb.handle.db);
  lite = createDb({ kind: 'pglite' });
  await runMigrations(lite);
  await seedDevData(lite.db);
  pgCtx = { db: pgDb.handle.db };
  liteCtx = { db: lite.db };

  const people = (await dispatchByName('people.search', { limit: 100 }, pgCtx)) as {
    items: Array<{ slug: string }>;
  };
  const [a, b, c] = people.items.map((p) => p.slug) as [string, string, string];
  let withPromises = a;
  for (const { slug } of people.items) {
    const result = (await dispatchByName('promises.list', { slug }, pgCtx)) as {
      summary: { total: number };
    };
    if (result.summary.total > 0) {
      withPromises = slug;
      break;
    }
  }
  const frameworks = (await dispatchByName('frameworks.list', {}, pgCtx)) as {
    items: Array<{ spec: Record<string, unknown> }>;
  };
  const spec = frameworks.items[0]?.spec;
  if (!spec) throw new Error('Seed has no framework');

  cases = {
    'people.search': [
      {},
      { q: 'a', chamber: 'senate', limit: 5, offset: 1 },
      { state: 'ZY' },
      { party: 'Harbor Party', limit: 3 },
    ],
    'people.get': [{ slug: a }, { slug: b }],
    'people.compare': [{ slugs: [a, b] }, { slugs: [a, b, c] }],
    'explore.table': [
      {},
      {
        filters: { chamber: 'house' },
        sort: [{ column: 'totalReceiptsCents', direction: 'desc' }, { column: 'sortName' }],
        limit: 10,
      },
      { filters: { state: 'ZV', q: 'a' }, limit: 5, offset: 2 },
    ],
    'money.summary': [{ slug: a }, { slug: a, cycle: 2024 }],
    'votes.list': [
      { slug: a, limit: 5 },
      { policyArea: 'education', congress: 119, chamber: 'senate' },
      { limit: 3, offset: 1 },
    ],
    'scores.list': [{ slug: a }, { slug: c }],
    'promises.list': [{ slug: withPromises }, { slug: withPromises, status: 'kept' }],
    'policy.areas': [{}],
    'frameworks.list': [{}],
    'frameworks.evaluate': [
      { framework: spec, limit: 5 },
      { framework: spec, people: { chamber: 'senate' }, limit: 3, offset: 1 },
      { framework: spec, people: { slugs: [a, b] } },
    ],
    'sources.status': [{}],
    'explore.facets': [{}],
  };
});

afterAll(async () => {
  await lite?.close();
  await pgDb?.cleanup();
});

const names = publicCapabilities().map((c) => c.name);

describe('public capabilities on real Postgres', () => {
  it('has representative inputs for every public capability', () => {
    expect(Object.keys(cases).sort()).toEqual([...names].sort());
  });

  it.each(names)('%s matches PGlite and answers 200 over /api/v1', async (name) => {
    const handler = createCapabilityHandler({
      context: () => pgCtx,
      logger: createLogger({ level: 'silent' }),
    });
    for (const input of cases[name] ?? []) {
      const onPg = plain(await dispatchByName(name, input, pgCtx));
      const onLite = plain(await dispatchByName(name, input, liteCtx));
      expect(stamps(onPg), `${name} ${JSON.stringify(input)}: Postgres vs PGlite`).toEqual(
        stamps(onLite),
      );

      const post = POST_ONLY.has(name);
      const query = post || Object.keys(input).length === 0 ? '' : `?${toQuery(input)}`;
      const response = await handler(
        new Request(
          `${ORIGIN}/api/v1/${name}${query}`,
          post
            ? {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(input),
              }
            : { method: 'GET' },
        ),
        name,
      );
      expect(response.status, `${name} ${JSON.stringify(input)} over HTTP`).toBe(200);
      expect(await response.json()).toEqual(onPg);
    }
  });

  it('reports the same invalid-input error body as PGlite', async () => {
    const failure = (ctx: CapabilityContext) =>
      dispatchByName('people.search', { limit: 0 }, ctx).then(
        () => null,
        (error: { toBody(): unknown }) => error.toBody(),
      );
    expect(await failure(pgCtx)).toEqual(await failure(liteCtx));
    expect(await failure(pgCtx)).not.toBeNull();
  });
});
