# Operations

Runbook for the public API and MCP server (readiness profile W). Hosting is not
decided (owner decision D1), so everything here is host-neutral; host-specific steps
are marked **pending D1**. Nothing in this repo has been deployed.

Related: [API.md](API.md) (contract), [ARCHITECTURE.md](ARCHITECTURE.md) section 7
(cross-cutting rules), [DECISIONS.md](DECISIONS.md).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | empty = PGlite `.pglite/dev` | Postgres for ingest, migrations and (when `DATABASE_URL_READONLY` is unset: development only, or with `DB_ALLOW_OWNER_CREDENTIALS=1`) the app and MCP server |
| `DATABASE_URL_READONLY` | unset | Select-only role used by the web app, the MCP server and `pnpm ingest:report`; see [Database roles](#database-roles-and-connections) |
| `DB_ALLOW_OWNER_CREDENTIALS` | unset | `1` lets a production web/MCP process run without `DATABASE_URL_READONLY` (on `DATABASE_URL` or a local PGlite). Otherwise `NODE_ENV=production` web (`next start`) and MCP exit 1 at startup. |
| `DB_POOL_MAX` | 10 | pg pool size per process |
| `DB_STATEMENT_TIMEOUT_MS` | 15000 | Web / MCP statement timeout (`0` disables) |
| `INGEST_DB_STATEMENT_TIMEOUT_MS` | 600000 | Ingest, `db:migrate`, `db:seed` statement timeout (`0` disables) |
| `DB_CONNECT_TIMEOUT_MS` | 10000 | Wait for a pool connection |
| `DB_IDLE_TIMEOUT_MS` | 30000 | Close pool connections idle this long |
| `DB_LOCK_TIMEOUT_MS` | 30000 | Fail a statement that waits this long for a lock (`0` disables) |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | 60000 web, 600000 ingest | Server ends sessions idle inside a transaction this long (`0` disables) |
| `INGEST_MAX_DELETE_FRACTION` | 0.1 | Shrink guard: most of a source's rows a run may delete |
| `INGEST_MIN_RECORD_RATIO` | 0.5 | Shrink guard: fewest records, as a share of the last successful run, a run may load |
| `INGEST_MIN_RECORD_BASELINE` | 20 | Shrink guard: the record floors apply only when the last run loaded at least this many; per-table sweep fractions are judged from this many rows (and always when a sweep would empty a table) |
| `INGEST_RUN_DEADLINE_MS` | unset (no deadline) | Whole-run deadline; past it the run is rolled back and recorded `cancelled` (`--deadline-minutes` overrides) |
| `INGEST_MAX_DOWNLOAD_BYTES` | 1073741824 (1 GiB) | Largest downloaded file, also for a cached copy reused on 304 (A65); larger fails the run. `--snapshot` and repository curated files are not download-capped |
| `INGEST_MAX_DECOMPRESSED_BYTES` | 2147483648 (2 GiB) | Largest inflated zip entry; larger fails the run |
| `PAGE_RATE_LIMIT_PER_MINUTE` | 300 | Bucket for HTML pages (burst = this) |
| `RATE_LIMIT_SINGLE_BUCKET` | unset | `1` acknowledges that, without `TRUSTED_PROXY_HEADER`, all callers share one bucket (required in production) |
| `LOG_LEVEL` | `info` (`silent` under tests) | pino level |
| `TRUSTED_PROXY_HEADER` | unset | Header your proxy sets to the client address. **Required in production** unless `RATE_LIMIT_SINGLE_BUCKET=1` (see [Rate limits](#rate-limits)) |
| `TRUSTED_PROXY_HOPS` | 1 | For `x-forwarded-for`: which entry from the right is the client |
| `API_RATE_LIMIT_PER_MINUTE` | 60 | Default bucket (burst = this, refill = this per minute) |
| `API_RATE_LIMIT_EVALUATE_PER_MINUTE` | 10 | `POST /api/v1/frameworks.evaluate` |
| `API_RATE_LIMIT_HEALTH_PER_MINUTE` | 30 | `/api/health` |
| `HEALTH_DB_TIMEOUT_MS` | 2000 | Database round-trip budget for health |
| `HEALTH_MAX_INGEST_AGE_HOURS` | 336 | Staleness limit for sources without a built-in limit |

Secrets are environment-only; `.env*` is gitignored and CI runs a secret scan.
Invalid numeric values for the `DB_*` / `INGEST_*` variables stop the process at start
with a message naming the variable; empty means "use the default".

## Database roles and connections

Three kinds of process touch the database; give each its own credentials (VC-068,
DECISIONS A44).

| Process | Connection string | Needs |
|---|---|---|
| Web app, MCP server, `pnpm ingest:report` | `DATABASE_URL_READONLY` (required in production; falls back to `DATABASE_URL` only outside production or when acknowledged) | `SELECT` only |
| `pnpm ingest` | `DATABASE_URL` | read and write rows; refresh the two materialized views |
| `pnpm db:migrate`, `db:seed` | `DATABASE_URL` as the schema owner | DDL |

`scripts/db/roles.sql` creates two `NOLOGIN` group roles, `civic_readonly` (select on
every table, view and materialized view, current and future) and `civic_ingest`
(select/insert/update/delete, sequences, and `MAINTAIN` for `REFRESH MATERIALIZED VIEW`
on PostgreSQL 17+; on 16 or older run ingest as the owner). It sets no passwords. Create
the login roles with passwords from your secret store:

```sh
pnpm db:migrate                                   # as the owner role
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/db/roles.sql
```

```sql
create role civic_web login password '<from the secret store>' in role civic_readonly;
alter role civic_web set default_transaction_read_only = on;
create role civic_loader login password '<from the secret store>' in role civic_ingest;
```

Re-running the script after a migration re-applies grants; default privileges already
cover objects the owner creates later. `test-pg/roles.pgtest.ts` proves on Postgres 17
that the read-only role cannot insert, update, delete, truncate, refresh or run DDL
(42501) and still serves every public read capability, and that the ingest role can
load and refresh but cannot change the schema.

**Connection budget.** Every process has its own pool (`DB_POOL_MAX`, default 10), and
ingest holds one extra connection for the source lock plus one for the load
transaction. Peak connections = web instances x `DB_POOL_MAX` + MCP clients x
`DB_POOL_MAX` + ingest (about 3). Keep that under the host's `max_connections` minus a
reserve; on serverless or small plans lower `DB_POOL_MAX` or use the provider's pooler
in transaction mode (the advisory-lock connection must bypass a transaction pooler:
point ingest's `DATABASE_URL` at the direct endpoint).

**TLS to the database.** `pg` reads `sslmode` from the connection string. For a managed
or remote Postgres use `?sslmode=verify-full` (the host's CA must be trusted by Node);
`require` encrypts without verifying the server. There is no separate app switch.

**Timeouts.** Web and MCP statements are cancelled after 15 s (`57014`); ingest
statements after 10 minutes, so a hung statement cannot hold the source lock forever.
Sessions idle inside a transaction are ended by the server and a statement waiting on a
lock fails after 30 s. An idle pool connection that fails (database restart) is logged
as `{"msg":"database pool error"}` on stderr and replaced; it does not stop the process.
If the connection that holds an ingest source lock fails, the run stops and is recorded
as `failed`. Each run's load, read-model refresh and success receipt are one transaction
(DECISIONS A50), so it holds the matview lock (EXCLUSIVE; reads continue) until commit:
a concurrent run of another source waits at its own refresh, up to the lock timeout.

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
* `checks.rateLimit` appears when the limiter state is known: `{ "status": "ok",
  "mode": "per_client" | "single_bucket" }`, or `{ "status": "misconfigured", "reason":
  "trusted_proxy_header_unset" }` (overall `degraded`) in production without a client
  identity, see [Rate limits](#rate-limits).

### Liveness and readiness (VC-057)

| Probe | Path | Touches the database | Use for |
|---|---|---|---|
| Liveness | `GET /api/live` (also `HEAD`) | No: `200 {"status":"live"}`, `no-store`, not rate limited | Restart-on-failure. A database outage must not make it fail. |
| Readiness | `GET /api/health` | Yes (round trip, timeout) | Load balancer / uptime probe. 503 only when the database is down. |
| Freshness | `GET /api/health?strict=1` | Yes | The ingest-freshness alert. 503 when any source is stale. |

Do **not** use `GET /` for liveness: the home page reads four capabilities from the
database.

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
`proxy`) for every page and every `/api/*` path except Next's static assets;
`OPTIONS` preflights and `/api/live` are free.

| Rule | Paths | Burst / sustained |
|---|---|---|
| `evaluate` | `/api/v1/frameworks.evaluate` | 10 / 10 per minute |
| `health` | `/api/health` | 30 / 30 per minute |
| `default` | everything else under `/api` | 60 / 60 per minute |
| `page` | HTML pages (everything outside `/api`) | 300 / 300 per minute |

A refused API request gets `429`, `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining: 0`
and the standard error body; a refused page gets the same headers with a short
`text/plain` body. The MCP server has its own per-session bucket (120 burst,
2 per second) and is not affected by the HTTP limits.

**Trusted proxy handling.** A route handler cannot see the socket address, so the
client address is read only from the header named by `TRUSTED_PROXY_HEADER`, and only
if it parses as an IP address. With the variable unset nothing is trusted and **all
callers share one bucket**, so one client can lock everyone out.

* Development: that is allowed; the app logs a warning once.
* Production (`NODE_ENV=production`): **fail closed** (DECISIONS A43). Without
  `TRUSTED_PROXY_HEADER`, and without `RATE_LIMIT_SINGLE_BUCKET=1` as an explicit
  acknowledgement, the guard logs an error at first use, answers every page and API
  request with `503` (`Retry-After: 60`), and lets only `/api/health` (reporting
  `degraded` with `reason: trusted_proxy_header_unset`) and `/api/live` through.

Set the header to whatever your edge overwrites, never to a header the client can
supply end to end:

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

Cache freshness is **time-based only** (DECISIONS A46). There is no push invalidation:
the ingest CLI is a separate process from the web server and nothing calls
`revalidateTag` or `revalidatePath`.

* `/api/v1` reads are `public, max-age=0, s-maxage=N, stale-while-revalidate=M`
  (data 300/3600 s, reference 3600/86400 s, status 60/300 s; see API.md), with a strong
  `ETag` so a stale shared cache revalidates with `If-None-Match` and gets a `304`.
  Errors, `frameworks.evaluate` and `/api/health` are `no-store`.
* Server-rendered pages are dynamic (they call `connection()`), set no cache lifetime
  and read the database on every view.
* The Explore read model (`person_card`) is refreshed by the ingest runtime inside each
  load transaction, so facts and read model become visible together when a run commits.
* Data only changes when an ingest run finishes, so after an ingest a CDN may serve the
  previous answer for up to `s-maxage` plus the stale window. If that matters, purge the
  CDN (host-specific, pending D1) after `pnpm ingest`.

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
newer additive schema; this is a design claim, not yet tested), then apply the note only
if the migration itself is the problem and it states "no data loss". Anything else:
restore from backup. Upgrading is tested: `test-pg/migrations.pgtest.ts` applies the
latest migration over a populated database at the previous version on Postgres.

**Data.** A bad ingest: a failed, refused or cancelled run changes no facts, read models
or counts, because load, refresh and success receipt are one transaction (DECISIONS A50;
A41's original claim did not hold and was superseded). Only the source metadata row and
the run's own receipt are written outside it. Replaying an older raw snapshot is not a
restore unless you pass `--force-replay` (A54). A run that succeeded with bad data: fix the adapter and rerun (loads are upserts on
natural keys, so it converges). A bad curated change: `git revert` the merge
and reload. If wrong data was shown publicly, treat as SEV2 and say so on the Sources
page.

**MCP server.** Stateless; roll back the code and restart the client. It holds no data.

## Verification before a release

`pnpm check` (lint, typecheck, tests, build) and `pnpm test:pg` (the same behaviour on
real Postgres 17: `embedded-postgres` locally, a `postgres:17` service in CI; set
`PG_TEST_URL` to a superuser connection string to use your own server). The parity suite
(`apps/web/test/parity.test.ts`) is part of `pnpm test` and is also run on its own as
the `agent-parity` CI job; evidence is in
[AGENT_NATIVE_EVIDENCE.md](AGENT_NATIVE_EVIDENCE.md). Live checks after any deploy
(NOT RUN until a host exists): `/api/health?strict=1`, `/api/v1/openapi.json`, one MCP
`tools/list` against production read-only credentials.
