import { type Db, personCard } from '@civic-ledger/db';
import { and, asc, count, eq, isNotNull, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { ChamberSchema, PartySchema, StateCodeSchema } from '../schemas/common';
import { isCurrentMember, MemberScopeSchema, scopeWhere } from './person-card';

const countOf = <T extends z.ZodType>(value: T) => z.object({ value, count: z.int().min(1) });

/** Rows with a value (non-null) per Explore field, for the scope's `where`. */
const coverageCounts = {
  tenureYears: count(personCard.tenureYears),
  totalReceiptsCents: count(personCard.totalReceiptsCents),
  pacShare: count(personCard.pacShare),
  smallDollarShare: count(personCard.smallDollarShare),
  industryCodingCoverage: count(personCard.industryCodingCoverage),
  outsideSupportCents: count(personCard.outsideSupportCents),
  outsideOpposeCents: count(personCard.outsideOpposeCents),
  votesEligible: count(personCard.votesEligible),
  missedVoteRate: count(personCard.missedVoteRate),
  dwNominateDim1: count(personCard.dwNominateDim1),
  dwNominateDim2: count(personCard.dwNominateDim2),
  promisesRated: count(personCard.promisesRated),
  promiseKeptRate: count(personCard.promiseKeptRate),
};
const WithDataSchema = z
  .object(
    Object.fromEntries(Object.keys(coverageCounts).map((k) => [k, z.int().min(0)])) as Record<
      keyof typeof coverageCounts,
      z.ZodInt
    >,
  )
  .describe('People in the scope with a value (not "no data") for each Explore field');

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
  districts: z
    .array(z.object({ state: StateCodeSchema, district: z.int().min(0), count: z.int().min(1) }))
    .describe('House seats present in the scope, by state then district (0 = at-large)'),
  total: z.int().min(0).describe('People in the requested scope'),
  withData: WithDataSchema,
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
    const [chambers, states, parties, districts, [withData], [counts]] = await Promise.all([
      distinctCounts(db, personCard.chamber, where),
      distinctCounts(db, personCard.state, where),
      distinctCounts(db, personCard.party, where),
      db
        .select({
          state: personCard.state,
          district: personCard.district,
          count: sql<number>`count(*)::int`,
        })
        .from(personCard)
        .where(
          and(
            eq(personCard.chamber, 'house'),
            isNotNull(personCard.state),
            isNotNull(personCard.district),
            where,
          ),
        )
        .groupBy(personCard.state, personCard.district)
        .orderBy(asc(personCard.state), asc(personCard.district)),
      db.select(coverageCounts).from(personCard).where(where),
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
      districts: districts.flatMap((d) =>
        d.state === null || d.district === null
          ? []
          : [{ state: d.state, district: d.district, count: d.count }],
      ),
      total: scopes[scope],
      withData: withData ?? emptyCoverage(),
    };
  },
});

const emptyCoverage = () =>
  Object.fromEntries(Object.keys(coverageCounts).map((k) => [k, 0])) as Record<
    keyof typeof coverageCounts,
    number
  >;

async function distinctCounts(db: Db, column: PgColumn, scope: SQL | undefined) {
  const value = sql<string>`${column}::text`;
  return db
    .select({ value, count: sql<number>`count(*)::int` })
    .from(personCard)
    .where(and(isNotNull(column), scope))
    .groupBy(column)
    .orderBy(asc(column));
}
