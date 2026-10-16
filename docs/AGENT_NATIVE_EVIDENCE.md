# Agent-native evidence: public read capabilities

Applies the owner's feature standard (vault `00_SYSTEM/AGENT_NATIVE_HUMAN_USABLE_STANDARD.md`)
using the plan in [CAPABILITIES.md](CAPABILITIES.md). Scope: the 13 public read
capabilities exposed by the JSON API (`/api/v1`) and the MCP server (the 13th,
`explore.facets`, was added with the web UI, DECISIONS A24). The web UI is now on the
same branch; its Playwright specs (`apps/web/e2e/*.spec.ts`: axe, keyboard, URL state,
workflow, performance) exist but are not part of this evidence run, so gates that need
the UI stay marked NOT RUN rather than assumed.

Environment for every test below: Node 24, Vitest 5, in-memory PGlite migrated and
seeded with the fictional dev dataset, no network, no production connection. The HTTP
adapter is exercised through the same `createCapabilityHandler` the Next routes call
(Request in, Response out); the MCP adapter through an in-process SDK client/server
pair (`InMemoryTransport`). `proxy.ts` rate limiting is covered by `createGuard` unit
tests; the Next wiring itself was checked by hand and by the `agent-parity` CI job
(see "Not run"). The opt-in Postgres suite (`pnpm test:pg`, below) repeats the
capability checks on real Postgres 17.

Status words: PASS, FAIL, PARTIAL, NOT RUN, NOT APPLICABLE (reason).

## Gate table (read capabilities)

| Gate | Status | Evidence / reason |
|---|---|---|
| Shared capabilities | PASS | For 2-4 representative inputs of every public capability (`parity.test.ts` > "read capabilities return equal payloads through dispatch, HTTP and MCP", one case per capability), direct `dispatchByName`, the HTTP handler and the MCP tool return deep-equal payloads (MCP `structuredContent` and its text block both). "has representative inputs for every public capability" fails if a capability is added without cases. Identical invalid input yields identical error bodies and the core status mapping (`parity.test.ts` > "the same invalid input fails the same way ...", 20 cases incl. unknown key, type, enum, regex, bounds, missing field, not_found). The web UI calls the same registry through `dispatch` (`apps/web/src/server/capabilities.ts`); no test equates UI loader output with API output. |
| Shared state | PARTIAL | `parity.test.ts` > "both adapters see state changed after a refresh": after a direct data change plus `refreshPersonCard`, dispatch, HTTP and MCP all return the renamed person and the same advanced `readModelRefreshedAt`. Adapters hold no state of their own (the only adapter state is rate-limit counters). Not covered: restart/reconnect of a real server (NOT RUN; the state is the database by construction), and UI-side visibility after a refresh (no test). |
| Scoped authority | PASS | Public readers only, no principal exists in v1 (CAPABILITIES.md). `parity.test.ts` > "operator-only capabilities are unreachable": `curated.validate`, `ingest.run` and an invented name are 404 over HTTP (GET and POST) and an unknown tool over MCP; the MCP tool list equals the public capability set and every tool is `readOnlyHint: true`; `openapi.test.ts` > "documents every public capability and no operator-only one". No write capability exists on either adapter. Input cannot raise rights: strict schemas reject unknown keys (`query.test.ts` > "keeps unknown keys ...", "never pollutes Object.prototype"). Abuse limits: `rate-limit.test.ts` (per-IP bucket, stricter `frameworks.evaluate`, 429 + `Retry-After`), `rate-limit-identity.test.ts` (page bucket; production refuses traffic without a client identity) and `server.test.ts` > "session rate limit". Database credentials: web and MCP can run on a select-only role (`DATABASE_URL_READONLY`, `scripts/db/roles.sql`); `test-pg/roles.pgtest.ts` shows every write, truncate, refresh and DDL statement fails with 42501 on that role. Authentication of callers: NOT APPLICABLE (no accounts, public data). |
| Human usability | PARTIAL | API side: readable structured errors with dotted `issues[].path`, OpenAPI 3.1 at `/api/v1/openapi.json`, `docs/API.md`, request id on every response (`handler.test.ts`, `openapi.test.ts`). Keyboard, screen-reader and AI-free UI workflows: NOT RUN here (Playwright + axe specs exist in `apps/web/e2e`). |
| Visible supervision | NOT APPLICABLE | Reads delegate no actions, propose no changes and run no jobs; there is nothing to approve, cancel or take over. |
| Safe recovery | NOT APPLICABLE | Reads have no effects. Retries are safe by construction (`idempotentHint: true`; `handler.test.ts` > "answers 304 with no body when If-None-Match matches" shows repeat reads are byte-stable). Idempotency keys and stale-revision conflicts belong to `ingest.run`, which is not exposed. |
| Receipts | NOT APPLICABLE | No state changes, so no receipt. Operational traces exist but are not receipts: a request id on every response and one structured log line per request (`handler.test.ts` > "logs one structured line per request"; no headers logged, `redacts authorization and cookie fields`). |

