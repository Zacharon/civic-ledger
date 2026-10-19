# Public API and MCP server

Civic Ledger has two agent-facing adapters over the same capability registry
(`packages/core`, see [CAPABILITIES.md](CAPABILITIES.md)): the JSON API at `/api/v1`
and an MCP stdio server. Both call `dispatchByName`, so validation, defaults, errors
and output shape are those of the capability, not of the adapter. Neither exposes
`ingest.run` or `curated.validate` (operator-only, decision A10).

Conventions common to every capability (A11): money is integer US cents, shares and
rates are fractions in [0, 1], `null` means "no data" (never zero), inputs are strict
(unknown keys are rejected), every fact carries `provenance` (resolve `sourceId` with
`sources.status`).

## Inputs and fields worth knowing

The OpenAPI document and the MCP `inputSchema` / `outputSchema` are the full contract;
these are the parts added after this page was first written (read from the zod schemas
in `packages/core/src/capabilities`):

| Capability | Input or field | Meaning |
|---|---|---|
| `explore.table` | `filters.scope`: `current` (default) or `all` | `current` = the person's latest term covers today (start <= today < end, open end counts), evaluated at query time; `all` adds former members |
| `explore.facets` | input `scope` (default `current`); output `scope`, `scopes` `{current, all}`, `total`, `withData` | Counts for the requested scope; `scopes` always gives both; `withData` = people in the scope with a value (not "no data") per Explore field |
| `people.search` | `scope` (default `all`) | Search finds former members too; every item says `isCurrent` |
| `people.glance` | `slug`; output sections with sentences, facts, provenance and drilldowns | Deterministic profile overview; money, voting and statement coverage retain their separate periods and sources |
| `explainers.list` | empty input | Shared plain-language definitions used by Methodology and agents |
| `explore.table` rows, `people.get` `card`, `people.compare` people | `isCurrent`, `termEnd`, `serviceStart`, `tenureYears`, `smallDollarShare`, `smallDollarAsOf`, `topIndustries`, `industryCodingCoverage`, `scorecards` | `tenureYears` = years actually served; `smallDollarAsOf` = coverage date of the FEC candidate summary behind `smallDollarShare`; `topIndustries` are net-positive industries; `scorecards` only for publishers with cleared terms |
| `money.summary` | `totals.pacShare`, `totals.smallDollarShare` | Shares guarded to [0, 1], else `null`; `totals.unitemizedIndividualCents` is always `null` (weball has no split) |
| `money.summary` | `smallDollar` `{fecCandidateId, unitemizedIndividualCents, itemizedIndividualCents, totalReceiptsCents, share, coverageEndDate, provenance}` or `null` | FEC candidate summary for its own filing period; `share` is `null` outside [0, 1] or when receipts <= 0; its date can trail `totals.coverageEndDate` |
| `money.summary` | `outsideSpending` `{supportCents, opposeCents, spenders, itemCount, items}` | `spenders` sums every expenditure per spender and side (largest first); `itemCount` counts all expenditures; `items` lists only the 50 largest |
| `sources.status` | runs: `scope`, `counts`, `error` | Ingest scope as stored (`all`, `cycle:2026`, `congress:119`) and the run's own counters |

## JSON API

