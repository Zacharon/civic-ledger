# Civic Ledger — Build Architecture

> Working codename. Product name is an open owner decision (see [DECISIONS.md](DECISIONS.md)).

Civic Ledger puts public money, votes, independent scores, promises and platforms
for every U.S. federal (later: state) officeholder and candidate in **one sortable
table**, without picking an ideological winner. Every number links back to a
primary source. Any "alignment" score is opt-in, attributed to a named framework,
and shows its numerator, denominator and the exact bills behind it.

Readiness profile: **W** (hosted web app / API). Registry: VC-001–VC-111 in the
vault's `03_STANDARDS/Engineering/production-readiness-audit.md`.

## 1. Product principles (these are acceptance rules, not slogans)

1. **Facts before judgments.** The default view shows raw data and several
   independent scores side by side. No default sort uses an ideological score.
2. **Every score is attributed.** Third-party scores show the publisher, their
   self-described orientation, year, scale and methodology link. Framework scores
   show the author, rules and the bill list ("29 of 31 actions aligned").
3. **Every fact has provenance.** Each row carries `source_id`, the source's own
   record key, `ingest_run_id` and `retrieved_at`. The UI exposes "Source" links.
4. **Coverage is visible.** In-house coding (e.g., PAC → industry) reports a
   coverage percentage; gaps say "not coded", never a silent zero.
5. **Same rules for people and agents.** Human UI, public JSON API and MCP tools
   call the same core commands (see [CAPABILITIES.md](CAPABILITIES.md)).

## 2. System shape

```text
                 ┌────────────────────── sources (public, no login) ──────────────────────┐
                 │ congress-legislators YAML/JSON · FEC bulk · Voteview CSV · GovInfo     │
                 │ BILLSTATUS XML · Congress.gov API (key) · OpenStates (phase 3, key)    │
                 └───────────────┬────────────────────────────────────────────────────────┘
                                 │ fetch (timeout, retry+backoff, checksum, raw snapshot)
                       packages/ingest  ── run ledger (ingest_runs) ── idempotent upserts
                                 │
                       packages/db (Postgres, Drizzle, versioned SQL migrations)
                       facts tables ─► read models (person_card materialized view)
                                 │
                       packages/core (zod-typed, versioned capabilities; pure query/command fns)
                 ┌───────────────┼─────────────────────────┐
           apps/web (Next.js)  /api/v1 (route handlers)   packages/mcp (MCP stdio server)
           human UI            public JSON API            agent capability adapter
```

One language (TypeScript, Node 24), one package manager (pnpm workspaces), one
database (Postgres). Locally and in tests the database is **PGlite** (embedded
Postgres, no Docker); in production it is a managed or self-hosted Postgres
(owner selected Render web plus managed Postgres, D1; provisioning remains gated).
Drizzle schema and migrations are identical for both. The production start command
uses a bounded native Node HTTP server around the Next handler; it keeps the same
core/API/MCP boundaries. See OPERATIONS for deadlines and safe diagnostic fields.

Profiles also expose `people.glance`, a deterministic overview assembled in core,
and Methodology exposes `explainers.list`. Both use the public registry. The Home
member finder leads to the existing state/district/chamber Explore filters.
Research crawlers, if trialed later, can collect review evidence; they cannot
approve curated claims or bypass source-adapter validation.

### Repository layout

```text
apps/web              Next.js App Router UI + /api/v1 route handlers (thin adapters)
packages/db           Drizzle schema, migrations, db client factory (pglite | pg)
packages/core         Capability registry, zod I/O schemas, query + command handlers
packages/ingest       Source adapters, run ledger, CLI (`pnpm ingest <source>`)
packages/mcp          MCP server exposing core capabilities to agents
data/curated          Git-reviewed curated data: promises, platforms, frameworks, industry map
data/raw              Raw source snapshots (gitignored; checksummed in ingest_runs)
docs/                 Architecture, capabilities, sources, design, decisions, readiness
```

Dependency rule: `web`, `mcp` → `core` → `db`. `ingest` → `db` (+ `core` schemas).
Nothing imports from `apps/*`. No adapter talks to the database directly.

## 3. Data model

Natural keys from sources are unique constraints so every load is an idempotent
upsert. All fact tables carry the provenance columns
`source_id, source_key, ingest_run_id, retrieved_at`.