## Other capabilities (outside this branch)

| Capability | Status | Note |
|---|---|---|
| `ingest.run@1` | NOT RUN | Operator CLI, lives in `packages/ingest` (ingest branch). This branch proves only that it is unreachable through HTTP and MCP. |
| `curated.validate@1` | PARTIAL | Shares schemas with the loader via core (existing core tests). Proven unexposed over HTTP/MCP here. |
| Curated data approval | NOT APPLICABLE | Human-only merge in git; no adapter in this branch can approve. |

## Test inventory (this branch)

| File | Tests | Covers |
|---|---|---|
| `apps/web/test/parity.test.ts` | 39 | dispatch = HTTP = MCP payloads (13 capabilities), identical errors (20), operator unreachable (4), shared state after refresh (1), coverage guard (1) |
| `apps/web/test/handler.test.ts` | 17 | headers (ETag, 304, Cache-Control per class, request id, CORS), query coercion end to end, 400/404/405/500 mapping, POST body rules and size cap, cache-class completeness, internal errors hide the cause, log shape and redaction |
| `apps/web/test/query.test.ts` | 16 | schema-driven coercion: numbers, nested objects, indexed arrays, repeated/comma arrays, `input=` JSON, prototype-pollution and index guards |
| `apps/web/test/rate-limit.test.ts` | 13 | token bucket, refill, LRU bound, client IP from trusted headers only, guard 429 + Retry-After, per-rule and per-IP isolation, config parsing |
| `apps/web/test/rate-limit-identity.test.ts` | 11 | production fails closed without a client identity (pages and API 503, probes pass), explicit single-bucket acknowledgement, dev unaffected, page bucket and 429, `/api/live` without the DB, health reports the limiter state |
| `apps/web/test/health.test.ts` | 5 | ok, degraded (stale) and `?strict=1` 503, DB down 503 without driver detail, timeout 503, per-source thresholds |
| `apps/web/test/openapi.test.ts` | 5 | 3.1 document, every public capability present, operator-only absent, parameters and bodies, no dangling `$ref` |
| `packages/mcp/test/server.test.ts` | 9 | tool catalog and annotations, structured + text results, validation tool errors, internal errors hidden, session rate limit |
| `packages/mcp/test/index.test.ts` | 1 | tool naming (pre-existing) |
| `test-pg/*.pgtest.ts` (`pnpm test:pg`, opt-in locally, required in CI) | 34 | real Postgres 17: migrations (fresh, re-apply, latest over a seeded previous version), every public capability equal to PGlite and 200 over `/api/v1`, ingest pipeline, idempotency, cross-connection advisory locks, killed lock connection, shrink-guard rollback, read-only and ingest roles, pool limits and error listener |

## Parity result per capability

All PASS (payload equality across direct dispatch, HTTP and MCP; test
`read capabilities return equal payloads ... > <name>`):

`people.search` (4 inputs), `people.get` (2), `people.compare` (2), `explore.table` (3,
including nested filters and a two-column sort), `explore.facets` (1), `money.summary`
(2), `votes.list` (3), `scores.list` (2), `promises.list` (2, one with a status filter
on a person who has promises), `policy.areas` (1), `frameworks.list` (1),
`frameworks.evaluate` (3, POST, spec taken from the seeded framework), `sources.status`
(1).

The same inputs are compared between PGlite and real Postgres 17 in
`test-pg/capabilities.pgtest.ts` (all 13 PASS; timestamps normalised) and answered 200
through the `/api/v1` handler on Postgres.

## Not run / limitations

* Real Next server: `next build` and `next start` were run locally against a seeded
  PGlite directory and exercised with curl (200 with ETag/304, `s-maxage` headers,
  request id, 404 for operator names, 400 for bad input, 405, 429 with `Retry-After`
  from `proxy.ts`, health, OpenAPI), and the MCP server over real stdio. That is not
  automated in `pnpm test`; the `agent-parity` workflow runs the same checks in CI
  once pushed (not yet run on GitHub).
* Live model/platform behavior (Claude Code / Desktop actually connecting): NOT RUN.
* Hosted or production environment: NOT RUN (no host, decision D1).
* Postgres (`pg`) driver: the default suite uses PGlite. `pnpm test:pg` runs the
  Postgres suite locally on an embedded Postgres 17 (no Docker) and CI runs the same
  suite against a `postgres:17` service container. Local proof only until that CI job
  has run on a remote.
* UI parity (Playwright + axe): specs exist in `apps/web/e2e`; NOT RUN here and not in
  a CI workflow yet.
