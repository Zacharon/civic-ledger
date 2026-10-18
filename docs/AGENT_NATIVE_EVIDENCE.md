# Agent-native evidence: public read capabilities

Applies the owner's feature standard (vault `00_SYSTEM/AGENT_NATIVE_HUMAN_USABLE_STANDARD.md`)
using the plan in [CAPABILITIES.md](CAPABILITIES.md). Scope: the 13 public read
capabilities exposed by the web UI, the JSON API (`/api/v1`) and the MCP server
(`explore.facets` was added with the web UI, DECISIONS A24), plus the operator-side
gates of `ingest.run` where they are stated explicitly below.

Current state as of 2026-10-18 (H3 round-3 target `221d9cd` plus repair cycle 3). Gate
statuses follow the independent H3 readiness review, round 3 (2026-10-18), which rated the read adapters and the
explicitly adopted operator gates of `ingest.run` together; this file does not upgrade any of
them. Round-1 repair evidence: [evidence/h3-repair-round1-app.md](evidence/h3-repair-round1-app.md)
(app, parity, human usability) and [evidence/h3-repair-round1-ingest.md](evidence/h3-repair-round1-ingest.md)
(ingest publication, cancellation, bounded input, replay, manifest); both are merged. The
round-2 ingest findings (H3R2-01 replay retry, H3R2-02 FEC cancellation, H3R2-03 cached
byte cap) are repaired with red/green evidence and merged
([evidence/h3-repair-round2-ingest.md](evidence/h3-repair-round2-ingest.md)). Round 3 found
H3R2-01 and H3R2-03 resolved and H3R2-02 partial (FEC stage DROP/CREATE and sweep DELETE
boundaries unchecked); repair cycle 3 closes those boundaries and adds restore-comparison
normalization ([evidence/h3-repair-round3.md](evidence/h3-repair-round3.md)), not yet
independently re-checked: the targeted re-check closing repair cycle 3 passed (vault audit `h3-cycle3-recheck-2026-10-18`). Ratings below are the round-3 reviewer's, with Visible supervision updated by that re-check.

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

Status words: PASS, FAIL, PARTIAL, NOT RUN, NOT APPLICABLE (reason). Results are local
unless a GitHub run is named. The repository has a public GitHub remote. GitHub CI
(`check`, `postgres`, `e2e`, `audit`, `secret-scan`) passed at `6b93135` (Actions run
39153921815; the `e2e` job retries a failing test once, so green is not first-attempt
proof). The Agent parity workflow **failed** at `6b93135` (run 39153921808: seeded server
never became ready, `/api/health` 503, `relation "source" does not exist`, H3R2-04); its
fix is merged at `33ef2d5`, where both workflows passed (Agent parity run 39156748145, CI
run 39156748139). The `secret-scan` job at `6b93135` covered 0 commits (8 on the first
push) because of the action's push-range scan; it now scans the full history. Its first
full run (39159281652, 42 commits) failed on two reviewed false positives, suppressed by
fingerprint in `.gitleaksignore`; at `26cfb31` it scanned 44 commits with no leaks (CI run
39160013515). Nothing here ran on a host or with a real user.

## Gate table

