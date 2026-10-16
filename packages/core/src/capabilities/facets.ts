import { type Db, personCard } from '@civic-ledger/db';
import { and, asc, isNotNull, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { ChamberSchema, PartySchema, StateCodeSchema } from '../schemas/common';
import { isCurrentMember, MemberScopeSchema, scopeWhere } from './person-card';

const countOf = <T extends z.ZodType>(value: T) => z.object({ value, count: z.int().min(1) });

export const ExploreFacetsInput = z.strictObject({
  scope: MemberScopeSchema.default('current').describe('Which people the counts cover'),
});

export const ExploreFacetsOutput = z.object({
  scope: MemberScopeSchema,
  scopes: z
    .object({ current: z.int().min(0), all: z.int().min(0) })
    .describe('People in each scope, whatever scope was requested'),
  chambers: z.array(countOf(ChamberSchema)),
  states: z.array(countOf(StateCodeSchema)),
  parties: z.array(countOf(PartySchema)),
  total: z.int().min(0).describe('People in the requested scope'),
});

/**
 * Filter vocabularies for explore.table, read from the data rather than hardcoded:
 * states, parties and chambers that actually occur in the scope, with counts. Nulls are
 * omitted.
 */
export const exploreFacets = defineCapability({
  name: 'explore.facets',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'Chambers, states and parties present in the Explore table, with person counts per scope.',
  input: ExploreFacetsInput,
  output: ExploreFacetsOutput,
  async handler({ db }, { scope }) {
    const where = scopeWhere(scope);
    const [chambers, states, parties, [counts]] = await Promise.all([
      distinctCounts(db, personCard.chamber, where),
      distinctCounts(db, personCard.state, where),
      distinctCounts(db, personCard.party, where),
      db
        .select({
          all: sql<number>`count(*)::int`,
          current: sql<number>`(count(*) filter (where ${isCurrentMember}))::int`,
        })
        .from(personCard),
    ]);
    const scopes = { current: counts?.current ?? 0, all: counts?.all ?? 0 };
    return {
      scope,
      scopes,
      chambers: chambers.flatMap((c) => {
        const chamber = ChamberSchema.safeParse(c.value);
        return chamber.success ? [{ value: chamber.data, count: c.count }] : [];
      }),
      states,
      parties,
      total: scopes[scope],
    };
  },
});

async function distinctCounts(db: Db, column: PgColumn, scope: SQL | undefined) {
  const value = sql<string>`${column}::text`;
  return db
    .select({ value, count: sql<number>`count(*)::int` })
    .from(personCard)
    .where(and(isNotNull(column), scope))
    .groupBy(column)
    .orderBy(asc(column));
}
