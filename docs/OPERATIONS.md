# Operations

Runbook for the public API and MCP server (readiness profile W). The owner selected
Render web plus managed Postgres. [DEPLOY_RENDER.md](DEPLOY_RENDER.md) is the
provisioning and recovery runbook; account setup, deployment and hosted verification
remain pending. Nothing in this repo has been deployed.

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
| `API_BODY_TIMEOUT_MS` | 10000 | Absolute JSON body deadline; interrupted/stalled bodies answer uncached 408 |
| `WEB_READ_TIMEOUT_MS` | 20000 | Page capability response deadline; does not itself cancel database work |
| `HTTP_HEADERS_TIMEOUT_MS` | 10000 | Production native-server header deadline |
| `HTTP_REQUEST_TIMEOUT_MS` | 30000 | Production native-server request deadline; must be at least the header deadline |
| `HTTP_INACTIVITY_TIMEOUT_MS` | 30000 | Close an inactive socket |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | 5000 | Idle keep-alive budget |
| `HTTP_RESPONSE_TIMEOUT_MS` | 25000 | Absolute response deadline: 503 before headers, otherwise close the stream |

Secrets are environment-only; `.env*` is gitignored and CI runs a full-history secret scan
(`secret-scan` job: pinned gitleaks CLI over every fetched commit). A finding that review
shows is not a credential goes in `.gitleaksignore` by its exact fingerprint (commit, file,
rule, line) with a comment saying why; never allowlist a whole rule or path.
Invalid numeric values for the `DB_*` / `INGEST_*` variables stop the process at start
with a message naming the variable; empty means "use the default".
The new `API_BODY_TIMEOUT_MS`, `WEB_READ_TIMEOUT_MS` and `HTTP_*_TIMEOUT_MS`
budgets accept only positive integers up to 120000; zero or empty is invalid.
`pnpm --filter web start` runs `server.mjs` and accepts `-p/--port` and
`-H/--hostname`, with `PORT`/`HOSTNAME` fallbacks. Development still uses `next dev`.
The request and response limits apply to the native production start boundary;
the existing database statement timeout independently bounds database work.

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
* API failures log at `error`; rate-limited requests log at `warn`
  (`msg: "rate limited"`, with `rule`). Exceptions retain only allowed categories
  and safe codes, never raw messages, stacks, SQL or URLs.
* Page core reads log the same request id, capability, outcome and duration.
  Headers, query strings, inputs and client addresses are not emitted. Logger
  redaction remains defense in depth; a failed diagnostic sink cannot replace the
  intended business response.
* Background database-pool errors have no HTTP request context. They emit a fixed
  event and an allowed SQLSTATE only; raw driver text is suppressed there too.
* MCP logs only startup and tool failures (stderr; stdout is the protocol).
* Retention target: seven days ordinary logs, 30 days selected incident metadata.
  Configure and verify host capture, access and retention during provisioning;
  local sink tests do not prove shipping or retention.

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
| Render | pending hosted verification | Verify the edge-overwritten header before selecting it; explicit single-bucket mode is the initial blueprint acknowledgment |

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
  CDN (hosted configuration pending) after `pnpm ingest`.

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
an owner decision). Prepared monitoring produces GitHub incident drafts and a
success digest only. Independent uptime monitoring, actual notification delivery
and owner receipt remain NOT RUN; see DEPLOY_RENDER before activation.

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

## Backup and restore (VC-083, VC-084)

Status: local backup/restore tooling and a synthetic PostgreSQL drill are implemented.
Hosted backup storage, credentials, schedules, retention and recovery verification
remain **NOT RUN**. Use [DEPLOY_RENDER.md](DEPLOY_RENDER.md) for the executable
commands and [ops evidence](evidence/ops-launch-20261018.md) for measured results.

What exists regardless of host:

* Curated data (`data/curated/**`) and code are in git: that is their backup.
* All database content is derived: sources are public and re-fetchable, raw snapshots
  are checksummed in `ingest_run`, and loads are idempotent upserts. A total loss can be
  rebuilt by `pnpm db:migrate` then re-running every ingest, then refreshing the read
  model. That costs hours and depends on upstream availability, so it is the
  fallback, not the plan.

Owner-selected recovery targets (not achieved service guarantees):

| Item | Managed Postgres (Render) | Operator-managed supplement |
|---|---|---|
| Backups | Provider daily backups + point-in-time recovery if the plan has it | `pg_dump -Fc` nightly from cron, encrypted, copied off the host (object storage) |
| RPO | 24 h (a day of ingest can be re-run) | 24 h |
| RTO | 4 h | 4 h |
| Retention | 14 daily, 8 weekly | same |

The operator tooling records an authenticated manifest and checks content, receipts
and representative capability answers after restoration into an empty target.
The following comparison policy still governs the drill. A hosted drill must use
the actual storage, credentials and network before VC-084 can be closed for launch.

0. When each backup is taken, record from the source database, in the same transaction
   snapshot as the dump if possible, and store the record beside the backup: the record
   date (`select current_date`); for every table in `public`, `count(*)` and a content
   checksum (for example `select md5(string_agg(t::text, '|' order by t::text)) from
   <table> t`); for the two materialized views, `count(*)` and the checksums named in the
   comparison policy below; the latest `ingest_run` rows per source (`id`, `source_id`,
   `scope`, `status`, `snapshot_checksum`, `counts`, `finished_at`); the `sources.status`
   answer; and the JSON answers of a fixed sample of public capabilities (at least
   `people.get`, `money.summary`, `votes.list`, `explore.table` and `frameworks.evaluate`
   for recorded inputs; pass `scope: 'all'` wherever the input has a member scope).
