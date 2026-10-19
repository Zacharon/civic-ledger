# T-O operations: read-only attestation, log-sink safety, request read budget

Worker: Claude Opus 5.5 (Operations implementer). Branch `claude/ops-preflight-20261019`,
worktree `_worktrees/Civic_Ledger/fix/ops-preflight-20261019`. Base `76b74c3` (0006
contract commit on `8f4a092`). Local only: nothing was pushed, deployed or provisioned,
no hosted database was touched, and no GitHub setting was changed.

## Commits

| Commit | Content |
|---|---|
| `0670018` | Red regressions for O1, O2 and O3 (tests only) |
| `fbb2cd6` | O2: `logSafely` on the health, guard and handler diagnostic paths |
| `a9ca392` | O3: `createReadBudget` plus a budget-aware `observedRead` |
| `675eff7` | O1: `packages/db/src/readonly-attestation.ts`, the web gate (startup and first read), MCP startup check, and wiring of the read budget into `capabilities.ts` |
| (this commit) | Docs: OPERATIONS.md, hosted acceptance plan (O4), this record |

## Red evidence (baseline behaviour, tests committed in `0670018`)

1. `pnpm vitest run apps/web/test/log-sink-failure.test.ts apps/web/test/observed-read-budget.test.ts packages/db/test/readonly-attestation.test.ts`
   exited 1: `Test Files 3 failed (3)`, `Tests 10 failed | 2 passed (12)`.
   - O2, both sink kinds:
     - `health keeps its 503 "down" JSON when the database fails` fails with
       `Error: sink unavailable SYNTHETIC_SINK_SECRET_O2` (the handler rejects, and the
       503 body is lost).
     - The guard's 429 test (API and page) fails the same way.
     - The production fail-closed 503 test also fails: `createGuard` throws while it is
       being built.
     - The development shared-bucket test fails for the throwing destination. It passes
       for the second sink only because the module-level warn-once flag was already set.
   - O3: `createReadBudget is not a function` (3 tests). Baseline has no request scope: a
     timed-out read leaves nothing that a later read could check.
   - O1 unit: `Cannot find module '../src/readonly-attestation'`.
2. `pnpm vitest run --config vitest.pg.config.ts test-pg/readonly-attestation.pgtest.ts`
   exited 1: `Tests 5 failed | 1 passed (6)`.
   - The one test that passes is the **baseline gap characterization**. The production
     static check (`dbConfigFromEnv(..., { readOnly: true })`) accepts a schema-owner
     login in `DATABASE_URL_READONLY`, and that session runs `begin read write; update
     person ...` without error.
   - The 5 refusal and acceptance tests fail with `Cannot find module`, because baseline
     has no attestation at all.

## Green evidence

| Check | Command | Result |
|---|---|---|
| O1 Postgres 17 | `pnpm vitest run --config vitest.pg.config.ts test-pg/readonly-attestation.pgtest.ts` at `675eff7` | exit 0, 6/6 passed (33.5 s) |
| Targeted unit/PGlite | `pnpm vitest run` over 16 files: the new `readonly-gate`, `log-sink-failure` and `observed-read-budget` tests plus `readonly-attestation` (db); existing `observed-read`, `health`, `rate-limit`, `handler`, `db-config`, `server-boundary`, `web-hardening`, `client-readonly`, `client`, `pool-diagnostics`, MCP `cli-credentials`, MCP `server` | exit 0, 103/103 passed |
| Lint | `pnpm lint` | exit 0 |
| Typecheck | `pnpm typecheck` (root plus every package) | exit 0 |
| NOT RUN (orchestrator) | `pnpm test` (full), `pnpm test:pg` (full), `pnpm build`, Playwright | per the resource rules |

Failure history:
- The first green pg run failed 5/6 with `unverified`, code `42809`. The planner evaluated
  `has_sequence_privilege` on non-sequence rows before the `relkind` filter. Fixed by
  guarding the privilege functions with `CASE`.