Base path `/api/v1/<capability name>`, for example `/api/v1/people.search`. The
machine-readable contract is generated from the zod schemas at
[`/api/v1/openapi.json`](#openapi) (OpenAPI 3.1).

| Capability | Method | Cache class |
|---|---|---|
| `people.search`, `people.get`, `people.glance`, `people.compare`, `explore.table`, `money.summary`, `votes.list`, `scores.list`, `promises.list` | GET | data: `s-maxage=300, stale-while-revalidate=3600` |
| `policy.areas`, `frameworks.list`, `explainers.list` | GET | reference: `s-maxage=3600, stale-while-revalidate=86400` |
| `sources.status` | GET | status: `s-maxage=60, stale-while-revalidate=300` |
| `frameworks.evaluate` | POST (JSON body, max 256 KiB) | `no-store` |

Other methods answer `405` with an `Allow` header. Unknown or operator-only names
answer `404 not_found`. `OPTIONS` is answered for CORS (any origin may read; there
are no credentials).

### Query encoding (GET)

The handler turns the query string into the typed input the capability's zod schema
expects, driven by that schema (there is no per-capability parsing):

| Input shape | Query form | Example |
|---|---|---|
| number, integer, boolean, string | `name=value`, coerced to the declared type | `limit=5` |
| nested object | `outer.inner=v` or `outer[inner]=v` | `filters.chamber=house` |
| array of scalars | repeat the key or use commas | `slugs=a-b&slugs=c-d` |
| array of objects | indexed keys | `sort.0.column=totalReceiptsCents&sort.0.direction=desc` |
| anything | `input=<url-encoded JSON>` (cannot be combined with other parameters) | `input=%7B%22limit%22%3A5%7D` |

A value that does not fit the declared type stays a string, so validation reports it
exactly as it would for a JSON caller. A repeated scalar key, an unknown key, or a
`__proto__`-style name is a `400`.

```text
GET /api/v1/people.search?chamber=senate&limit=2
GET /api/v1/explore.table?filters.chamber=house&sort.0.column=totalReceiptsCents&sort.0.direction=desc&limit=10
POST /api/v1/frameworks.evaluate   {"framework": {"title": "...", "rules": [...]}, "limit": 25}
```

### Responses

* `200` body is the capability output, validated against its output schema in core;
  nothing outside the schema is returned.
* `GET` responses carry a strong `ETag`; `If-None-Match` answers `304`.
* Every response carries `X-Request-Id` (an inbound id matching `[A-Za-z0-9._-]{8,64}`
  is kept, otherwise one is generated). Quote it when reporting a problem.
* Errors use one body for all adapters:

```json
{ "error": { "code": "invalid_input", "message": "Input failed validation",
             "issues": [{ "path": "limit", "message": "Too small: expected number to be >=1" }] } }
```

| `error.code` | HTTP | Meaning |
|---|---|---|
| `invalid_input` | 400 | validation failed; `issues[].path` is dotted (`filters.chamber`); `405` for a wrong method |
| `invalid_input` | 408 | JSON body exceeded its absolute read deadline or was interrupted; uncached and safe to retry because this endpoint performs no write |
| `not_found` | 404 | unknown capability, or no such person/record |
| `conflict` | 409 | reserved (no read capability raises it) |
| `rate_limited` | 429 | `Retry-After` header and `retryAfterSeconds` say when to retry |
| `internal` | 500 | server fault; details are in the logs under the request id, never in the body |

Errors are `Cache-Control: no-store`.

### Rate limits

Per client address, token bucket: 60 requests burst and 60 per minute sustained;
`frameworks.evaluate` 10 per minute; `/api/health` 30 per minute. HTML pages have their
own, more generous bucket (300 per minute). In production the service refuses traffic
(`503`) until the operator has told it how to identify clients, see OPERATIONS. Responses carry
`RateLimit-Limit` / `RateLimit-Remaining`; a refused call is `429` with `Retry-After`.
Operators: [OPERATIONS.md](OPERATIONS.md#rate-limits).

### <a id="openapi"></a>OpenAPI

`GET /api/v1/openapi.json` is generated from the registry's public capabilities with
`z.toJSONSchema`; a test fails if a public capability is missing or an operator one
appears. Object parameters are documented as `deepObject`, scalar arrays as
repeated keys, and every GET also accepts `input`.

### Health

`GET /api/health` (readiness, never cached, touches the database) and `GET /api/live`
(liveness, no dependencies): see [OPERATIONS.md](OPERATIONS.md#health).

## MCP server

`packages/mcp` is a stdio MCP server (`@modelcontextprotocol/sdk` 1.x) with one tool
per public capability. Tool names replace the dot with an underscore: `people_search`,
`people_get`, `people_compare`, `explore_table`, `money_summary`, `votes_list`,
`scores_list`, `promises_list`, `policy_areas`, `frameworks_list`, `frameworks_evaluate`,
`sources_status`, `explore_facets` (13 tools, one per public capability).

* `inputSchema` and `outputSchema` are JSON Schema generated from the capability's own
  zod schemas. Results are `structuredContent` plus the same JSON as a text block.
* Every tool is annotated `readOnlyHint: true`, `destructiveHint: false`,
  `idempotentHint: true`, `openWorldHint: false`.
* Failures are tool errors (`isError: true`) whose text is the same error body as the
  HTTP API. An unknown tool name (including `ingest_run`, `curated_validate`) is a
  `not_found` tool error.
* Per-session rate limit: 120-call burst, 2 calls per second sustained; beyond it
  the tool error is `rate_limited` with `retryAfterSeconds`.
* Database: `--pglite <dir>` if given, else `DATABASE_URL_READONLY` (Postgres); in
  development it falls back to `DATABASE_URL`, then PGlite at `.pglite/dev` in the
  directory you ran the command from. With `NODE_ENV=production` it refuses to start
  (exit 1, one JSON log line, no URL printed) unless `DATABASE_URL_READONLY` is set or
  `DB_ALLOW_OWNER_CREDENTIALS=1` acknowledges running on the owner URL or a PGlite
  directory (VC-068; the web server applies the same rule at `next start`). It checks
  the database at startup and exits with a clear message if it is empty or unreachable
  (`pnpm db:migrate && pnpm db:seed` for a local dev database).
* Logs are JSON lines on stderr; stdout carries only the protocol.

```powershell
pnpm install
pnpm db:migrate; pnpm db:seed                       # local dev database in .pglite/dev
pnpm --filter @civic-ledger/mcp start               # stdio server, Ctrl+C or closing stdin stops it
pnpm --filter @civic-ledger/mcp start --pglite C:\path\to\db-dir
```

### Claude Code

```powershell
claude mcp add civic-ledger -- pnpm --dir C:/Users/you/Workspace/Civic_Ledger --filter @civic-ledger/mcp start --pglite C:/Users/you/Workspace/Civic_Ledger/.pglite/dev
```

or a project `.mcp.json`:

```json
{
  "mcpServers": {
    "civic-ledger": {
      "command": "pnpm",
      "args": ["--dir", "C:/Users/you/Workspace/Civic_Ledger", "--filter", "@civic-ledger/mcp",
               "start", "--pglite", "C:/Users/you/Workspace/Civic_Ledger/.pglite/dev"]
    }
  }
}
```

### Claude Desktop

Add the same block under `mcpServers` in `claude_desktop_config.json`
(Settings, Developer, Edit config), then restart the app. To read a Postgres database
instead, drop the `--pglite` arguments and set the environment:

```json
{
  "mcpServers": {
    "civic-ledger": {
      "command": "pnpm",
      "args": ["--dir", "C:/Users/you/Workspace/Civic_Ledger", "--filter", "@civic-ledger/mcp", "start"],
      "env": { "DATABASE_URL_READONLY": "postgres://reader:...@host:5432/civic_ledger" }
    }
  }
}
```

Use a read-only database role (`scripts/db/roles.sql`) as `DATABASE_URL_READONLY`; the
server never writes, but the role is the real boundary. (Outside production a plain
`DATABASE_URL` also works.) A PGlite directory can be opened by one process at a time:
stop `next dev` / `next start` (or point them at a different directory) before
starting the MCP server on the same directory.

## Adding a capability

Register it in `packages/core` as `audience: 'public'`. The API route, OpenAPI
document, MCP tool and parity tests pick it up with no adapter change, except: add a
cache class in `apps/web/src/server/api/cache.ts` (otherwise it is `no-store`, and
`handler.test.ts` fails), add representative inputs to `apps/web/test/parity.test.ts`
(it fails until you do), and list it in CAPABILITIES.md.
