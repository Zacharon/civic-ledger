import { personCard, scorecardPublisher } from '@civic-ledger/db';
import { and, eq, ilike, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { CapabilityError } from '../errors';
import {
  ChamberSchema,
  PageSchema,
  PaginationInput,
  PartySchema,
  StateCodeSchema,
} from '../schemas/common';
import { containsPattern, countCards, PersonCardRowSchema, selectCards } from './person-card';

const FIXED_SORT_COLUMNS = [
  'sortName',
  'state',
  'chamber',
  'party',
  'district',
  'tenureYears',
  'dwNominateDim1',
  'dwNominateDim2',
  'totalReceiptsCents',
  'pacShare',
  'smallDollarShare',
  'industryCodingCoverage',
  'outsideSupportCents',
  'outsideOpposeCents',
  'missedVoteRate',
  'promiseKeptRate',
] as const;
type FixedSortColumn = (typeof FIXED_SORT_COLUMNS)[number];

/** Allowlisted person_card sort columns. Every one is indexed (see 0001_person_card.sql). */
export const EXPLORE_SORT_COLUMNS: Record<FixedSortColumn, PgColumn> = {
  sortName: personCard.sortName,
  state: personCard.state,
  chamber: personCard.chamber,
  party: personCard.party,
  district: personCard.district,
  tenureYears: personCard.tenureYears,
  dwNominateDim1: personCard.dwNominateDim1,
  dwNominateDim2: personCard.dwNominateDim2,
  totalReceiptsCents: personCard.totalReceiptsCents,
  pacShare: personCard.pacShare,
  smallDollarShare: personCard.smallDollarShare,
  industryCodingCoverage: personCard.industryCodingCoverage,
  outsideSupportCents: personCard.outsideSupportCents,
  outsideOpposeCents: personCard.outsideOpposeCents,
  missedVoteRate: personCard.missedVoteRate,
  promiseKeptRate: personCard.promiseKeptRate,
};

const SCORECARD_SORT_PREFIX = 'scorecard:';

/** Neutral default: geography, then name. Never an ideological column. */
export const DEFAULT_EXPLORE_SORT = [
  { column: 'state', direction: 'asc' },
  { column: 'sortName', direction: 'asc' },
] as const;

const UNKNOWN_SORT_COLUMN = `Unknown sort column. Use one of: ${FIXED_SORT_COLUMNS.join(', ')}, or scorecard:<publisherId>`;

export const ExploreSortColumnSchema = z.union(
  [
    z.enum(FIXED_SORT_COLUMNS),
    z.string().regex(/^scorecard:[a-z0-9]+(?:-[a-z0-9]+)*$/, UNKNOWN_SORT_COLUMN),
  ],
  { error: UNKNOWN_SORT_COLUMN },
);

const SortSchema = z.object({
  column: ExploreSortColumnSchema,
  direction: z.enum(['asc', 'desc']).default('asc'),
});

export const ExploreTableInput = z.strictObject({
  filters: z
    .strictObject({
      chamber: ChamberSchema.optional(),
      state: StateCodeSchema.optional(),
      party: PartySchema.optional(),
      q: z.string().trim().min(1).max(100).optional().describe('Name contains'),
    })
    .default({}),
  sort: z
    .array(SortSchema)
    .max(3)
    .default([])
    .describe('Empty = state, then name. Nulls sort last.'),
  ...PaginationInput,
});

export const ScorecardColumnSchema = z.object({
  publisherId: z.string(),
  name: z.string(),
  selfDescribedOrientation: z.string(),
  methodologyUrl: z.url(),
});

export const ExploreTableOutput = z.object({
  rows: z.array(PersonCardRowSchema),
  sort: z.array(z.object({ column: z.string(), direction: z.enum(['asc', 'desc']) })),
  scorecardColumns: z
    .array(ScorecardColumnSchema)
    .describe('Attribution for every scorecard column'),
  ...PageSchema,
});

type ExploreSort = z.output<typeof SortSchema>;

export const exploreTable = defineCapability({
  name: 'explore.table',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary: 'Filter, sort and paginate the multi-axis table of officeholders (person_card).',
  input: ExploreTableInput,
  output: ExploreTableOutput,
  async handler({ db }, input) {
    const scorecardColumns = await db
      .select({
        publisherId: scorecardPublisher.id,
        name: scorecardPublisher.name,
        selfDescribedOrientation: scorecardPublisher.selfDescribedOrientation,
        methodologyUrl: scorecardPublisher.methodologyUrl,
      })
      .from(scorecardPublisher)
      .where(eq(scorecardPublisher.termsStatus, 'cleared'))
      .orderBy(scorecardPublisher.id);

    const sort: ExploreSort[] = input.sort.length > 0 ? input.sort : [...DEFAULT_EXPLORE_SORT];
    const cleared = new Set(scorecardColumns.map((c) => c.publisherId));
    const orderBy = [
      ...sort.map((s) => orderTerm(s, cleared)),
      sql`${personCard.sortName} asc`,
      sql`${personCard.personId} asc`,
    ];

    const { chamber, state, party, q } = input.filters;
    const where = and(
      chamber ? eq(personCard.chamber, chamber) : undefined,
      state ? eq(personCard.state, state) : undefined,
      party ? eq(personCard.party, party) : undefined,
      q ? ilike(personCard.fullName, containsPattern(q)) : undefined,
    );

    const [rows, total] = await Promise.all([
      selectCards(db, { where, orderBy, limit: input.limit, offset: input.offset }),
      countCards(db, where),
    ]);
    return { rows, sort, scorecardColumns, total, limit: input.limit, offset: input.offset };
  },
});

const isFixedSortColumn = (column: string): column is FixedSortColumn =>
  Object.hasOwn(EXPLORE_SORT_COLUMNS, column);

function orderTerm(sort: ExploreSort, clearedPublishers: Set<string>): SQL {
  // `direction` is enum-validated, so raw interpolation is safe.
  const direction = sql.raw(sort.direction);
  if (isFixedSortColumn(sort.column)) {
    return sql`${EXPLORE_SORT_COLUMNS[sort.column]} ${direction} nulls last`;
  }
  const publisherId = sort.column.slice(SCORECARD_SORT_PREFIX.length);
  if (!clearedPublishers.has(publisherId)) {
    throw new CapabilityError('invalid_input', `No cleared scorecard publisher "${publisherId}"`, {
      issues: [{ path: 'sort', message: `Unknown scorecard publisher: ${publisherId}` }],
    });
  }
  // Index-backed lookup on person_card_scorecard (person_id, publisher_id).
  return sql`(select s.normalized from person_card_scorecard s where s.person_id = ${personCard.personId} and s.publisher_id = ${publisherId}) ${direction} nulls last`;
}
