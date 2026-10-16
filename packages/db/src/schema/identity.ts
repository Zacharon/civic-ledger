import { date, index, integer, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { provenanceColumns, provenanceIndexes } from './provenance';

export const IDENTIFIER_SCHEMES = [
  'bioguide',
  'fec_candidate',
  'icpsr',
  'opensecrets',
  'govtrack',
  'openstates',
  'wikidata',
] as const;
export const identifierScheme = pgEnum('identifier_scheme', IDENTIFIER_SCHEMES);

export const OFFICE_LEVELS = ['federal', 'state'] as const;
export const officeLevel = pgEnum('office_level', OFFICE_LEVELS);

export const CHAMBERS = ['house', 'senate'] as const;
export const chamber = pgEnum('chamber', CHAMBERS);

export const CANDIDACY_OUTCOMES = ['won', 'lost', 'withdrew', 'pending'] as const;
export const candidacyOutcome = pgEnum('candidacy_outcome', CANDIDACY_OUTCOMES);

export const person = pgTable(
  'person',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    slug: text('slug').notNull().unique(),
    fullName: text('full_name').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    birthDate: date('birth_date'),
    ...provenanceColumns(),
  },
  (t) => [...provenanceIndexes('person', t)],
);

export const personIdentifier = pgTable(
  'person_identifier',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    personId: integer('person_id')
      .notNull()
      .references(() => person.id),
    scheme: identifierScheme('scheme').notNull(),
    value: text('value').notNull(),
    ...provenanceColumns(),
  },
  (t) => [
    unique('person_identifier_natural_key').on(t.scheme, t.value),
    index('person_identifier_person_idx').on(t.personId),
    ...provenanceIndexes('person_identifier', t),
  ],
);

/** A seat-defining office. Senate seats have no district; at-large House seats use district 0. */
export const office = pgTable(
  'office',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    level: officeLevel('level').notNull(),
    chamber: chamber('chamber').notNull(),
    state: text('state').notNull(),
    district: integer('district'),
  },
  (t) => [
    unique('office_natural_key').on(t.level, t.chamber, t.state, t.district).nullsNotDistinct(),
  ],
);

export const term = pgTable(
  'term',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    personId: integer('person_id')
      .notNull()
      .references(() => person.id),
    officeId: integer('office_id')
      .notNull()
      .references(() => office.id),
    party: text('party').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    ...provenanceColumns(),
  },
  (t) => [
    unique('term_natural_key').on(t.personId, t.officeId, t.startDate),
    index('term_office_idx').on(t.officeId),
    ...provenanceIndexes('term', t),
  ],
);

export const candidacy = pgTable(
  'candidacy',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    personId: integer('person_id')
      .notNull()
      .references(() => person.id),
    cycle: integer('cycle').notNull(),
    officeId: integer('office_id')
      .notNull()
      .references(() => office.id),
    fecCandidateId: text('fec_candidate_id'),
    party: text('party').notNull(),
    outcome: candidacyOutcome('outcome'),
    ...provenanceColumns(),
  },
  (t) => [
    unique('candidacy_natural_key').on(t.personId, t.cycle, t.officeId),
    index('candidacy_office_idx').on(t.officeId),
    index('candidacy_fec_candidate_idx').on(t.fecCandidateId),
    ...provenanceIndexes('candidacy', t),
  ],
);
