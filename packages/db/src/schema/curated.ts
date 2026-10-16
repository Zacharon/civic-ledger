import { sql } from 'drizzle-orm';
import {
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { person } from './identity';
import { bill, policyArea, rollcall } from './legislation';
import { provenanceColumns, provenanceIndexes } from './provenance';

export const PROMISE_STATUSES = [
  'kept',
  'compromise',
  'broken',
  'in_progress',
  'stalled',
  'not_yet_rated',
] as const;
export const promiseStatus = pgEnum('promise_status', PROMISE_STATUSES);

export const FRAMEWORK_TARGET_KINDS = ['rollcall', 'bill'] as const;
export const frameworkTargetKind = pgEnum('framework_target_kind', FRAMEWORK_TARGET_KINDS);

export const ALIGNED_POSITIONS = ['yea', 'nay'] as const;
export const alignedPosition = pgEnum('aligned_position', ALIGNED_POSITIONS);

export interface Evidence {
  url: string;
  title: string;
  note?: string;
}

/** Curated from data/curated/promises (git-reviewed, DECISIONS D3). */
export const promise = pgTable(
  'promise',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    promiseKey: text('promise_key').notNull().unique(),
    personId: integer('person_id')
      .notNull()
      .references(() => person.id),
    policyAreaId: text('policy_area_id').references(() => policyArea.id),
    statement: text('statement').notNull(),
    madeOn: date('made_on'),
    sourceUrl: text('source_url').notNull(),
    ...provenanceColumns(),
  },
  (t) => [
    index('promise_person_idx').on(t.personId),
    index('promise_policy_area_idx').on(t.policyAreaId),
    ...provenanceIndexes('promise', t),
  ],
);

export const promiseRating = pgTable(
  'promise_rating',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    promiseId: integer('promise_id')
      .notNull()
      .references(() => promise.id),
    rater: text('rater').notNull(),
    status: promiseStatus('status').notNull(),
    ratedOn: date('rated_on').notNull(),
    summary: text('summary'),
    evidence: jsonb('evidence').$type<Evidence[]>().notNull().default([]),
    ...provenanceColumns(),
  },
  (t) => [
    unique('promise_rating_natural_key').on(t.promiseId, t.rater),
    ...provenanceIndexes('promise_rating', t),
  ],
);

/** Curated from data/curated/platforms: a stated stance per policy area and cycle. */
export const platformPosition = pgTable(
  'platform_position',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    personId: integer('person_id')
      .notNull()
      .references(() => person.id),
    cycle: integer('cycle').notNull(),
    policyAreaId: text('policy_area_id')
      .notNull()
      .references(() => policyArea.id),
    stance: text('stance').notNull(),
    sourceUrl: text('source_url').notNull(),
    ...provenanceColumns(),
  },
  (t) => [
    unique('platform_position_natural_key').on(t.personId, t.cycle, t.policyAreaId),
    index('platform_position_policy_area_idx').on(t.policyAreaId),
    ...provenanceIndexes('platform_position', t),
  ],
);

/** Pre-built frameworks from data/curated/frameworks. User frameworks are never stored. */
export const framework = pgTable(
  'framework',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    slug: text('slug').notNull(),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    author: text('author').notNull(),
    statedOrientation: text('stated_orientation').notNull(),
    description: text('description').notNull(),
    methodologyUrl: text('methodology_url'),
    ...provenanceColumns(),
  },
  (t) => [
    unique('framework_natural_key').on(t.slug, t.version),
    ...provenanceIndexes('framework', t),
  ],
);

/** One rule targets either a rollcall or a bill (resolved to its final-passage rollcalls). */
export const frameworkRule = pgTable(
  'framework_rule',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    frameworkId: integer('framework_id')
      .notNull()
      .references(() => framework.id),
    targetKind: frameworkTargetKind('target_kind').notNull(),
    rollcallId: integer('rollcall_id').references(() => rollcall.id),
    billId: integer('bill_id').references(() => bill.id),
    alignedPosition: alignedPosition('aligned_position').notNull(),
    weight: doublePrecision('weight').notNull().default(1),
    rationale: text('rationale'),
    ...provenanceColumns(),
  },
  (t) => [
    unique('framework_rule_natural_key')
      .on(t.frameworkId, t.rollcallId, t.billId)
      .nullsNotDistinct(),
    index('framework_rule_rollcall_idx').on(t.rollcallId),
    index('framework_rule_bill_idx').on(t.billId),
    check(
      'framework_rule_one_target',
      sql`(${t.targetKind} = 'rollcall' and ${t.rollcallId} is not null and ${t.billId} is null) or (${t.targetKind} = 'bill' and ${t.billId} is not null and ${t.rollcallId} is null)`,
    ),
    ...provenanceIndexes('framework_rule', t),
  ],
);
