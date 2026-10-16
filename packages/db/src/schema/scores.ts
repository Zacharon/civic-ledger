import {
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

/** Scorecard scores are ingested only when terms are `cleared` (DECISIONS D2). */
export const TERMS_STATUSES = ['not_reviewed', 'pending', 'cleared', 'declined'] as const;
export const termsStatus = pgEnum('terms_status', TERMS_STATUSES);

/** Roll-call based ideology estimates, e.g. Voteview DW-NOMINATE. */
export const ideologyScore = pgTable(
  'ideology_score',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    personId: integer('person_id')
      .notNull()
      .references(() => person.id),
    congress: integer('congress').notNull(),
    method: text('method').notNull(),
    dim1: doublePrecision('dim1').notNull(),
    dim2: doublePrecision('dim2'),
    ...provenanceColumns(),
  },
  (t) => [
    unique('ideology_score_natural_key').on(t.personId, t.congress, t.method),
    ...provenanceIndexes('ideology_score', t),
  ],
);

export const scorecardPublisher = pgTable(
  'scorecard_publisher',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    selfDescribedOrientation: text('self_described_orientation').notNull(),
    termsStatus: termsStatus('terms_status').notNull().default('not_reviewed'),
    url: text('url').notNull(),
    methodologyUrl: text('methodology_url').notNull(),
    ...provenanceColumns(),
  },
  (t) => [...provenanceIndexes('scorecard_publisher', t)],
);

export const scorecardScore = pgTable(
  'scorecard_score',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    publisherId: text('publisher_id')
      .notNull()
      .references(() => scorecardPublisher.id),
    personId: integer('person_id')
      .notNull()
      .references(() => person.id),
    year: integer('year').notNull(),
    score: doublePrecision('score').notNull(),
    scaleMin: doublePrecision('scale_min').notNull(),
    scaleMax: doublePrecision('scale_max').notNull(),
    scaleLabel: text('scale_label').notNull(),
    methodologyUrl: text('methodology_url').notNull(),
    ...provenanceColumns(),
  },
  (t) => [
    unique('scorecard_score_natural_key').on(t.publisherId, t.personId, t.year),
    index('scorecard_score_person_idx').on(t.personId),
    ...provenanceIndexes('scorecard_score', t),
  ],
);
