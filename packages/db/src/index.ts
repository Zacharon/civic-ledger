export {
  BATCH_POOL_DEFAULTS,
  createDb,
  type Db,
  type DbConfig,
  type DbHandle,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  dbConfigFromEnv,
  defaultPgliteDir,
  type EnvConfigOptions,
  type EnvVars,
  INTERACTIVE_POOL_DEFAULTS,
  type PgPoolSettings,
} from './client';
export { refreshPersonCard } from './read-model';
export {
  assessReadOnlySession,
  attestReadOnlyCredentials,
  createReadOnlyGate,
  type ReadOnlyAttestation,
  ReadOnlyCredentialsError,
  type ReadOnlyProblem,
  type ReadOnlySessionFacts,
  type ReadOnlyVerdict,
  type ReadOnlyWarning,
  readOnlyVerdict,
} from './readonly-attestation';
export * from './schema';
export { conflictUpdateSet } from './upsert';
