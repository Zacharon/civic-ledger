// Database access for adapters goes through these re-exports so apps depend only on core.
export {
  createDb,
  type Db,
  type DbConfig,
  type DbHandle,
  dbConfigFromEnv,
} from '@civic-ledger/db';

export * from './capabilities/curated';
export * from './capabilities/explore';
export * from './capabilities/frameworks';
export * from './capabilities/money';
export * from './capabilities/people';
export {
  PersonCardRowSchema,
  PersonSummarySchema,
  ScorecardCellSchema,
} from './capabilities/person-card';
export * from './capabilities/policy';
export * from './capabilities/promises';
export * from './capabilities/registry';
export * from './capabilities/scores';
export * from './capabilities/sources';
export * from './capabilities/votes';
export * from './capability';
export * from './contracts/ingest';
export * from './curated/schemas';
export * from './curated/validate';
export * from './dispatch';
export * from './errors';
export * from './frameworks/spec';
export * from './schemas/common';
