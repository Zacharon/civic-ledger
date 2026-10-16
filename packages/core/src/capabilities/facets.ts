import { type Db, personCard } from '@civic-ledger/db';
import { asc, isNotNull, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { ChamberSchema, EmptyInputSchema, PartySchema, StateCodeSchema } from '../schemas/common';

const countOf = <T extends z.ZodType>(value: T) => z.object({ value, count: z.int().min(1) });

export const ExploreFacetsOutput = z.object({
  chambers: z.array(countOf(ChamberSchema)),
  states: z.array(countOf(StateCodeSchema)),
  parties: z.array(countOf(PartySchema)),
  total: z.int().min(0).describe('People in person_card'),
});

/**
 * Filter vocabularies for explore.table, read from the data rather than hardcoded:
 * states, parties and chambers that actually occur, with counts. Nulls are omitted.
 */
export const exploreFacets = defineCapability({
  name: 'explore.facets',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary: 'Chambers, states and parties present in the Explore table, with person counts.',
  input: EmptyInputSchema,
  output: ExploreFacetsOutput,
  async handler({ db }) {
    const [chambers, states, parties, total] = await Promise.all([
      distinctCounts(db, personCard.chamber),
      distinctCounts(db, personCard.state),
      distinctCounts(db, personCard.party),
      db.select({ count: sql<number>`count(*)::int` }).from(personCard),
    ]);
    return {
      chambers: chambers.flatMap((c) => {
        const chamber = ChamberSchema.safeParse(c.value);
        return chamber.success ? [{ value: chamber.data, count: c.count }] : [];
      }),
      states,
      parties,
      total: total[0]?.count ?? 0,
    };
  },
});

async function distinctCounts(db: Db, column: PgColumn) {
  const value = sql<string>`${column}::text`;
  return db
    .select({ value, count: sql<number>`count(*)::int` })
    .from(personCard)
    .where(isNotNull(column))
    .groupBy(column)
    .orderBy(asc(column));
}
