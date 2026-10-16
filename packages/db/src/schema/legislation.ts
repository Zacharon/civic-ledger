import { boolean, date, index, integer, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { chamber, person } from './identity';
import { provenanceColumns, provenanceIndexes } from './provenance';

export const VOTE_POSITIONS = ['yea', 'nay', 'present', 'not_voting'] as const;
export const votePositionValue = pgEnum('vote_position_value', VOTE_POSITIONS);

/** Congress.gov policy-area vocabulary (~32 areas): the neutral topic base. */
export const policyArea = pgTable('policy_area', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
});

export const bill = pgTable(
  'bill',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    congress: integer('congress').notNull(),
    billType: text('bill_type').notNull(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    introducedDate: date('introduced_date'),
    sponsorPersonId: integer('sponsor_person_id').references(() => person.id),
    latestActionText: text('latest_action_text'),
    latestActionDate: date('latest_action_date'),
    url: text('url').notNull(),
    ...provenanceColumns(),
  },
  (t) => [
    unique('bill_natural_key').on(t.congress, t.billType, t.number),
    index('bill_sponsor_idx').on(t.sponsorPersonId),
    ...provenanceIndexes('bill', t),
  ],
);

export const billPolicyArea = pgTable(
  'bill_policy_area',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    billId: integer('bill_id')
      .notNull()
      .references(() => bill.id),
    policyAreaId: text('policy_area_id')
      .notNull()
      .references(() => policyArea.id),
    ...provenanceColumns(),
  },
  (t) => [
    unique('bill_policy_area_natural_key').on(t.billId, t.policyAreaId),
    index('bill_policy_area_policy_area_idx').on(t.policyAreaId),
    ...provenanceIndexes('bill_policy_area', t),
  ],
);

export const billSubject = pgTable(
  'bill_subject',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    billId: integer('bill_id')
      .notNull()
      .references(() => bill.id),
    subject: text('subject').notNull(),
    ...provenanceColumns(),
  },
  (t) => [
    unique('bill_subject_natural_key').on(t.billId, t.subject),
    ...provenanceIndexes('bill_subject', t),
  ],
);

/**
 * Voteview rollcall. `number` is Voteview's own `rollnumber`: unique per congress and
 * chamber, continuous across sessions and skipping quorum calls, so it is NOT the clerk's
 * official number. The official number is `clerkNumber` within `session` (restarts each
 * session); BILLSTATUS recorded votes join on (congress, chamber, session, clerkNumber).
 */
export const rollcall = pgTable(
  'rollcall',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    congress: integer('congress').notNull(),
    chamber: chamber('chamber').notNull(),
    number: integer('number').notNull(),
    session: integer('session'),
    clerkNumber: integer('clerk_number'),
    voteDate: date('vote_date').notNull(),
    question: text('question').notNull(),
    description: text('description'),
    result: text('result').notNull(),
    yeaCount: integer('yea_count').notNull(),
    nayCount: integer('nay_count').notNull(),
    ...provenanceColumns(),
  },
  (t) => [
    unique('rollcall_natural_key').on(t.congress, t.chamber, t.number),
    index('rollcall_clerk_idx').on(t.congress, t.chamber, t.session, t.clerkNumber),
    index('rollcall_vote_date_idx').on(t.voteDate),
    ...provenanceIndexes('rollcall', t),
  ],
);

/** Links a rollcall to the bill it acted on; `isFinalPassage` marks the passage vote. */
export const rollcallBill = pgTable(
  'rollcall_bill',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    rollcallId: integer('rollcall_id')
      .notNull()
      .references(() => rollcall.id),
    billId: integer('bill_id')
      .notNull()
      .references(() => bill.id),
    isFinalPassage: boolean('is_final_passage').notNull().default(false),
    ...provenanceColumns(),
  },
  (t) => [
    unique('rollcall_bill_natural_key').on(t.rollcallId, t.billId),
    index('rollcall_bill_bill_idx').on(t.billId),
    ...provenanceIndexes('rollcall_bill', t),
  ],
);

export const votePosition = pgTable(
  'vote_position',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    rollcallId: integer('rollcall_id')
      .notNull()
      .references(() => rollcall.id),
    personId: integer('person_id')
      .notNull()
      .references(() => person.id),
    position: votePositionValue('position').notNull(),
    ...provenanceColumns(),
  },
  (t) => [
    unique('vote_position_natural_key').on(t.rollcallId, t.personId),
    index('vote_position_person_idx').on(t.personId),
    ...provenanceIndexes('vote_position', t),
  ],
);
