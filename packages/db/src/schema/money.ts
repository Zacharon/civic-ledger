import {
  bigint,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { person } from './identity';
import { provenanceColumns, provenanceIndexes } from './provenance';

/** All money amounts are integer cents. */
const cents = (name: string) => bigint(name, { mode: 'number' });

export const SUPPORT_OPPOSE = ['support', 'oppose'] as const;
export const supportOppose = pgEnum('support_oppose', SUPPORT_OPPOSE);

/**
 * `curated`: committee listed by hand; `connected_org` / `name_rule`: keyword rule on the
 * FEC connected organization / committee name; `fec_code`: rule on an FEC code such as
 * designation D (leadership PAC) or organization type L (labor).
 */
export const INDUSTRY_CODING_METHODS = [
  'curated',
  'connected_org',
  'name_rule',
  'fec_code',
] as const;
export const industryCodingMethod = pgEnum('industry_coding_method', INDUSTRY_CODING_METHODS);

/** FEC committee master (`cm`). */
export const committee = pgTable(
  'committee',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    fecCommitteeId: text('fec_committee_id').notNull().unique(),
    name: text('name').notNull(),
    committeeType: text('committee_type'),
    designation: text('designation'),
    party: text('party'),
    /** FEC ORG_TP of the connected organization: C, L, M, T, V, W (see DATA_SOURCES.md). */
    organizationType: text('organization_type'),
    connectedOrganization: text('connected_organization'),
    ...provenanceColumns(),
  },
  (t) => [...provenanceIndexes('committee', t)],
);

/** FEC candidate-committee linkage (`ccl`). */
export const committeeLink = pgTable(
  'committee_link',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    fecCandidateId: text('fec_candidate_id').notNull(),
    committeeId: integer('committee_id')
      .notNull()
      .references(() => committee.id),
    cycle: integer('cycle').notNull(),
    designation: text('designation'),
    ...provenanceColumns(),
  },
  (t) => [
    unique('committee_link_natural_key').on(t.fecCandidateId, t.committeeId, t.cycle),
    index('committee_link_committee_idx').on(t.committeeId),
    ...provenanceIndexes('committee_link', t),
  ],
);

/** FEC all-candidates summary (`weball`) per candidate and cycle. */
export const candidateCycleTotals = pgTable(
  'candidate_cycle_totals',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    fecCandidateId: text('fec_candidate_id').notNull(),
    cycle: integer('cycle').notNull(),
    personId: integer('person_id').references(() => person.id),
    totalReceiptsCents: cents('total_receipts_cents').notNull(),
    individualCents: cents('individual_cents').notNull(),
    unitemizedIndividualCents: cents('unitemized_individual_cents'),
    otherCommitteeCents: cents('other_committee_cents').notNull(),
    partyCents: cents('party_cents').notNull(),
    candidateSelfCents: cents('candidate_self_cents').notNull(),
    totalDisbursementsCents: cents('total_disbursements_cents').notNull(),
    cashOnHandCents: cents('cash_on_hand_cents').notNull(),
    debtsCents: cents('debts_cents').notNull(),
    coverageEndDate: date('coverage_end_date'),
    ...provenanceColumns(),
  },
  (t) => [
    unique('candidate_cycle_totals_natural_key').on(t.fecCandidateId, t.cycle),
    index('candidate_cycle_totals_person_idx').on(t.personId, t.cycle),
    ...provenanceIndexes('candidate_cycle_totals', t),
  ],
);

/**
 * FEC candidate summary (`candidate_summary_<cycle>.csv`): the itemized / unitemized split
 * of individual contributions that weball lacks. Kept apart from `candidate_cycle_totals`
 * because FEC refreshes it on its own schedule: its coverage period often ends a quarter
 * earlier than weball's, so its amounts are only combined with its own total receipts.
 */