1. Create an empty Postgres (new instance; never restore over production).
2. Leave it empty. Do not pre-migrate: the full archive contains the source schema
   and migration journal, and the guarded restore refuses a populated target.
3. Use the guarded restore CLI in DEPLOY_RENDER against that empty target. It
   refuses the source database and populated targets; it never drops a live schema.
4. **Content integrity.** Verify the exact restored target (`$RESTORE_URL`) before any
   ingest touches it, against the record from step 0, under the comparison policy
   below. Every compared item must match; any difference fails the drill:
   * per-table row counts and content checksums equal the record, `ingest_run` included.
     If the materialized views came back unpopulated, refresh them (`REFRESH MATERIALIZED
     VIEW person_card`, then `person_card_scorecard`); no other refresh or ingest;
   * the view counts and normalized view checksums equal the record;
   * the `ingest_run` rows equal the record;
   * a web process pointed at the restored target answers `/api/health` (not strict)
     with 200, and its `sources.status` answer and the recorded capability sample,
     called through `/api/v1`, equal the recorded JSON after normalization.

   **Freshness and traffic readiness are a separate result.** `/api/health?strict=1`
   judges each source's latest success against the current time, so an old but correct
   backup can legitimately answer 503 (`degraded`, stale sources). Record that answer
   next to the integrity result, not as an integrity failure. Whether to serve a stale
   restore or to re-ingest first is the operator's decision; an ingest after the check
   is outside the comparison.

   `pnpm test` and `pnpm test:pg` build their own fixture databases and cannot verify
   restored content; a pass there is not restore evidence.

   **Comparison policy (normalization and as-of).** Only the fields below are treated
   specially; everything else, including every business value, provenance field
   (`sourceId`, `sourceKey`, `ingestRunId`, `retrievedAt`), row count, receipt field
   and `ingest_run` row, must be exactly equal.
   * *Regenerated at refresh, always excluded:* the `sources.status` field
     `readModelRefreshedAt`; every `refreshedAt` key in a capability answer (the
     person-card rows, e.g. `card.refreshedAt` in `people.get`); the view column
     `person_card.refreshed_at`, so the `person_card` checksum is taken over
     `to_jsonb(t) - 'refreshed_at'` in the record and in the drill.
     `person_card_scorecard` has no such column and is compared raw. These values
     change on every refresh, and pg_restore itself refreshes the views (a dump stores
     the REFRESH, not the view rows). Request ids and response headers are excluded
     too.
   * *Date-dependent, compared as of the record date or excluded:* "current" is
     evaluated at the database's `current_date` and no capability takes an as-of date.
     This affects `isCurrent` on person rows and cards; answers filtered to
     `scope: 'current'` (the `explore.table` default, `people.search` with that scope)
     and the current counts of `explore.facets`; the `people.search` order (current
     members first); and `tenureYears` / `person_card.tenure_years`, fixed when the view
     is refreshed. If the restore's view refresh and the capability calls run on the
     record date (same `current_date` on the database), compare these exactly.
     Otherwise exclude exactly these fields and answers, remove `tenure_years` from the
     `person_card` checksum as well (record both variants in step 0), and list each
     exclusion in the drill result with the record and drill dates. The term rows they
     derive from are still compared exactly through the table checksums.

   `packages/core/test/restore-normalization.test.ts` shows on the fictional PGlite seed
   that a refresh on one date changes only the regenerated fields above and that a
   changed fact still differs after normalization. It is a check of the policy, not
   restore evidence, and it does not exercise a date change.
5. Record date, backup age (data age at restore, against the RPO), measured duration
   from step 1 to a passing step 4 (against the RTO), and every mismatch, in the table
   below.

| Drill date | Backup age | Duration | Result |
|---|---|---|---|
| 2026-10-18 local synthetic PostgreSQL | Same run | 2.794 s backup; 5.992 s restore/compare | PASS: 30 tables, 2 views, 13 capability samples, zero mismatches; not hosted/full-size RTO proof |

## Rollback

**Application release.** Redeploy the previous build: `git revert` the merge on `main`
and redeploy, or promote the previous build in the host (hosted timing NOT RUN).
Verify with `/api/health?strict=1` and one request per cache class. API paths are
versioned (`/api/v1`). The design intent is that a rollback does not break a contract
clients saw: v1 changes are meant to be additive, and a breaking change ships as
`/api/v2` beside v1. The local rollback test runs the actual previous app (`8ff5592`)
against a database migrated and seeded by the candidate, compares 13 legacy public
capabilities, parses current legacy answers with the old client's actual schemas,
and opens the old profile, Explore and Sources. This is bounded compatibility proof;
hosted promotion and newer clients using `people.glance` or `explainers.list` are
not covered. Rolling back removes those new capabilities.

**Database migration.** Migrations are forward-only. Each has a hand rollback note in
`packages/db/migrations/README.md`. Roll the app back first (the pinned previous app
has local compatibility proof against this candidate's schema), then apply the note only
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
