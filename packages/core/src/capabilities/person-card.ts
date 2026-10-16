import { type Db, personCard, personCardScorecard } from '@civic-ledger/db';
import { asc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CentsSchema,
  ChamberSchema,
  CongressSchema,
  CycleSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  PartySchema,
  ShareSchema,
  SlugSchema,
  StateCodeSchema,
} from '../schemas/common';

export const ScorecardCellSchema = z.object({
  publisherId: z.string(),
  year: z.int(),
  score: z.number(),
  scaleMin: z.number(),
  scaleMax: z.number(),
});

/** One Explore row. `null` always means "no data", never zero. */
export const PersonCardRowSchema = z.object({
  slug: SlugSchema,
  fullName: z.string(),
  sortName: z.string(),
  party: PartySchema.nullable(),
  state: StateCodeSchema.nullable(),
  chamber: ChamberSchema.nullable(),
  district: z.int().nullable(),
  termStart: IsoDateSchema.nullable(),
  tenureYears: z.number().nullable(),
  ideologyCongress: CongressSchema.nullable(),
  dwNominateDim1: z.number().nullable().describe('DW-NOMINATE dim 1 (academic, roll-call based)'),
  dwNominateDim2: z.number().nullable(),
  moneyCycle: CycleSchema.nullable(),
  totalReceiptsCents: CentsSchema.nullable(),
  pacShare: ShareSchema.nullable(),
  smallDollarShare: ShareSchema.nullable(),
  topIndustries: z.array(z.object({ id: z.string(), name: z.string(), amountCents: CentsSchema })),
  industryCodingCoverage: ShareSchema.nullable().describe(
    'Share of PAC dollars with an industry code',
  ),
  outsideSupportCents: CentsSchema.nullable(),
  outsideOpposeCents: CentsSchema.nullable(),
  votesEligible: z.int().nullable(),
  missedVoteRate: ShareSchema.nullable(),
  promisesRated: z.int().nullable(),
  promiseKeptRate: ShareSchema.nullable(),
  scorecards: z.array(ScorecardCellSchema).describe('Latest score per cleared publisher'),
  refreshedAt: IsoDateTimeSchema,
});
export type PersonCardRow = z.infer<typeof PersonCardRowSchema>;

export const PersonSummarySchema = PersonCardRowSchema.pick({
  slug: true,
  fullName: true,
  party: true,
  state: true,
  chamber: true,
  district: true,
});

type CardRecord = typeof personCard.$inferSelect;

export interface CardQuery {
  where?: SQL | undefined;
  orderBy?: SQL[];
  limit?: number;
  offset?: number;
}

/** Reads person_card rows and attaches each person's cleared scorecard cells. */
export async function selectCards(db: Db, query: CardQuery): Promise<PersonCardRow[]> {
  const orderBy = query.orderBy ?? [asc(personCard.state), asc(personCard.sortName)];
  let builder = db
    .select()
    .from(personCard)
    .where(query.where)
    .orderBy(...orderBy)
    .$dynamic();
  if (query.limit !== undefined) builder = builder.limit(query.limit);
  if (query.offset !== undefined) builder = builder.offset(query.offset);
  const cards = await builder;
  const scorecards = await scorecardsByPerson(
    db,
    cards.map((c) => c.personId),
  );
  return cards.map((card) => toRow(card, scorecards.get(card.personId) ?? []));
}

export async function countCards(db: Db, where: SQL | undefined): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(personCard)
    .where(where);
  return row?.count ?? 0;
}

/** Internal id + row for one slug, or undefined. */
export async function findCard(
  db: Db,
  slug: string,
): Promise<{ personId: number; row: PersonCardRow } | undefined> {
  const [card] = await db.select().from(personCard).where(eq(personCard.slug, slug)).limit(1);
  if (!card) return undefined;
  const scorecards = await scorecardsByPerson(db, [card.personId]);
  return { personId: card.personId, row: toRow(card, scorecards.get(card.personId) ?? []) };
}

async function scorecardsByPerson(
  db: Db,
  personIds: number[],
): Promise<Map<number, z.infer<typeof ScorecardCellSchema>[]>> {
  const byPerson = new Map<number, z.infer<typeof ScorecardCellSchema>[]>();
  if (personIds.length === 0) return byPerson;
  const cells = await db
    .select()
    .from(personCardScorecard)
    .where(inArray(personCardScorecard.personId, personIds))
    .orderBy(asc(personCardScorecard.publisherId));
  for (const { personId, normalized: _normalized, ...cell } of cells) {
    byPerson.set(personId, [...(byPerson.get(personId) ?? []), cell]);
  }
  return byPerson;
}

function toRow(
  { personId: _personId, refreshedAt, ...card }: CardRecord,
  scorecards: PersonCardRow['scorecards'],
): PersonCardRow {
  return { ...card, scorecards, refreshedAt: refreshedAt.toISOString() };
}

/** Escapes LIKE wildcards so user text matches literally. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
