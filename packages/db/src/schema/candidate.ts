import { index, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { person } from './identity';
import { provenanceColumns, provenanceIndexes } from './provenance';

/** FEC candidate master (`cn`) office codes kept here. Presidential candidates are not loaded. */
export const CANDIDATE_OFFICES = ['H', 'S'] as const;

/**
 * Every House and Senate candidate the FEC lists for an election year, as filed (DECISIONS A21,
 * amended 2026-10-20: the FEC candidate master is the candidate identity source for races).
 * `person_id` is set only when the FEC id maps to a Bioguide person through
 * `person_identifier`; candidates without one are never minted as `person` rows.
 * Code columns (`party_code`, `incumbency`, `status`) keep the FEC's own values.
 */
export const candidate = pgTable(
  'candidate',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    fecCandidateId: text('fec_candidate_id').notNull(),
    /** Cycle of the FEC bulk file this row came from (equals `election_year` for rows kept). */
    cycle: integer('cycle').notNull(),
    /** CAND_NAME as filed: "LAST, FIRST MIDDLE SUFFIX", upper case. Null when the FEC row has none. */
    nameAsFiled: text('name_as_filed'),
    /** CAND_PTY_AFFILIATION: FEC party code such as DEM, REP, LIB, IND, NPA. */
    partyCode: text('party_code'),
    electionYear: integer('election_year').notNull(),
    /** CAND_OFFICE: 'H' or 'S'. */
    office: text('office').notNull(),
    state: text('state').notNull(),
    /** House district as filed: 0 = FEC "00"; null = blank (and every Senate row). */
    district: integer('district'),
    /** CAND_ICI: I = incumbent, C = challenger, O = open seat; null when the FEC leaves it blank. */
    incumbency: text('incumbency'),
    /** CAND_STATUS: C = statutory candidate, F = future, N = not yet a statutory candidate, P = prior. */
    status: text('status'),
    /** CAND_PCC: principal campaign committee id. */
    principalCommitteeId: text('principal_committee_id'),
    personId: integer('person_id').references(() => person.id),
    ...provenanceColumns(),
  },
  (t) => [
    unique('candidate_natural_key').on(t.fecCandidateId, t.cycle),
    index('candidate_seat_idx').on(t.cycle, t.office, t.state, t.district),
    index('candidate_person_idx').on(t.personId),
    ...provenanceIndexes('candidate', t),
  ],
);