- That same failure exposed a design gap: an attestation that keeps failing would block
  every read in development. Added `blockUnverified` (production fails closed; development
  lets reads through and re-checks).
- `packages/db` typecheck failed once on a test helper's inferred env type. Fixed by
  annotating it.
- No existing assertion was relaxed. The MCP test's `database is not ready` expectation is
  kept: an unverified attestation reports with that prefix.

## Behaviour changes

**O1. Read-only credential attestation.**
- `attestReadOnlyCredentials(config, env)` opens one plain `pg.Client` with the consumer's
  own URL. It uses no session overrides, so `default_transaction_read_only` is the role's
  real default.
- It runs one catalog query and reports these facts: superuser, CREATEROLE, CREATEDB;
  ownership via `pg_has_role(owner, 'MEMBER')`; INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER on
  any table or view in an application schema; USAGE/UPDATE on sequences; CREATE on any
  application schema or on the database; and `default_transaction_read_only`.
- Verdict: any write path means **refuse** in production unless
  `DB_ALLOW_OWNER_CREDENTIALS=1`. With the acknowledgement, or outside production, it
  means **warn**. A missing `default_transaction_read_only` alone only **warns**. Reason:
  A44 says "should", and `begin read write` defeats it (proven in `roles.pgtest.ts`), so
  privileges are the real boundary. Refusing on it would reject correctly granted
  `civic_readonly` logins.
- Web:
  - `instrumentation.ts` now awaits `refuseUnsafeDbConfig()`, which exits 1 on refusal.
  - `webContext()` is now async and passes a memoized process-wide gate before the first
    read.
  - Refused is permanent: reads get a generic `internal` error, `/api/health` reports
    `down`, `/api/live` stays up.
  - Unverified (database down) rejects that read in production and is retried. In
    development the read goes through.
- MCP: attests at startup. Refuse or unverified both exit 1. Unverified keeps the existing
  `database is not ready` wording.
- Log lines carry outcome, problem codes and warning codes. They never contain the URL,
  host, role name or driver message (tested).

**O2. Log-sink safety.**
- `logSafely()` in `api/logger.ts` now wraps:
  - the health catch path, so the 503 JSON is kept;
  - the guard's identity-problem error at construction, the shared-bucket warning and the
    429 warning;
  - the handler's request log, which keeps its earlier try/catch semantics.
- `observed-read` uses the same helper.

**O3. Request read budget.**
- `capabilities.ts` creates one `ReadBudget` per request with React `cache` and passes it
  to `observedRead`.
- When one read times out, the budget expires. Later reads in the same request then throw
  the same `'The data request took too long. Try again.'` error, with outcome
  `skipped_expired`, **without calling the capability**.
- Sibling reads that are already in flight keep their own deadline and result (the
  per-read semantics are unchanged).
- In-flight work is counted until it settles (`inFlight`, `drained()`). Late successes and
  late failures are absorbed, so there are no unhandled rejections.
- Driver cancellation was not added. Drizzle's `pool.query` hides the checked-out client;
  cancelling would need its backend pid plus `pg_cancel_backend` on a second connection,
  i.e. a custom client wrapper. PGlite has a single in-process connection and no cancel.
  `DB_STATEMENT_TIMEOUT_MS` (15 s) is below `WEB_READ_TIMEOUT_MS` (20 s), so each
  statement is already cut off server-side before the response deadline.

**O4.** [hosted-acceptance-plan.md](hosted-acceptance-plan.md) covers proxy identity and
spoofing, per-client quotas, the runtime pin, the off-provider DB and raw restore drill
against RPO 24 h / RTO 4 h, hosted attestation, alert receipt with dedup and recovery, log
retention, and a proposed `main` ruleset as JSON. Every item is **NOT RUN / owner-gated**.

## Files outside the listed owned paths (minimal, flagged)