| Gate | Status | Evidence / reason |
|---|---|---|
| Shared capabilities | PARTIAL | **Adapters (PASS, unchanged):** for 2-4 representative inputs of every public capability, `dispatchByName`, the HTTP handler and the MCP tool return deep-equal payloads (`parity.test.ts` > "read capabilities return equal payloads through dispatch, HTTP and MCP"); identical invalid input yields identical errors (20 cases); "has representative inputs for every public capability" fails on a capability without cases. **UI path (new):** `e2e/shared-values.spec.ts` > "pages show the values the API and the MCP server return for the same input" compares, on one Postgres, the rendered values (`data-value` hooks and the visible text through the app's own formatters) with `/api/v1` and the separate MCP process for: Explore rows (order, names, total, 11 metric columns), a profile's headline facts (raised, PAC share, small-donor share, missed votes), money stats (raised, spent, cash on hand, debts) and its vote rows, Compare cells (incl. scorecards) and vote agreement, and a framework's results (order, aligned/considered/not counted/rate). A negative control (Explore PAC cell wired to the wrong field) fails it. **Why PARTIAL:** the profile Scores, Promises, Platform and Career sections, the outside-spending and industry figures, Policy pages, Sources page and Home preview are not value-compared (they call the same `read()` → `dispatch` path, which is shown structurally only). |
| Shared state | PARTIAL | **Read side (PASS, local):** `shared-values.spec.ts` > "a data change plus read-model refresh reaches the UI, the API and MCP alike" (owner rename + FEC total change, then the app's `refreshPersonCard`; profile heading, card total, Explore row and Compare agree across UI/HTTP/MCP, `refreshedAt` advances) and "after restarting the web and MCP processes all three still agree" (both processes stopped and started: new connections, same values). `parity.test.ts` > "both adapters see state changed after a refresh" (PGlite). **Ingest side (PASS, local, separate tests):** ingest publication is transaction-consistent on both drivers (`publication.test.ts`, `publication.pgtest.ts`; DECISIONS A50). **Why PARTIAL:** the browser scenario still uses a direct owner write, not `ingest.run`, and the database server is not restarted; no single ingest-through-all-surfaces/restart scenario exists. |
| Scoped authority | PASS (local application boundary) | Public readers only; no principal exists in v1. `parity.test.ts` > "operator-only capabilities are unreachable" (`curated.validate`, `ingest.run`, an invented name: HTTP 404 GET/POST, MCP unknown tool; MCP tool list = public set, all `readOnlyHint: true`); `openapi.test.ts`; strict schemas (`query.test.ts`). Abuse limits: `rate-limit.test.ts`, `rate-limit-identity.test.ts`, `server.test.ts` > "session rate limit". **Read-only credential now enforced (VC-068):** with `NODE_ENV=production` web and MCP refuse to start without `DATABASE_URL_READONLY` unless `DB_ALLOW_OWNER_CREDENTIALS=1` (`client-readonly.test.ts`, `db-config.test.ts`, `cli-credentials.test.ts` spawning the real CLI, `shared-values.spec.ts` > "a production web server without the read-only role refuses to start"); on a real `civic_readonly` login every public capability works and writes fail with 25006/42501 (`readonly-credentials.pgtest.ts`, `roles.pgtest.ts`). Not covered: a `DATABASE_URL_READONLY` that points at a writable role is not detected; hosted provisioning NOT RUN (D1). Caller authentication: NOT APPLICABLE (no accounts, public data). |
| Human usability | PASS (local, automated) | Essential AI-free workflow `workflow.spec.ts` (search → filter → sort → profile → compare → framework) plus axe light/dark/mobile, keyboard and URL-state specs. **H3-06 repaired:** the intermittent loss of a click on an Explore filter chip before hydration was reproduced (4 of 30 repeated runs) and fixed; `before-hydration.spec.ts` (5 tests) holds the page scripts and proves chips, "Clear filters", radios, selects and a typed name chosen before hydration are applied; `workflow.spec.ts --repeat-each=30` 60/60 after. Full suite three consecutive runs: see the evidence report. API side: readable structured errors with dotted `issues[].path`, OpenAPI 3.1, `docs/API.md`, request id on every response. NOT RUN: manual screen-reader pass, real-user acceptance. |
| Visible supervision | PASS (documented local operator contract; cycle-3 re-check) | Reads delegate no actions, propose no changes and run no jobs. Operator side: the `ingest_run` ledger, `failed`/`cancelled` status mapping (`cancelled` reads as `failed` in `sources.status@1`, A52) and override notes are inspectable, and a tested cancellation preserves the previous data (`cancellation.test.ts`). **Cycle-3 re-check (independent, 2026-10-18):** genuine operator cancellation at all original and newly identified FEC loader boundaries starts no further loader work and preserves the prior publication on PGlite and Postgres; a lost lock still ends `failed`. Limited to the documented boundaries: a statement already running finishes; driver SAVEPOINT/RELEASE/ROLLBACK TO are not checked; other loaders check per record. No public delegated job or account UI exists or is implied. |
| Safe recovery | PASS (tested local ingest contract; round 3) | Reads have no effects; retries are safe (`idempotentHint: true`, byte-stable 304 in `handler.test.ts`). Operator side: atomic failure rollback (A50) and refusal of a genuinely superseded snapshot replay (A54, `replay-manifest.test.ts`) are tested. **Round 3:** current-generation retry after a forced replay, stale-key refusal, replay lineage and lost-acknowledgement retrieval pass (H3R2-01 resolved). Not claimed: multi-source restoration (replay is not restore), arbitrary Undo, power-loss durability; hosted restore and rollback are unverified (VC-084, VC-055). |
| Receipts | PASS (tested local publication boundary) | Reads change no public state; request ids and one log line per request are traces, not receipts. Operator side: facts, both read models and the `succeeded` row commit together; failures at refresh or at the ledger write, and process loss before commit, preserve the prior data (`publication.test.ts`, `publication.pgtest.ts`); a commit whose acknowledgement was lost still reads as success, and abandoned `running` rows are reaped by a later locked run. The receipt records a safe input summary, source, scope, adapter version, checksum, counts, read-model refresh times, outcome, note and `replayOf`. Not claimed: production durability, verified human identity (actor `operator` means possession of the trusted CLI credential). |

## Other capabilities

| Capability | Status | Note |
|---|---|---|
| `ingest.run@1` | Operator-only; gates rated in the table above | Proven unreachable through HTTP and MCP here. Round-2 findings H3R2-01..03 repaired and merged; awaiting independent re-review. |
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

* CI: both workflows passed on GitHub at `33ef2d5` and `26cfb31` after the Agent parity
  failure at `6b93135` (H3R2-04). GitHub results are CI evidence, not a hosted or
  production run.
* Secret scanning: full history (44 commits at `26cfb31`), no leaks after two reviewed
  false positives were suppressed by fingerprint; merge-commit diffs are not scanned. Bundle, log and screenshot coverage is unverified.
* Live model/platform behavior (Claude Code / Desktop connecting): NOT RUN.
* Hosted or production environment, real TLS, real roles: NOT RUN (decision D1).
* Manual screen-reader and real-user acceptance: NOT RUN.
* Previous-app/new-schema: structural column compatibility only; old app code not executed.
