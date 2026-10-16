# Agent-native evidence: public read capabilities

Applies the owner's feature standard (vault `00_SYSTEM/AGENT_NATIVE_HUMAN_USABLE_STANDARD.md`)
using the plan in [CAPABILITIES.md](CAPABILITIES.md). Scope: the 13 public read
capabilities exposed by the web UI, the JSON API (`/api/v1`) and the MCP server
(`explore.facets` was added with the web UI, DECISIONS A24), plus the operator-side
gates of `ingest.run` where they are stated explicitly below.

Updated for the H3 repair round 1 (app, parity and human-usability cluster); evidence and
red/green runs: [evidence/h3-repair-round1-app.md](evidence/h3-repair-round1-app.md). The
ingest-cluster gates (safe recovery, receipts, publication of ingest writes) are being
repaired on a separate branch and are **not** re-rated here: see
`h3-repair-round1-ingest`.

Environments:

* Default suite (`pnpm test`): Node 24, Vitest 5, in-memory PGlite migrated and seeded
  with the fictional dev dataset, no network, no production connection. HTTP through the
  same `createCapabilityHandler` the Next routes call (Request in, Response out); MCP
  through an in-process SDK client/server pair (`InMemoryTransport`).
* Postgres suite (`pnpm test:pg`): real Postgres 17 (embedded locally, `postgres:17`
  service in CI), one database per file.
* Browser suite (`pnpm --filter @civic-ledger/web test:e2e`): Playwright Chromium against
  `next start` production builds. Most specs use a throwaway PGlite per server;
  `shared-values.spec.ts` runs `next start` and the MCP stdio server as **separate
  production processes on one Postgres 17 database through a select-only login**.

Status words: PASS, FAIL, PARTIAL, NOT RUN, NOT APPLICABLE (reason). All results are
local; nothing here was run on GitHub, a host or by a real user.

## Gate table

