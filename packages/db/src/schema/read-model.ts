import {
  bigint,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgMaterializedView,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { chamber } from './identity';

export interface TopIndustry {
  id: string;
  name: string;
  amountCents: number;
}

/**
 * One row per person: the Explore table's only source. Defined in hand-written
 * migration `0001_person_card.sql`; `.existing()` keeps drizzle-kit from managing it.
 * Shares and rates are fractions in [0, 1]; null means "no data", never zero.
 */
export const personCard = pgMaterializedView('person_card', {
  personId: integer('person_id').notNull(),
  slug: text('slug').notNull(),
  fullName: text('full_name').notNull(),
  sortName: text('sort_name').notNull(),
  party: text('party'),
  state: text('state'),
  chamber: chamber('chamber'),
  district: integer('district'),
  termStart: date('term_start'),
  tenureYears: doublePrecision('tenure_years'),
  ideologyCongress: integer('ideology_congress'),
  dwNominateDim1: doublePrecision('dw_nominate_dim1'),
  dwNominateDim2: doublePrecision('dw_nominate_dim2'),
  moneyCycle: integer('money_cycle'),
  totalReceiptsCents: bigint('total_receipts_cents', { mode: 'number' }),
  pacShare: doublePrecision('pac_share'),
  smallDollarShare: doublePrecision('small_dollar_share'),
  topIndustries: jsonb('top_industries').$type<TopIndustry[]>().notNull(),
  industryCodingCoverage: doublePrecision('industry_coding_coverage'),
  outsideSupportCents: bigint('outside_support_cents', { mode: 'number' }),
  outsideOpposeCents: bigint('outside_oppose_cents', { mode: 'number' }),
  votesEligible: integer('votes_eligible'),
  missedVoteRate: doublePrecision('missed_vote_rate'),
  promisesRated: integer('promises_rated'),
  promiseKeptRate: doublePrecision('promise_kept_rate'),
  refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull(),
}).existing();

/** Latest score per person and cleared publisher, normalized to [0, 1] for sorting. */
export const personCardScorecard = pgMaterializedView('person_card_scorecard', {
  personId: integer('person_id').notNull(),
  publisherId: text('publisher_id').notNull(),
  year: integer('year').notNull(),
  score: doublePrecision('score').notNull(),
  scaleMin: doublePrecision('scale_min').notNull(),
  scaleMax: doublePrecision('scale_max').notNull(),
  normalized: doublePrecision('normalized'),
}).existing();