- `packages/core/src/index.ts`: re-exports `attestReadOnlyCredentials`,
  `createReadOnlyGate`, `ReadOnlyAttestation` and `ReadOnlyCredentialsError`. Web and MCP
  depend on `@civic-ledger/db` only as a devDependency, so runtime imports must go
  through core. The change is additive.
- `packages/db/src/index.ts`: exports the new module and the `EnvVars` type.
- `apps/web/instrumentation.ts`: one `await` and a comment, so a refusal at startup
  happens before Next serves.

## Proposed for the orchestrator (not applied)

**`packages/ingest/src/report-cli.ts`** (owned by nobody in this program; `ingest:report`
is a read-only consumer). Proposed diff:

```ts
import { attestReadOnlyCredentials } from '@civic-ledger/db';
// inside .action, before createDb, when !opts.db:
const config = dbConfigFromEnv(process.env, { readOnly: true });
const attestation = await attestReadOnlyCredentials(config, process.env);
if (attestation.action === 'refuse') throw new Error(attestation.message);
if (attestation.action === 'warn') console.error(JSON.stringify({ level: 'warn', event: 'db.readonly_attestation', problems: attestation.problems, warnings: attestation.warnings }));
```

**DECISIONS rows** (replace the text in the A61 and A67 rows; orchestrator-owned file):

- **A61 (amend):** "... Development keeps the fallback. **From T-O (2026-10-19), web and
  MCP also attest the login against the database before the first read
  (`readonly-attestation.ts`): superuser, CREATEROLE/CREATEDB, ownership, DML, TRUNCATE
  or TRIGGER, sequence USAGE/UPDATE, or CREATE on a schema or the database refuses
  startup in production unless `DB_ALLOW_OWNER_CREDENTIALS=1`; otherwise it warns. A
  missing `default_transaction_read_only` only warns.** Rationale: closes 'a writable
  role behind DATABASE_URL_READONLY is still not detected'. Proven on PG17 by
  `test-pg/readonly-attestation.pgtest.ts`. Open: `ingest:report` not yet wired; the check
  runs once per process (a privilege granted later is not seen until restart)."
- **A67 (amend):** "... page reads have explicit deadlines **and a per-request read budget:
  after one read misses its deadline the request starts no further capability calls;
  in-flight work is tracked until it settles. Health, guard and handler diagnostics cannot
  replace the HTTP answer (`logSafely`)** ... Driver-level cancellation of an in-flight
  statement is not implemented (bounded by `DB_STATEMENT_TIMEOUT_MS`)."

## OPERATIONS.md edits (applied in this branch)

- The `DB_ALLOW_OWNER_CREDENTIALS` and `WEB_READ_TIMEOUT_MS` rows mention the attestation
  and `skipped_expired`.
- New subsection "Read-only credential attestation" with the problem table, the
  refuse/warn policy, startup versus first-use behaviour and the log line.
- Logs: the outcome list includes `skipped_expired`, and the `logSafely` coverage is
  stated.

## Open risks

- Attestation runs **once per process**. Grants that change after startup are not
  detected until restart. A periodic re-attest was deliberately not added (scope; no new
  timers).
- With the database down at startup, production web reads fail closed until one
  attestation succeeds. Each failing read may add one connection attempt (shared while one
  is in flight, bounded by `DB_CONNECT_TIMEOUT_MS`).
- Privileges outside application schemas are not checked: functions (`SECURITY DEFINER`),
  large objects, `pg_write_server_files` and similar predefined roles. Ownership and
  membership checks cover the common mislabeling cases (owner, loader, superuser).
- `ingest:report` is not wired (proposal above). `scripts/backup/**` consumers are out of
  scope.
- O3 stops new work only after a timeout. A capability that runs several sequential
  statements still runs them all; each statement is bounded only by the statement
  timeout.
- Nothing hosted has been run; see the acceptance plan.