| Area | Tables | Key / notes |
|---|---|---|
| Identity spine | `person`, `person_identifier(scheme, value)` | Schemes: `bioguide`, `fec_candidate`, `icpsr`, `opensecrets`, `govtrack`, `openstates`, `wikidata`. Seeded from congress-legislators. |
| Offices | `office`, `term(person, office, party, start, end)` | Office = level (federal/state) + chamber + state + district. |
| Campaigns | `candidacy(person, cycle, office, fec_candidate_id, party, outcome)` | Cross-campaign history for the same person. |
| Money | `committee`, `committee_link(candidate↔committee)`, `candidate_cycle_totals`, `committee_contribution(pas2)`, `independent_expenditure` | FEC bulk: `cn`, `cm`, `ccl`, `weball`, `pas2`, IE CSV. Amounts in integer cents. |
| Industry coding | `industry`, `committee_industry(committee, industry, method, confidence)` | In-house map from `data/curated/industry_map`; coverage % reported. |
| Legislation | `bill(congress, type, number)`, `bill_policy_area`, `bill_subject` | GovInfo BILLSTATUS (policy area = Congress.gov's ~32-area taxonomy, the neutral base). |
| Votes | `rollcall(congress, chamber, number)`, `vote_position(rollcall, person, position)`, `rollcall_bill` | Voteview `HS{n}_rollcalls` + `HS{n}_votes`. |
| Ideology | `ideology_score(person, congress, method, dim1, dim2)` | Voteview DW-NOMINATE. Labeled "academic, roll-call based". |
| Scorecards | `scorecard_publisher(name, self_described_orientation, terms_status, url)`, `scorecard_score` | Ingest only when `terms_status = cleared` (D2). Until then: links only. |
| Promises | `promise`, `promise_rating(status, rater, evidence[])` | From `data/curated/promises/*.yaml`, git-reviewed (D3). |
| Platforms | `platform_position(person, cycle, policy_area, stance, source_url)` | Curated, same review flow. |
| Frameworks | `framework(id, version, author, stated_orientation)`, `framework_rule(rollcall|bill, aligned_position, weight)` | Pre-built frameworks are files in `data/curated/frameworks`; user frameworks are stateless (URL-encoded spec). |
| Operations | `source`, `ingest_run(source, started, finished, status, counts, checksum, error)` | Run ledger = receipts for every load. |

### Read model

`person_card` (materialized view, refreshed at the end of each successful ingest)
holds one row per person (DECISIONS A7; current vs former members is a query-time scope, A30) with every
sortable column: party, state, chamber, tenure, DW-NOMINATE dim1/dim2, total
receipts, PAC share, small-dollar share, top 3 industries (+ coding coverage),
outside spending for/against, missed-vote %, promise kept rate (where rated),
and one column per cleared scorecard. The Explore table reads only this view, with
indexes on each sortable column. Profiles read the fact tables.

## 4. Ingest

Each source is an adapter:

```ts
interface SourceAdapter {
  id: SourceId;                 // 'congress-legislators' | 'fec-bulk' | 'voteview' | 'govinfo-billstatus' | ...
  license: string;              // terms summary + URL, shown on Sources page
  plan(opts): FetchPlan;        // which files/pages for which cycle/congress
  fetch(plan, ctx): RawSnapshot // timeout 30s/request, 3 retries w/ exponential backoff + jitter on 429/5xx only
  parse(snapshot): AsyncIterable<Record>   // streaming; no whole-file buffering for large CSVs
  load(records, tx): LoadCounts // batched idempotent upserts on natural keys
}
```

- Every run writes an `ingest_run` row first (`running`), then the outcome
  (`succeeded | failed | partial`) with counts and the raw snapshot checksum.
- Same snapshot checksum + same adapter version = no-op (dedupe).
- A per-source advisory lock prevents overlapping runs (VC-021, VC-039).
- Publication is one transaction (one savepoint per batch, DECISIONS A41, A50): the load,
  the shrink guard, `REFRESH MATERIALIZED VIEW CONCURRENTLY` of `person_card` and
  `person_card_scorecard`, and the `succeeded` receipt commit together or not at all;
  the refresh runs before the commit, inside the same transaction. A shrink guard rolls
  back a load that would delete more than 10% of a source's rows or load under half the
  last run's records (A42, per dataset A51).
- Schedules (production, later): legislators daily, FEC bulk weekly, Voteview
  weekly, BILLSTATUS daily. Runner: GitHub Actions cron (D1 decides the target DB).
- Tests use committed small fixtures; no network in CI.

### Source order (build sequence)

1. congress-legislators → identity spine (current + historical).
2. Voteview → rollcalls, positions, DW-NOMINATE.
3. FEC bulk → candidates, committees, totals, PAC contributions, outside spending.
4. GovInfo BILLSTATUS → bills, policy areas, subjects; join rollcalls to bills.
5. Curated YAML → industry map, frameworks, promises, platforms.
6. Phase 3: OpenStates (state legislators, bills, votes), cleared scorecards.

OpenSecrets is a link target and later enrichment, not a dependency (bulk access
is application-gated). ProPublica's Congress API is shut down and is not used.

## 5. Capabilities and adapters

Business logic lives in `packages/core` as named, versioned capabilities with zod
input/output schemas. Adapters are thin:

- **Web UI** (server components / server actions) calls core directly.
- **Public API** `/api/v1/<capability>`: GET for reads, JSON in/out, OpenAPI
  generated from the zod schemas, `ETag` + `Cache-Control` per route.
- **MCP server** exposes the same capabilities as tools with the same schemas.

The capability list and the seven-gate evidence plan are in
[CAPABILITIES.md](CAPABILITIES.md).

## 6. Web experience

| Route | Purpose |
|---|---|
| `/` | Search-first home: one search box, three example questions, data freshness strip. |
| `/explore` | The multi-axis table: filter by chamber, state, party, policy area; sort by any money, ideology, scorecard, promise column. All state in the URL (shareable). |
| `/people/[slug]` | Profile: header (office, party, tenure), Money, Votes by policy area, Scores side by side, Promises, Platform vs record, Career across campaigns. |
| `/compare?ids=` | 2–4 people in aligned columns. |
| `/policy/[area]` | Key votes in an area, how every member voted, money from related industries. |
| `/frameworks` | Pick or build a framework; see "X of Y" with the exact votes per member. |
| `/sources`, `/methodology` | Every source, terms, last successful run, coverage %. |

Design system and visual rules: [DESIGN.md](DESIGN.md) (owned by the UI build).
Non-partisan visual rules: party color only on small party chips (muted), never as
page chrome; no red/green "good/bad" coloring of ideological scores; numbers use
tabular figures; every chart states its source and as-of date.

## 7. Cross-cutting backend rules (map to VC registry, profile W)

| Concern | Rule | VC |
|---|---|---|
| Timeouts | Every outbound fetch and DB statement has an explicit timeout (`AbortSignal.timeout`, `statement_timeout`: 15 s web/MCP, 10 min ingest; plus `lock_timeout` and `idle_in_transaction_session_timeout`). All env-configurable. | 011 |
| Retries | Transient-only (429/5xx/network), max 3, exponential backoff + full jitter. Never on non-idempotent writes. | 012, 013 |
| Idempotency | Natural-key upserts; snapshot checksum dedupe; capability writes take an idempotency key. | 014 |
| Backpressure | Streaming parse with bounded batches; API rate limit returns 429 with `Retry-After`. | 044, 001 |
| Indexes | Every filter/sort column of `person_card` and every FK used in profile queries is indexed (tested). EXPLAIN on full-cycle data on Postgres is **not yet recorded**; do it after the first live load. | 025–027 |
| Pooling | `pg` pool with limits from env and an `error` listener; separate read-only and ingest credentials (`scripts/db/roles.sql`); PGlite single connection in dev/test. Connection budget in OPERATIONS. | 028, 068, 095 |
| Migrations | Drizzle SQL migrations, committed, applied by `pnpm db:migrate`; forward-only with a documented rollback note per migration. | 081, 055 |
| Schema versioning | Curated YAML and exported JSON carry `schema_version`. API is versioned at `/api/v1`. | 082, 102 |
| Caching | Time-based only: read API responses carry `s-maxage` + `stale-while-revalidate` and a strong `ETag` (304 on revalidation); pages are dynamic and uncached. There is **no** push invalidation (no `revalidateTag`: ingest is a separate process); a CDN purge after ingest is an operator step. No private data exists to leak at the edge. | 002, 049, 050 |
| Security | Parameterized queries only (Drizzle); untrusted text (curated, source) rendered as text, never HTML; CSP; no server fetch of user-supplied URLs. | 078, 079, 080 |
| Secrets | API keys (Congress.gov, FEC, OpenStates) only via env; `.env*` gitignored; secret scan in CI. | 067 |
| Health | `/api/health` (readiness) checks DB round-trip, latest ingest run age per source and the rate-limit identity; `/api/live` (liveness) touches nothing. | 056, 057 |
| Logging | Structured JSON logs (pino) with request id / run id; no PII beyond public-official data. | 059, 066 |
| CI | Lint, typecheck, unit + integration tests (PGlite), build, dependency audit and the Postgres 17 suite (`pnpm test:pg`) on every push. | 006, 108, 028, 081 |

Write access in v1 is limited to operators (ingest CLI) and git-reviewed curated
data, so OAuth/JWT/CSRF items are N/A until an account feature exists (recorded with
reasons in the readiness audit).

## 8. Phases

| Phase | Output | Gate to next |
|---|---|---|
| 1 Foundation | Monorepo, db schema + migrations, core capability registry, CI | `pnpm check` green |
| 2 Parallel build | Ingest (sources 1–5), web UI, API + MCP adapter, ops | Each branch green; integration branch green |
| 3 Verify | P2 readiness audit (profile W), seven-gate evidence, H3 by an independent model | H3 verdict recorded |
| 4 Release prep (owner-gated) | Hosting (D1), domain, P4 gate, App Pre-Launch Gate | Owner approval |
| 5 Expansion | OpenStates, cleared scorecards, promise coverage | — |
