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

- Documentation that over-claimed: cache invalidation by `revalidateTag` (there is none;
  freshness is time-based, A46), `GET /` as a liveness probe (A47), the stale CSP
  comment, and the agent-native evidence counts (13 capabilities, 39 parity tests).

### Security

- `pnpm audit --prod`: no known vulnerabilities (2026-10-16). One moderate advisory in
  the dev-only `drizzle-kit` tree is accepted and recorded in A48.
