# Evidence-trust program: integration contract (2026-10-19)

Orchestrator: Claude Opus 5.5 (T3 thread). Integration branch
`claude/evidence-trust-20261019`, worktree
`_worktrees/Civic_Ledger/feature/evidence-trust-20261019`.

## Baseline

| Item | Value |
|---|---|
| Canonical checkout | `20_Products/Civic_Ledger`, branch `main`, clean |
| Baseline | `8f4a092` = `origin/main` (the reviewed commit; CI and Agent parity green there) |
| Unmerged, not included | `claude/types-node-26-20261019` (@types/node 26 + `process.disconnect` guards), Dependabot PRs #1, #2 |
| Toolchain | Node 24.16.0, pnpm 11.13.1, locked install (`--frozen-lockfile`), no upgrades |

## Review leads, classified at baseline (code reading; runtime proof is each task's red test)

| Lead | Classification at `8f4a092` |
|---|---|
| F1 same-day snapshot overwrite | Supported by code: `snapshotDirectory` = `<source>/<UTC day>`, fixed file names and `manifest.json` rewritten in place; no locator stored on the run. |
| F2 unchanged check invisible | Supported by code: dedupe path `deleteRun` + returns old receipt; `sources.status` and `scripts/monitor/assess.ts` read only `ingest_run`. |
| F3 Voteview withdrawn assertions | Supported by code: upserts only; `dim1 === null` and cast code 0 skip; vote/score keys are person-based; no sweep. Provisional counted, not stored. |
| F4 historical membership | Supported by code: frameworks filter on `person_card.chamber` (latest); tally left-joins every covering term with `count(*)`. Policy page label to be confirmed by Worker C. |
| F5 comparison period | Supported by code: `people.compare` input is slugs only; agreement over all loaded yea/nay. |
| F6 operations | Supported by code (A61 notes the writable read-only role is undetected). |

## Shared contract (orchestrator-owned; committed before workers start)

Migration `0006_evidence_checks_provisional` (additive, expand-only per A63; renumbered `0009_evidence_checks_provisional` when merged after main's 0006 to 0008, 2026-11-17):

- `ingest_run.snapshot_locator text null`: raw evidence location. Fetched snapshots: path
  relative to the raw root, `<source>/<YYYY-MM-DD>/<runId>-<checksum first 12>` (Worker A
  may refine the leaf name but must keep it unique per run and relative). `--snapshot`:
  the absolute directory given. Null = pre-0006 run.
- `ingest_check`: one row per successful upstream check whose key equals the scope's
  current generation (`outcome = 'unchanged'`, `publication_run_id` = that run,
  `started_at`, `checked_at`, `snapshot_checksum`, `adapter_version`, `scope`). The
  provisional `ingest_run` row is still deleted on that path (ingest.run idempotency is
  unchanged: same receipt, `deduplicated: true`).
- `ideology_score.provisional boolean null`: true provisional, false final, null unknown.

Public compatibility rules:

- v1 capability outputs only gain fields; no enum gains a value; inputs only gain optional
  fields whose default reproduces v1 behaviour. A semantic change to an existing default
  needs an explicit new field, not a silent redefinition.
- `sources.status@1` keeps `lastRun` / `lastSuccess` exactly. Worker A adds, per source,
  `freshness: { lastAttemptAt, lastAttemptOutcome ('published'|'unchanged'|'failed'|'running'|null), lastSuccessfulCheckAt, lastChangedAt, coverageThrough (date|null), coverageBasis (string|null) }`
  and `scopes: [{ scope, lastAttemptAt, lastAttemptOutcome, lastSuccessfulCheckAt, lastChangedAt, publicationRunId, coverageThrough }]`.
- `ingest.run` receipt gains `snapshotLocator: string|null` and `check: { id, checkedAt } | null`.
- `scores.list@1` ideology entries gain `provisional: boolean|null`.
- Worker C proposes additive fields for `votes.list` / `frameworks.evaluate`.

## Tasks, ownership, order

| Task | Owner | Owned paths (exclusive while active) | Depends on |
|---|---|---|---|
| T-A evidence + checks | Worker A | `packages/ingest/src/runtime/**`, `packages/ingest/src/cli.ts`, `packages/core/src/contracts/ingest.ts`, `packages/core/src/capabilities/sources.ts`, `scripts/monitor/**`, `scripts/backup/**`, Sources page under `apps/web/app/sources/**` and its components, new tests | 0006 |
| T-B Voteview corrections | Worker B | `packages/ingest/src/adapters/voteview/**`, `packages/ingest/src/adapters/lookups.ts` (read-mostly), `packages/core/src/capabilities/scores.ts`, profile score rendering in `apps/web`, voteview fixtures, new tests | 0006 |
| T-C vote-time membership | Worker C | `packages/core/src/capabilities/votes.ts`, `packages/core/src/capabilities/frameworks.ts`, `packages/core/src/frameworks/**`, `apps/web/app/policy/**`, `apps/web/app/frameworks/**`, related components, new tests | baseline |
| T-O operations | freed slot | `packages/db/src/client.ts`, `apps/web/src/server/**`, `apps/web/server.mjs` | baseline |
| T-S2a compare periods | Stage Two | `people.ts`, `person-card.ts`, `apps/web/app/compare/**`, explore compare list | Stage One gate |
| T-S2b bills/roll calls | Stage Two | new `bills.ts`, new pages | Stage One gate |

Orchestrator-only: `packages/db/migrations/**`, `packages/db/src/schema/**`,
`packages/core/src/capabilities/registry.ts`, `packages/db/src/cli/seed.ts`,
`pnpm-lock.yaml`, `docs/DECISIONS.md`, `docs/CAPABILITIES.md`, `AGENTS.md`/`CLAUDE.md`,
shared parity tests. Workers put proposed decision rows and shared-file diffs in
`docs/evidence/evidence-trust-20261019/<task>.md`.

Merge order: T-A, T-B (rebases over A's runtime if needed), T-C, then T-O; Stage One gate;
then Stage Two.

## Resource rules (16 GB Windows host)

Workers run targeted PGlite tests only (`pnpm vitest run <files>`), plus `pnpm lint` and
`pnpm typecheck`. The orchestrator runs `pnpm test:pg`, `pnpm build` and Playwright suites,
one at a time. Each worker uses its own temp directories for raw roots and PGlite data.
Stop only processes you started, by PID.

## Evidence rules

Red first: commit the failing regression test, record its output (command, exit code), then
the fix. Do not edit baseline behaviour to manufacture a failure. Record PASS / FAIL /
BLOCKED / NOT RUN per check with commit, command, scope, exit code and retries.
