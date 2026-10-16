# Operations

Runbook for the public API and MCP server (readiness profile W). Hosting is not
decided (owner decision D1), so everything here is host-neutral; host-specific steps
are marked **pending D1**. Nothing in this repo has been deployed.

Related: [API.md](API.md) (contract), [ARCHITECTURE.md](ARCHITECTURE.md) section 7
(cross-cutting rules), [DECISIONS.md](DECISIONS.md).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | empty = PGlite `.pglite/dev` | Postgres for the app and the MCP server. Use a read-only role for the MCP server. |
| `DB_POOL_MAX` | 10 | pg pool size per process |
| `LOG_LEVEL` | `info` (`silent` under tests) | pino level |
| `TRUSTED_PROXY_HEADER` | unset | Header your proxy sets to the client address (see [Rate limits](#rate-limits)) |
| `TRUSTED_PROXY_HOPS` | 1 | For `x-forwarded-for`: which entry from the right is the client |
| `API_RATE_LIMIT_PER_MINUTE` | 60 | Default bucket (burst = this, refill = this per minute) |
| `API_RATE_LIMIT_EVALUATE_PER_MINUTE` | 10 | `POST /api/v1/frameworks.evaluate` |
| `API_RATE_LIMIT_HEALTH_PER_MINUTE` | 30 | `/api/health` |
| `HEALTH_DB_TIMEOUT_MS` | 2000 | Database round-trip budget for health |
| `HEALTH_MAX_INGEST_AGE_HOURS` | 336 | Staleness limit for sources without a built-in limit |

Secrets are environment-only; `.env*` is gitignored and CI runs a secret scan.

## Health

`GET /api/health`, always `Cache-Control: no-store`.

```json
{ "status": "ok", "time": "...",
  "checks": {
    "database": { "status": "ok", "latencyMs": 12 },
    "ingest": { "status": "ok", "sources": [
      { "id": "fec-bulk", "freshness": "fresh", "lastSuccessAt": "...", "ageSeconds": 3600,
        "maxAgeSeconds": 1209600, "lastRunStatus": "succeeded" } ] } } }
```

* The database check is a real round trip through the `sources.status` capability,
  with a timeout (`HEALTH_DB_TIMEOUT_MS`). Failure or timeout: `503`, `status: "down"`,
  `reason: "unavailable" | "timeout"`. The cause is in the logs under the request id,
  not in the body.
* Ingest freshness is the age of each source's latest **successful** run
  (`finishedAt`). Built-in limits are about twice the planned schedule:
  `congress-legislators` and `govinfo-billstatus` 48 h, `fec-bulk` and `voteview`
  14 days, others `HEALTH_MAX_INGEST_AGE_HOURS`. A stale source, a source that never
  succeeded, or an empty source table is `status: "degraded"` with HTTP **200**, so a
  failed upstream does not pull a working site out of rotation.
* `GET /api/health?strict=1` answers `503` when degraded. Point the ingest-freshness
  alert at the strict URL and the load balancer / uptime probe at the plain one.
* Readiness vs liveness (VC-057): `/api/health` is readiness (needs the database). For
  a liveness probe use `GET /` (no dependencies).

## Logs

Structured JSON, one object per line, on stdout (web) and stderr (MCP), via pino.

```json
{"level":"info","time":"2026-10-16T04:52:34.347Z","service":"civic-ledger-web","requestId":"259b1197-...","capability":"frameworks.evaluate","method":"POST","status":200,"durationMs":17,"msg":"request"}
```

* Every API request logs `requestId`, `capability`, `method`, `status`, `durationMs`.
  The `X-Request-Id` response header is the same id: ask reporters for it.
* `status >= 500` logs at `error` with the underlying cause under `err`. Rate-limited
  requests log at `warn` (`msg: "rate limited"`, with `rule`).
* Request headers, query strings and client addresses are **not** logged; the only
  data in logs is public-official data and the capability name. The logger also
  redacts `authorization` and `cookie` fields if a future change logs them.
* MCP logs only startup and tool failures (stderr; stdout is the protocol).
* Retention and shipping are host decisions (pending D1). Until then: platform log
  capture of stdout, 14 days.

## Rate limits

Token bucket per client address and rule, enforced in `apps/web/proxy.ts` (Next 16
`proxy`) for every `/api/*` path; `OPTIONS` preflights are free.

| Rule | Paths | Burst / sustained |
|---|---|---|
| `evaluate` | `/api/v1/frameworks.evaluate` | 10 / 10 per minute |
| `health` | `/api/health` | 30 / 30 per minute |
| `default` | everything else under `/api` | 60 / 60 per minute |

A refused request gets `429`, `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining: 0`
and the standard error body. The MCP server has its own per-session bucket (120 burst,
2 per second) and is not affected by the HTTP limits.

**Trusted proxy handling.** A route handler cannot see the socket address, so the
client address is read only from the header named by `TRUSTED_PROXY_HEADER`, and only
if it parses as an IP address. With the variable unset nothing is trusted and **all
callers share one bucket** (safe against forged headers, harsh in production; the app
logs a warning once). Set it to whatever your edge overwrites, never to a header the
client can supply end to end:

| Edge | `TRUSTED_PROXY_HEADER` | Notes |
|---|---|---|
| Cloudflare | `cf-connecting-ip` | Overwritten by Cloudflare |
| One reverse proxy that appends to `x-forwarded-for` | `x-forwarded-for` + `TRUSTED_PROXY_HOPS=1` | Takes the last entry, which the proxy added |
| CDN then reverse proxy | `x-forwarded-for` + `TRUSTED_PROXY_HOPS=2` | Counts from the right |
| Vercel / other managed host | pending D1 | Check the host's documented client-IP header |

**Limits of the in-memory limiter.** State lives in the process: it resets on restart,
and with N instances (or serverless invocations) the effective limit is up to N times
higher. Memory is bounded (10 000 buckets, least recently used evicted). IPv6 clients
are keyed by full address, so one /64 can rotate addresses. For a shared store
implement the `RateLimiter` interface in `apps/web/src/server/api/rate-limit.ts`
(`take(key, rule)` returns allow/deny and the retry delay, sync or async) and pass it
to `createGuard` in `runtime.ts`. Until then, put the edge's own rate limiting (WAF)
in front for volumetric abuse.

## Caching

Reads are `public, s-maxage=...` with `stale-while-revalidate` (300 s data, 3600 s
reference, 60 s status; see API.md). Data only changes when an ingest run finishes, so
after an ingest a CDN may serve the previous answer for up to the `s-maxage`. If that
matters, purge the CDN (host-specific, pending D1) after `pnpm ingest`.

## Incident severity (VC-109)

| Level | Definition | Examples | Response |
|---|---|---|---|
| SEV1 | Site or API down, or wrong facts/scores shown as correct | `/api/health` 503 for 5 min; a framework shows the wrong "X of Y"; a score without attribution | Start now; mitigate (rollback or take the affected view down) before diagnosing |
| SEV2 | Major degradation: one capability failing, a source stale beyond its limit, sustained 429s for real users | `explore.table` 500s; `fec-bulk` stale 3 days past its limit | Same day |
| SEV3 | Minor or contained: a single source run failed and retried clean, slow responses | p95 above 2 s | Next working day |
| SEV4 | Cosmetic or documentation | Typo in OpenAPI summary | Backlog |

Incorrect or non-neutral data is treated as at least SEV2 even when the site is up:
the product promise is the data.

There is a single owner and no paging rota (VC-110 is not met; sustainable paging is
an owner decision). Alerts are email or push from the uptime monitor (pending D1).

### First 15 minutes

1. **Confirm and classify (0-3 min).** Open `/api/health?strict=1`. Note the time and
   `X-Request-Id` of a failing request. Pick a severity from the table; if unsure,
   take the higher.
2. **Stop the bleeding (3-8 min).** A bad release: roll back (below). A bad data load:
   see "Data rollback". Abuse: lower `API_RATE_LIMIT_*` or add an edge rule. Database
   down: check the host dashboard; the app recovers on its own when connections
   return.
3. **Find the cause (8-12 min).** Search logs by `requestId`, then by `status:500` in
   the last hour; check `ingest_run` rows for a failed or `running` run
   (`sources.status` shows `lastRun`); check the last deploy and the last ingest time.
4. **Communicate (12-15 min).** Anything user-visible for more than 15 minutes gets a
   status note on the Sources page / README banner stating what is affected and since
   when. Never state a cause you have not confirmed.
5. **Record.** Open `docs/postmortems/YYYY-MM-DD-<slug>.md` from the template as soon
   as the incident is stable, even if it is a stub.

## Postmortems (VC-111)

Blameless, one file per SEV1/SEV2 (and any near miss worth keeping):
`docs/postmortems/YYYY-MM-DD-<slug>.md`, copied from
[`docs/postmortems/TEMPLATE.md`](postmortems/TEMPLATE.md). Link each from the table
below within a week of the incident.

| Date | Severity | Summary | Postmortem |
|---|---|---|---|
| none yet | | | |

## Backup and restore (VC-083, VC-084): pending D1

Status: **PENDING D1 (owner decision on the production Postgres host).** Not
implemented, not rehearsed. Do not call the system production-ready on these two items
until the checklist below is done.

What exists regardless of host:

* Curated data (`data/curated/**`) and code are in git: that is their backup.
* All database content is derived: sources are public and re-fetchable, raw snapshots
  are checksummed in `ingest_run`, and loads are idempotent upserts. A total loss can be
  rebuilt by `pnpm db:migrate` then re-running every ingest, then refreshing the read
  model. That costs hours and depends on upstream availability, so it is the
  fallback, not the plan.

Proposed approach, to confirm with D1 (targets are proposals for the owner):

| Item | Managed Postgres (Supabase or similar) | Self-hosted |
|---|---|---|
| Backups | Provider daily backups + point-in-time recovery if the plan has it | `pg_dump -Fc` nightly from cron, encrypted, copied off the host (object storage) |
| RPO | 24 h (a day of ingest can be re-run) | 24 h |
| RTO | 4 h | 4 h |
| Retention | 14 daily, 8 weekly | same |

Restore procedure to rehearse once the host exists (VC-084 needs an actual restore):

1. Create an empty Postgres (new instance; never restore over production).
2. `pnpm db:migrate` against it, so the schema and `drizzle` journal are current.
3. `pg_restore --clean --if-exists --no-owner -d "$RESTORE_URL" backup.dump`.
4. Refresh the read model (`REFRESH MATERIALIZED VIEW person_card` and
   `person_card_scorecard`, or run any ingest).
5. Verify: `/api/health?strict=1` against the restored instance is 200, `sources.status`
   shows the expected last runs, and `pnpm test` parity passes against a seeded copy.
6. Record date, backup age, duration and problems in the table below.

| Drill date | Backup age | Duration | Result |
|---|---|---|---|
| not yet performed | | | |

## Rollback

**Application release.** Redeploy the previous build: `git revert` the merge on `main`
and redeploy, or promote the previous build in the host (instant rollback; pending D1).
Verify with `/api/health?strict=1` and one request per cache class. API paths are
versioned (`/api/v1`), so rolling the app back never changes a contract that clients
saw before the bad release; a breaking change ships as `/api/v2` beside v1.

**Database migration.** Migrations are forward-only. Each has a hand rollback note in
`packages/db/migrations/README.md`. Roll the app back first (an older app works with a
newer additive schema), then apply the note only if the migration itself is the
problem and it states "no data loss". Anything else: restore from backup.

**Data.** A bad ingest: loads are upserts on natural keys, so fix the adapter and
rerun (it converges); the read model only refreshes after a successful run, so a failed
run leaves the previous cards in place. A bad curated change: `git revert` the merge
and reload. If wrong data was shown publicly, treat as SEV2 and say so on the Sources
page.

**MCP server.** Stateless; roll back the code and restart the client. It holds no data.

## Verification before a release

`pnpm check` (lint, typecheck, tests, build). The parity suite
(`apps/web/test/parity.test.ts`) is part of `pnpm test` and is also run on its own as
the `agent-parity` CI job; evidence is in
[AGENT_NATIVE_EVIDENCE.md](AGENT_NATIVE_EVIDENCE.md). Live checks after any deploy
(NOT RUN until a host exists): `/api/health?strict=1`, `/api/v1/openapi.json`, one MCP
`tools/list` against production read-only credentials.
