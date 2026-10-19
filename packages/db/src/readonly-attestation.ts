import pg from 'pg';
import {
  type DbConfig,
  type EnvVars,
  INTERACTIVE_POOL_DEFAULTS,
  OWNER_CREDENTIALS_ACK,
} from './client';

/**
 * Read-only credential attestation (DECISIONS A44, A61). `dbConfigFromEnv({ readOnly: true })`
 * only checks that `DATABASE_URL_READONLY` is set; this asks the database what that login can
 * actually do. Web, MCP and `ingest:report` run it before their first read.
 */

/** What the connected session can do, from the catalog. No names, no URLs. */
export interface ReadOnlySessionFacts {
  superuser: boolean;
  createRole: boolean;
  createDb: boolean;
  /** Relations (tables, views, matviews, sequences) in application schemas whose owner the login is a member of. */
  ownedRelations: number;
  /** Tables/views with INSERT, UPDATE, DELETE, TRUNCATE or TRIGGER for the login. */
  writableRelations: number;
  /** Sequences the login can advance or set (USAGE or UPDATE). */
  writableSequences: number;
  /** CREATE on any application schema. */
  createOnSchema: boolean;
  /** CREATE on the database (new schemas). */
  createOnDatabase: boolean;
  /** The login's effective `default_transaction_read_only` at connect time. */
  defaultReadOnly: boolean;
}

/** A way to write, or to gain the right to write: refused in production unless acknowledged. */
export type ReadOnlyProblem =
  | 'superuser'
  | 'create_role'
  | 'create_db'
  | 'owns_relations'
  | 'writable_relations'
  | 'writable_sequences'
  | 'create_on_schema'
  | 'create_on_database';

/**
 * A missing second line of defence. A44 says login roles *should* set it; `begin read write`
 * overrides it, so privileges are the boundary and this alone never refuses.
 */
export type ReadOnlyWarning = 'default_transaction_read_only_off';

export interface ReadOnlyVerdict {
  action: 'accept' | 'warn' | 'refuse';
  problems: ReadOnlyProblem[];
  warnings: ReadOnlyWarning[];
  /** Operator-facing text; never contains a URL or role name. */
  message: string;
}

export type ReadOnlyAttestation =
  | { action: 'skipped' }
  /** The check could not run (connection or query failure). `code` is an errno or SQLSTATE. */
  | { action: 'unverified'; code?: string }
  | (ReadOnlyVerdict & { facts: ReadOnlySessionFacts });

const APPLICATION_SCHEMA = `n.nspname not in ('pg_catalog', 'information_schema')
       and n.nspname not like 'pg\\_toast%' and n.nspname not like 'pg\\_temp%'`;

/**
 * One round trip over the catalog, as the session under test. The privilege functions sit
 * inside CASE because the planner may evaluate quals in any order, and
 * `has_sequence_privilege` on a table raises 42809.
 */
export const READ_ONLY_ATTESTATION_SQL = `
select
  r.rolsuper as superuser,
  r.rolcreaterole as create_role,
  r.rolcreatedb as create_db,
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where ${APPLICATION_SCHEMA} and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
       and pg_has_role(c.relowner, 'MEMBER')) as owned_relations,
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where ${APPLICATION_SCHEMA}
       and case when c.relkind in ('r', 'p', 'v', 'f')
         then has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER')
         else false end) as writable_relations,
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where ${APPLICATION_SCHEMA}
       and case when c.relkind = 'S'
         then has_sequence_privilege(c.oid, 'USAGE, UPDATE')
         else false end) as writable_sequences,
  exists (select 1 from pg_namespace n
     where ${APPLICATION_SCHEMA} and has_schema_privilege(n.oid, 'CREATE')) as create_on_schema,
  has_database_privilege(current_database(), 'CREATE') as create_on_database,
  current_setting('default_transaction_read_only') = 'on' as default_read_only
from pg_roles r
where r.rolname = current_user`;

/** Pure: which facts are write paths (problems) and which are missing hardening (warnings). */
export function assessReadOnlySession(facts: ReadOnlySessionFacts): {
  problems: ReadOnlyProblem[];
  warnings: ReadOnlyWarning[];
} {
  const problems: ReadOnlyProblem[] = [];
  if (facts.superuser) problems.push('superuser');
  if (facts.createRole) problems.push('create_role');
  if (facts.createDb) problems.push('create_db');
  if (facts.ownedRelations > 0) problems.push('owns_relations');
  if (facts.writableRelations > 0) problems.push('writable_relations');
  if (facts.writableSequences > 0) problems.push('writable_sequences');
  if (facts.createOnSchema) problems.push('create_on_schema');
  if (facts.createOnDatabase) problems.push('create_on_database');
  const warnings: ReadOnlyWarning[] = facts.defaultReadOnly
    ? []
    : ['default_transaction_read_only_off'];
  return { problems, warnings };
}

/**
 * Pure: production refuses a login with any write path unless `DB_ALLOW_OWNER_CREDENTIALS=1`
 * (the same acknowledgement A61 uses for the owner URL). Everything else at most warns.
 */
