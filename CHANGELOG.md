# Changelog

All notable changes are recorded here. The project follows [Semantic Versioning](https://semver.org/)
and the format of [Keep a Changelog](https://keepachangelog.com/). No release has been
tagged; the first tag waits for the production-readiness gate and owner approval
(DECISIONS A48). Versions in the `package.json` files stay `0.0.0` until then.

## [0.1.0-unreleased]

### Added

- Monorepo: `packages/db` (Drizzle schema, forward-only SQL migrations, read-model
  materialized views), `packages/core` (the capability registry: 13 public read
  capabilities plus the operator-only `ingest.run` and `curated.validate`),
  `packages/ingest` (adapters for congress-legislators, Voteview, FEC bulk, GovInfo
  BILLSTATUS and git-reviewed curated YAML), `packages/mcp` (stdio MCP server) and
  `apps/web` (Next 16 UI, `/api/v1` JSON API with OpenAPI, health).
- Ingest runtime: per-source advisory lock, `ingest_run` ledger, snapshot checksum
  dedupe, bounded retries with jitter, streaming parse.
- Ingest shrink guard: a load that would delete more than 10% of a source's rows, or
  load under half the last run's records, is rolled back and recorded `failed`;
  `--allow-shrink` overrides (A42).
- `GET /api/live` liveness probe separate from `/api/health` readiness (A47).
- Page rate limiting (300 per minute per client) next to the API limits (A43).
- `scripts/db/roles.sql`: read-only and ingest database roles, `DATABASE_URL_READONLY`
  for the web app, MCP server and report CLI (A44).
- Environment-configurable pool size and timeouts, with a separate longer statement
  timeout for ingest (A45).
- `pnpm test:pg`: the Postgres 17 suite (embedded server locally, service container in
  CI), and a CI job that runs it (A40).
- CI: dependency audit step and Dependabot configuration (A48).

### Changed

- An ingest load is one transaction; a failed or refused run changes nothing (A41).
- In production the API and pages refuse traffic (503) unless `TRUSTED_PROXY_HEADER` is
  set or `RATE_LIMIT_SINGLE_BUCKET=1` acknowledges a single shared bucket (A43).
- `pg` pools report idle-connection errors instead of crashing the process (A45).

### Fixed

- `cli-credentials.test.ts` gives the spawned MCP CLI 120 s instead of 30 s and reports a
  timeout as a start-up problem; under the full parallel suite a cold start was killed and
  read as `status: null`.
- Ingest: an ordinary retry right after a `--force-replay` returns the replay run
  (`deduplicated: true`) instead of refusing it as `snapshot_superseded`. Idempotency now
  compares the requested key with the latest successful run of the scope; `replayOf` still
  names the key's earliest run, and a truly superseded snapshot is still refused (A54,
  H3R2-01).
- Ingest: cancellation and the run deadline stop the FEC loader at the next statement of
  its staging, SQL dedupe, kept-page and sweep phases (`LoadContext.checkpoint`); before,
  an abort during pas2/IE post-processing still ran the remaining stats, page, write and
  cleanup statements before rolling back (A52, H3R2-02).
- Ingest: `INGEST_MAX_DOWNLOAD_BYTES` also applies to a cached copy reused on 304. A copy
  over the current cap is not revalidated (full fetch, streaming cap applies), and the
  cache integrity hash stops when the run is cancelled (A53, A65, H3R2-03).
- `packageManager` pins pnpm 11.13.1. pnpm marked 11.13.0 a broken release, and
  `pnpm/action-setup` refuses to install it, so every CI job failed at setup.
- The db CLIs and the web server agree on the default PGlite directory: both use
  `defaultPgliteDir()`, the workspace-root `.pglite/dev`. The CLIs used to resolve it
  against the working directory, so `migrate`/`seed` run from apps/web (as the Agent
  parity workflow does) filled `apps/web/.pglite/dev` while the server opened an empty
  root database and `/api/health` stayed 503.
- Documentation that over-claimed: cache invalidation by `revalidateTag` (there is none;
  freshness is time-based, A46), `GET /` as a liveness probe (A47), the stale CSP
  comment, and the agent-native evidence counts (13 capabilities, 39 parity tests).
- `pnpm test:pg` no longer prints `TypeError: done is not a function` from
  embedded-postgres after the summary (H3R2-05). The local server runs in a child process
  (`test-pg/embedded-server.ts`) that `global-setup.ts` starts and stops, so the
  package's exit hooks never run in the vitest process; a failing test still exits
  nonzero (A56).
- CI `secret-scan` scans the full git history. `gitleaks/gitleaks-action` limited push
  scans to the pushed first-parent range (8 commits, then 0); the job now runs the
  pinned, checksum-verified gitleaks 8.30.1 CLI (`gitleaks git --redact`) over every
  commit checkout fetched, with no license key or secret.
- Current-state documentation that contradicted the code or was stale: ARCHITECTURE said
  the read model refreshes after the commit (it refreshes inside the publication
  transaction, A50); AGENT_NATIVE_EVIDENCE still said ingest repairs were in progress and
  that there was no GitHub remote (gate statuses now follow the round-2 review, none
  upgraded); the OPERATIONS restore drill proposed `pnpm test` against a seeded copy as
  verification (replaced by assertions against the exact restored target; the drill has
  not been run); the byte-cap defaults comment claimed small-host headroom that was never
  measured (now an unmeasured proposal pending owner/host sizing, A53).
- Ingest: FEC cancellation now holds at every loader statement (A52, H3R3; residual of
  H3R2-02). An abort after a stage DROP still ran the stage CREATE, an abort after the
  first cycle-sweep DELETE still ran the other four, and the candidacy insert after the
  office upsert and the first statement of each savepoint callback (after the driver's
  SAVEPOINT) also ran without a check. The FEC loader now calls the run checkpoint
  before every statement it issues and at the start of every savepoint callback; tested
  after each of the fixture reload's 39 statement/savepoint boundaries on PGlite and
  Postgres, plus a lost lock (still `failed`).

### Security

- `pnpm audit --prod`: no known vulnerabilities (2026-10-16). One moderate advisory in
  the dev-only `drizzle-kit` tree is accepted and recorded in A48.