export const candidateCycleSummary = pgTable(
  'candidate_cycle_summary',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    fecCandidateId: text('fec_candidate_id').notNull(),
    cycle: integer('cycle').notNull(),
    personId: integer('person_id').references(() => person.id),
    totalReceiptsCents: cents('total_receipts_cents').notNull(),
    individualCents: cents('individual_cents').notNull(),
    itemizedIndividualCents: cents('itemized_individual_cents').notNull(),
    unitemizedIndividualCents: cents('unitemized_individual_cents').notNull(),
    coverageEndDate: date('coverage_end_date'),
    ...provenanceColumns(),
  },
  (t) => [
    unique('candidate_cycle_summary_natural_key').on(t.fecCandidateId, t.cycle),
    index('candidate_cycle_summary_person_idx').on(t.personId, t.cycle),
    ...provenanceIndexes('candidate_cycle_summary', t),
  ],
);

/** Contributions from committees to candidates (`pas2`). */
export const committeeContribution = pgTable(
  'committee_contribution',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    fecSubId: text('fec_sub_id').notNull().unique(),
    committeeId: integer('committee_id')
      .notNull()
      .references(() => committee.id),
    recipientFecCandidateId: text('recipient_fec_candidate_id').notNull(),
    personId: integer('person_id').references(() => person.id),
    cycle: integer('cycle').notNull(),
    amountCents: cents('amount_cents').notNull(),
    transactionDate: date('transaction_date'),
    transactionType: text('transaction_type').notNull(),
    ...provenanceColumns(),
  },
  (t) => [
    index('committee_contribution_committee_idx').on(t.committeeId),
    index('committee_contribution_person_idx').on(t.personId, t.cycle),
    index('committee_contribution_recipient_idx').on(t.recipientFecCandidateId, t.cycle),
    ...provenanceIndexes('committee_contribution', t),
  ],
);

/** FEC independent expenditures (24/48-hour reports). */
export const independentExpenditure = pgTable(
  'independent_expenditure',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    spenderFecCommitteeId: text('spender_fec_committee_id').notNull(),
    fecTransactionId: text('fec_transaction_id').notNull(),
    spenderCommitteeId: integer('spender_committee_id').references(() => committee.id),
    spenderName: text('spender_name').notNull(),
    candidateFecId: text('candidate_fec_id').notNull(),
    personId: integer('person_id').references(() => person.id),
    supportOppose: supportOppose('support_oppose').notNull(),
    cycle: integer('cycle').notNull(),
    amountCents: cents('amount_cents').notNull(),
    expenditureDate: date('expenditure_date'),
    purpose: text('purpose'),
    ...provenanceColumns(),
  },
  (t) => [
    unique('independent_expenditure_natural_key').on(t.spenderFecCommitteeId, t.fecTransactionId),
    index('independent_expenditure_spender_idx').on(t.spenderCommitteeId),
    index('independent_expenditure_person_idx').on(t.personId, t.cycle),
    index('independent_expenditure_candidate_idx').on(t.candidateFecId, t.cycle),
    ...provenanceIndexes('independent_expenditure', t),
  ],
);

/** In-house industry taxonomy (data/curated/industry_map). */
export const industry = pgTable(
  'industry',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    sector: text('sector').notNull(),
    ...provenanceColumns(),
  },
  (t) => [...provenanceIndexes('industry', t)],
);

/** One industry code per committee, so coding coverage is an unambiguous dollar share. */
export const committeeIndustry = pgTable(
  'committee_industry',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    committeeId: integer('committee_id')
      .notNull()
      .references(() => committee.id),
    industryId: text('industry_id')
      .notNull()
      .references(() => industry.id),
    method: industryCodingMethod('method').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    ...provenanceColumns(),
  },
  (t) => [
    unique('committee_industry_natural_key').on(t.committeeId),
    index('committee_industry_industry_idx').on(t.industryId),
    ...provenanceIndexes('committee_industry', t),
  ],
);