| Gate | Status | Evidence / reason |
|---|---|---|
| Shared capabilities | PARTIAL | **Adapters (PASS, unchanged):** for 2-4 representative inputs of every public capability, `dispatchByName`, the HTTP handler and the MCP tool return deep-equal payloads (`parity.test.ts` > "read capabilities return equal payloads through dispatch, HTTP and MCP"); identical invalid input yields identical errors (20 cases); "has representative inputs for every public capability" fails on a capability without cases. **UI path (new):** `e2e/shared-values.spec.ts` > "pages show the values the API and the MCP server return for the same input" compares, on one Postgres, the rendered values (`data-value` hooks and the visible text through the app's own formatters) with `/api/v1` and the separate MCP process for: Explore rows (order, names, total, 11 metric columns), a profile's headline facts (raised, PAC share, small-donor share, missed votes), money stats (raised, spent, cash on hand, debts) and its vote rows, Compare cells (incl. scorecards) and vote agreement, and a framework's results (order, aligned/considered/not counted/rate). A negative control (Explore PAC cell wired to the wrong field) fails it. **Why PARTIAL:** the profile Scores, Promises, Platform and Career sections, the outside-spending and industry figures, Policy pages, Sources page and Home preview are not value-compared (they call the same `read()` → `dispatch` path, which is shown structurally only). |
| Shared state | PARTIAL | **Read side (PASS, local):** `shared-values.spec.ts` > "a data change plus read-model refresh reaches the UI, the API and MCP alike" (owner rename + FEC total change, then the app's `refreshPersonCard`; profile heading, card total, Explore row and Compare agree across UI/HTTP/MCP, `refreshedAt` advances) and "after restarting the web and MCP processes all three still agree" (both processes stopped and started: new connections, same values). `parity.test.ts` > "both adapters see state changed after a refresh" (PGlite). **Why PARTIAL:** the change is a direct owner write, not `ingest.run`; whether ingest publishes facts and read model consistently is H3-01, repair in progress (see `h3-repair-round1-ingest`). A database-server restart was not exercised. |
| Scoped authority | PASS (local application boundary) | Public readers only; no principal exists in v1. `parity.test.ts` > "operator-only capabilities are unreachable" (`curated.validate`, `ingest.run`, an invented name: HTTP 404 GET/POST, MCP unknown tool; MCP tool list = public set, all `readOnlyHint: true`); `openapi.test.ts`; strict schemas (`query.test.ts`). Abuse limits: `rate-limit.test.ts`, `rate-limit-identity.test.ts`, `server.test.ts` > "session rate limit". **Read-only credential now enforced (VC-068):** with `NODE_ENV=production` web and MCP refuse to start without `DATABASE_URL_READONLY` unless `DB_ALLOW_OWNER_CREDENTIALS=1` (`client-readonly.test.ts`, `db-config.test.ts`, `cli-credentials.test.ts` spawning the real CLI, `shared-values.spec.ts` > "a production web server without the read-only role refuses to start"); on a real `civic_readonly` login every public capability works and writes fail with 25006/42501 (`readonly-credentials.pgtest.ts`, `roles.pgtest.ts`). Not covered: a `DATABASE_URL_READONLY` that points at a writable role is not detected; hosted provisioning NOT RUN (D1). Caller authentication: NOT APPLICABLE (no accounts, public data). |
| Human usability | PASS (local, automated) | Essential AI-free workflow `workflow.spec.ts` (search → filter → sort → profile → compare → framework) plus axe light/dark/mobile, keyboard and URL-state specs. **H3-06 repaired:** the intermittent loss of a click on an Explore filter chip before hydration was reproduced (4 of 30 repeated runs) and fixed; `before-hydration.spec.ts` (5 tests) holds the page scripts and proves chips, "Clear filters", radios, selects and a typed name chosen before hydration are applied; `workflow.spec.ts --repeat-each=30` 60/60 after. Full suite three consecutive runs: see the evidence report. API side: readable structured errors with dotted `issues[].path`, OpenAPI 3.1, `docs/API.md`, request id on every response. NOT RUN: manual screen-reader pass, real-user acceptance. |
| Visible supervision | NOT APPLICABLE (reads); operator side: repair in progress | Reads delegate no actions, propose no changes and run no jobs. Ingest cancellation and outcome visibility (H3-04, H3-01) are repaired in `h3-repair-round1-ingest`; not re-rated here. |
| Safe recovery | NOT APPLICABLE (reads); operator side: repair in progress | Reads have no effects; retries are safe (`idempotentHint: true`, byte-stable 304 in `handler.test.ts`). Ingest recovery (failed-run publication, snapshot replay) is repaired in `h3-repair-round1-ingest`; the H3 FAIL stands until that branch's evidence. |
| Receipts | NOT APPLICABLE (reads); operator side: repair in progress | No public state change, so no receipt; request ids and one log line per request are traces, not receipts. `ingest_run` receipt consistency (H3 FAIL) is repaired in `h3-repair-round1-ingest`. |

## Other capabilities

| Capability | Status | Note |
|---|---|---|
| `ingest.run@1` | Repair in progress (ingest cluster) | Proven unreachable through HTTP and MCP here. |
| `curated.validate@1` | PARTIAL | Shares schemas with the loader via core. Proven unexposed over HTTP/MCP. |
| Curated data approval | NOT APPLICABLE | Human-only merge in git; no adapter can approve. |

## Schema upgrades (supporting shared state across releases)

`test-pg/migrations-forward.pgtest.ts` reads the migration journal and, for every earlier
version, loads the seed plus refunds at that version, applies every later migration and
asserts row counts, `person_card` and every public capability's answers equal the same
data loaded straight into the latest schema, and that no column readable at the old
version was dropped or retyped (VC-081/055). Not covered: executing the previous app's
code against the new schema (structural compatibility only), rollback and restore.

## Test inventory (this branch)

| File | Tests | Covers |
|---|---|---|
| `apps/web/test/parity.test.ts` | 39 | dispatch = HTTP = MCP payloads (13 capabilities), identical errors (20), operator unreachable (4), shared state after refresh (1), coverage guard (1) |
| `apps/web/test/handler.test.ts` | 17 | headers, query coercion, error mapping, POST rules, cache classes, log shape and redaction |
| `apps/web/test/query.test.ts` | 16 | schema-driven coercion and pollution guards |
| `apps/web/test/rate-limit.test.ts` | 13 | token bucket, trusted client IP, 429 + Retry-After |
| `apps/web/test/rate-limit-identity.test.ts` | 11 | production fails closed without client identity, page bucket, `/api/live` |
| `apps/web/test/health.test.ts` | 5 | ok, degraded, strict 503, DB down, timeout |
| `apps/web/test/openapi.test.ts` | 5 | 3.1 document, public only, no dangling `$ref` |
| `apps/web/test/db-config.test.ts` | 3 | startup check: production refusal, read-only role, acknowledged PGlite, development unchanged |
| `packages/db/test/client-readonly.test.ts` | 5 | production read-only rule, acknowledgement values, no URL in messages, writers unaffected |
| `packages/mcp/test/cli-credentials.test.ts` | 3 | the real MCP CLI exits 1 without the role (also `--pglite`), passes the check when acknowledged |
| `packages/mcp/test/server.test.ts` | 9 | tool catalog, annotations, results, errors, session rate limit |
| `packages/mcp/test/index.test.ts` | 1 | tool naming |
| `apps/web/e2e/shared-values.spec.ts` | 4 | UI = HTTP = MCP values on one Postgres; after change + refresh; after restart; web refuses owner credentials |
| `apps/web/e2e/before-hydration.spec.ts` | 5 | H3-06: actions taken before hydration are applied |
| `apps/web/e2e/*.spec.ts` (others) | 41 + 2 performance | workflow, axe, keyboard, URL state, performance budget |
| `test-pg/readonly-credentials.pgtest.ts` | 3 | production config ends on the select-only login; writes refused; acknowledged owner |
| `test-pg/migrations-forward.pgtest.ts` | journal entries | forward upgrade from every earlier version (one case per version + journal check) |
| `test-pg/*.pgtest.ts` (others) | 34 | migrations, capabilities pg = PGlite + HTTP, ingest, locks, roles, pool |

## Parity result per capability (adapters)

All PASS (payload equality across direct dispatch, HTTP and MCP; test
`read capabilities return equal payloads ... > <name>`): `people.search`, `people.get`,
`people.compare`, `explore.table`, `explore.facets`, `money.summary`, `votes.list`,
`scores.list`, `promises.list`, `policy.areas`, `frameworks.list`, `frameworks.evaluate`,
`sources.status`. The same inputs are compared between PGlite and real Postgres 17 in
`test-pg/capabilities.pgtest.ts`. UI-path value equality: `explore.table`, `people.get`,
`money.summary`, `votes.list`, `people.compare`, `frameworks.list` / `frameworks.evaluate`
(shared-values spec); the others are not value-compared on a page.

## Not run / limitations

* CI: the `e2e`, `postgres` and `agent-parity` jobs are configured but have not run on
  GitHub (no remote). Local proof only.
* Live model/platform behavior (Claude Code / Desktop connecting): NOT RUN.
* Hosted or production environment, real TLS, real roles: NOT RUN (decision D1).
* Manual screen-reader and real-user acceptance: NOT RUN.
* Previous-app/new-schema: structural column compatibility only; old app code not executed.