export function readOnlyVerdict(facts: ReadOnlySessionFacts, env: EnvVars): ReadOnlyVerdict {
  const { problems, warnings } = assessReadOnlySession(facts);
  const acknowledged = env[OWNER_CREDENTIALS_ACK]?.trim() === '1';
  if (problems.length > 0) {
    const refuse = env.NODE_ENV === 'production' && !acknowledged;
    const what = `The read-only database login can write (${problems.join(', ')}).`;
    return {
      action: refuse ? 'refuse' : 'warn',
      problems,
      warnings,
      message: refuse
        ? `${what} Point DATABASE_URL_READONLY at a login in civic_readonly ` +
          `(scripts/db/roles.sql, docs/OPERATIONS.md), or set ${OWNER_CREDENTIALS_ACK}=1 ` +
          'to run with these rights anyway.'
        : `${what} Allowed ${acknowledged ? `by ${OWNER_CREDENTIALS_ACK}=1` : 'outside production'}.`,
    };
  }
  if (warnings.length > 0) {
    return {
      action: 'warn',
      problems,
      warnings,
      message:
        'The read-only database login does not set default_transaction_read_only = on ' +
        '(docs/OPERATIONS.md "Database roles"). Privileges are select-only, so it may run.',
    };
  }
  return { action: 'accept', problems, warnings, message: 'Read-only database login verified.' };
}

interface FactsRow {
  superuser: boolean;
  create_role: boolean;
  create_db: boolean;
  owned_relations: number;
  writable_relations: number;
  writable_sequences: number;
  create_on_schema: boolean;
  create_on_database: boolean;
  default_read_only: boolean;
}

/** The SQLSTATE or errno of a failure; never its message (it can carry host or user names). */
function safeCode(error: unknown): string | undefined {
  try {
    const value = Object.getOwnPropertyDescriptor(error, 'code')?.value;
    return typeof value === 'string' && /^[A-Z0-9_]{1,32}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Connects once with the read-only consumer's own connection string (no pool, no session
 * overrides, so `default_transaction_read_only` is the role's real default), runs the catalog
 * query and decides. PGlite is skipped: it has no roles.
 */
export async function attestReadOnlyCredentials(
  config: DbConfig,
  env: EnvVars,
): Promise<ReadOnlyAttestation> {
  if (config.kind !== 'pg') return { action: 'skipped' };
  const client = new pg.Client({
    connectionString: config.url,
    connectionTimeoutMillis: config.connectTimeoutMs ?? INTERACTIVE_POOL_DEFAULTS.connectTimeoutMs,
    statement_timeout: config.statementTimeoutMs ?? INTERACTIVE_POOL_DEFAULTS.statementTimeoutMs,
  });
  // A connection error after connect() must not become an unhandled 'error' event.
  client.on('error', () => {});
  try {
    await client.connect();
    const result = await client.query<FactsRow>(READ_ONLY_ATTESTATION_SQL);
    const row = result.rows[0];
    if (!row) return { action: 'unverified', code: 'NO_ROLE_ROW' };
    const facts: ReadOnlySessionFacts = {
      superuser: row.superuser,
      createRole: row.create_role,
      createDb: row.create_db,
      ownedRelations: row.owned_relations,
      writableRelations: row.writable_relations,
      writableSequences: row.writable_sequences,
      createOnSchema: row.create_on_schema,
      createOnDatabase: row.create_on_database,
      defaultReadOnly: row.default_read_only,
    };
    return { ...readOnlyVerdict(facts, env), facts };
  } catch (error) {
    const code = safeCode(error);
    return code ? { action: 'unverified', code } : { action: 'unverified' };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Thrown by a gate: `refused` (permanent) or `unverified` (this attempt only). The message is
 * safe to log.
 */
export class ReadOnlyCredentialsError extends Error {
  override name = 'ReadOnlyCredentialsError';
  constructor(
    readonly kind: 'refused' | 'unverified',
    message: string,
    readonly problems: ReadOnlyProblem[] = [],
  ) {
    super(message);
  }
}

/**
 * Memoized first-use gate. Accept, warn and skip open it for the life of the process; a
 * refusal closes it permanently (every later call rejects without another round trip); an
 * unverified attempt rejects that call only (or, with `blockUnverified: false`, lets it pass)
 * and is retried by the next, so a database that is down at startup is attested once it is
 * reachable. Each decisive outcome is reported once;
 * a throwing reporter cannot change the decision.
 */
export function createReadOnlyGate(
  attest: () => Promise<ReadOnlyAttestation>,
  report: (attestation: ReadOnlyAttestation) => void,
  options: { blockUnverified?: boolean } = {},
): () => Promise<void> {
  const blockUnverified = options.blockUnverified ?? true;
  let decided: Promise<void> | undefined;
  let pending: Promise<void> | undefined;
  const safeReport = (attestation: ReadOnlyAttestation) => {
    try {
      report(attestation);
    } catch {
      // Diagnostics never decide whether credentials are acceptable.
    }
  };
  const run = async (): Promise<void> => {
    let attestation: ReadOnlyAttestation;
    try {
      attestation = await attest();
    } catch (error) {
      const code = safeCode(error);
      attestation = code ? { action: 'unverified', code } : { action: 'unverified' };
    }
    safeReport(attestation);
    if (attestation.action === 'unverified') {
      // Development: never block on a check that could not run; production fails closed.
      if (!blockUnverified) return;
      throw new ReadOnlyCredentialsError(
        'unverified',
        'The read-only database credentials could not be verified (database unreachable?). ' +
          'Retrying on the next request.',
      );
    }
    if (attestation.action === 'refuse') {
      decided = Promise.reject(
        new ReadOnlyCredentialsError('refused', attestation.message, attestation.problems),
      );
      decided.catch(() => {});
      return decided;
    }
    decided = Promise.resolve();
  };
  return () => {
    if (decided) return decided;
    pending ??= run().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
