# H3 repair round 1: app, parity and human-usability cluster

Branch `fix/h3-app-parity-20261016` from `dd7dbe5` (the commit the independent H3 review
`h3-readiness-2026-10-16` failed). Implementer evidence, not an independent H3: a new
review is needed before any finding is closed. Raw logs, the failing trace and a text
timeline are in [h3-repair-round1-app/](h3-repair-round1-app/). Environment: Windows 10,
8 cores, Node 24, pnpm 11, Playwright 1.64 Chromium, embedded Postgres 17; no network,
no production connection, fictional data only.

Out of scope here (parallel branch `fix/h3-ingest-receipts-20261016`): H3-01..05, H3-07,
H3-08, migration 0005, ingest receipts, safe recovery.

## 1. H3-06: essential-workflow E2E failure (defect)

**Red.** `pnpm --filter web exec playwright test e2e/workflow.spec.ts --project=desktop
--repeat-each=30` (4 workers, both Playwright web servers running) on the unchanged
code: **exit 1, 4 failed, 56 passed** (`h3-06-red-workflow-repeat30.log`). All four
failures are the reported one:

```text
Error: expect(page).not.toHaveURL(expected) failed
Expected pattern: not /q=/
Received string: "http://localhost:3300/explore?q=Ashvale"
  at e2e/workflow.spec.ts:17:26
```

**Root cause (from the trace, `h3-06-red-workflow-trace.zip`, timeline in
`h3-06-red-timeline.txt`).** The home search is a native GET form, so `/explore?q=Ashvale`
is a full page load. The test's next assertions only need server-rendered HTML, so they
pass before hydration. The click on the chip came at 2965 ms; the Explore route's client
chunks (`0eyu-kahzhkld.js`, `0vmqxjnb68n_u.js`) were requested at 2653 ms and arrived at
3483/3493 ms (831-840 ms under load). The chip was a `<button type="button">` whose only
behavior was a React `onClick`, so a click before hydration ran nothing and was not
replayed. **A user action was lost: an application defect, not a harness timeout.** The
same class affected "Clear filters", and a probe showed radios, selects and the name
field changed before hydration were drawn as selected while the URL and table never
changed (visible state contradicting the data shown).

**Deterministic reproduction** (committed with the fix): `apps/web/e2e/before-hydration.spec.ts`
holds every `/_next/static/chunks/**/*.js` request until after the user acts. On the
unchanged code: chips and "Clear filters" **2 failed, 1 passed** (the hydrated control);
form fields **2 failed** (`h3-06-red-before-hydration-*.log`), e.g.

```text
Error: expect(page).toHaveURL(expected) failed
Expected pattern: /chamber=senate/
Received string:  "http://localhost:3300/explore"
```

**Fix** (`76e2408`):

* `apps/web/src/components/explore/url-action-button.tsx`: each active-filter chip and
  "Clear filters" is the submit button of a small GET form whose hidden fields encode the
  target URL (built with the same `serializeExplore`). Before hydration the browser
  navigates natively; after hydration `onSubmit` prevents that and runs the existing
  client-side `setState` (no full page load: asserted by "a filter removed after
  hydration still updates in place").
* `apps/web/src/lib/explore-pending.ts` + `explore-controls.tsx`: on hydration, any form
  field whose DOM value differs from what the server rendered for the URL (radios,
  selects, name; sort and rows now belong to the form via `form=`) is applied once. It
  compares with the server-drawn value, not the URL value, so an option the select
  cannot show (e.g. a header-only sort) is never mistaken for a change.

**Green, same checks.** `before-hydration.spec.ts`: **5 passed** (`h3-06-green-before-hydration.log`).
`workflow.spec.ts --repeat-each=30`, same command: **exit 0, 60 passed, 0 failed**
(`h3-06-green-workflow-repeat30.log`). Full suite after the fix: **48 passed**
(`e2e-full-after-h306.log`). `workflow.spec.ts` itself is unchanged.

**Residual limits.** 30 repeats is a sample: with the observed 4/30 rate, 0/30 by chance
has probability about 1.4 %; final three consecutive full runs below add to it. Other
pages were not swept for JS-only controls (the column picker popover and the framework
builder need JavaScript by design; most other navigation is links). No real slow-device
measurement.

## 2. UI-path value parity and shared state (seven gates)

Not a defect fix; new evidence. `apps/web/e2e/shared-values.spec.ts` (`5aba44b`) with
`e2e/support/pg-stack.ts`: one Postgres (`PG_TEST_URL` or embedded 17) seeded by the
real seed CLI; `scripts/db/roles.sql` plus a `civic_e2e_web` login in `civic_readonly`;
`next start` and the MCP stdio CLI started as **separate production processes on
`DATABASE_URL_READONLY`**; the MCP client is the SDK `StdioClientTransport`.

| Test | Proves |
|---|---|
| pages show the values the API and the MCP server return for the same input | For each check, HTTP and MCP agree, then the page agrees with them. Explore (`scope=all`, total desc, 11 columns, 100 rows): row order, names, total, every cell's `data-value` and visible text (app formatters). Profile: headline facts, money stats, vote rows. Compare (3 members): every cell incl. scorecards, vote agreement pairs. Framework: result order and aligned/considered/not counted/rate, visible "X of Y". |
| a data change plus read-model refresh reaches the UI, the API and MCP alike | Owner connection renames a member and adds $1,234,567 to their FEC totals, then the app's `refreshPersonCard`; all three show the new name and total; `refreshedAt` advances. |
| after restarting the web and MCP processes all three still agree | Both processes stopped and started again (new connections); all checks repeated. |
| a production web server without the read-only role refuses to start | See item 3. |

Pages gained `data-slug`, `data-column`, `data-value`, `data-fact`, `data-stat` and
`data-rollcall` attributes with the capability value each number is drawn from
(`metricValue` in `cell.tsx` mirrors `MetricCell`; the test's own field map is written
independently). No visual change.

**Green:** 4 passed, 2.1 min (`parity-green-shared-values.log`). **Negative control:**
the Explore PAC cell temporarily wired to `smallDollarShare` (visible text only) fails
the first test: `indigo-ivystead pac text  Expected: "11%"  Received: "35%"`
(`parity-negative-control.log`; change reverted, not committed).

**Residual limits.** Not value-compared: profile Scores, Promises, Platform, Career,
outside-spending and industry figures, Policy pages, Sources page, Home. The data change
is a direct owner write plus the app refresh, not `ingest.run` (ingest publication is
H3-01, other branch). The database server itself was not restarted. One browser
(Chromium desktop).

## 3. VC-068: read-only credential in production (gap)

**Red.** `client-readonly.test.ts` and `cli-credentials.test.ts` run against the
unchanged `packages/db/src/client.ts` and `packages/mcp/src/cli.ts` (restored from
`HEAD` for the run): **5 failed, 3 passed** (`vc-068-red-readonly.log`). The unchanged
production MCP CLI ignored the missing role and tried to connect as the owner URL:

```text
AssertionError: expected 'database is not ready (run pnpm db:mi…' to match /DATABASE_URL_READONLY is not set/
AssertionError: expected '' to match /DATABASE_URL_READONLY is not set/
```

**Fix** (`596a7b9`): `dbConfigFromEnv(env, { readOnly: true })` with
`NODE_ENV=production` throws unless `DATABASE_URL_READONLY` is set or
`DB_ALLOW_OWNER_CREDENTIALS=1` (exactly `1`) acknowledges the owner URL or a PGlite
directory; the message names both and never contains a URL. Development and writers
(ingest, migrate, seed) are unchanged. Web: `apps/web/instrumentation.ts` →
`src/server/startup-check.ts` exits 1 at `next start` with one JSON line. MCP: the CLI
evaluates the rule before connecting, also for `--pglite`. The e2e PGlite servers and
the `agent-parity` CI job set the acknowledgement explicitly (throwaway PGlite).

**Green.** Same tests plus `db-config.test.ts`: **11 passed** (`vc-068-green-readonly.log`).
Real role: `test-pg/readonly-credentials.pgtest.ts` **3 passed** (production config ends on
`civic_web_ro`, every public capability served, plain write 25006 and read-write
transaction 42501, owner only with the acknowledgement). Real process:
`shared-values.spec.ts` > "a production web server without the read-only role refuses
to start" (exit 1, message present, no credentials in stderr); manual run printed
`{"level":"fatal","msg":"refusing to start: database configuration","err":"DATABASE_URL_READONLY is not set. ..."}`.

**Residual limits.** A `DATABASE_URL_READONLY` that points at a writable role is not
detected (the role grant is the boundary; a startup privilege probe was not added). Next
logs "Ready" just before the refusal exits. `pnpm ingest:report` (ingest cluster) also
reads with `readOnly`, so it follows the same rule when run with `NODE_ENV=production`.
No hosted provisioning.

## 4. VC-081/055: realistic forward migration test (gap)

`test-pg/migrations-forward.pgtest.ts` (`5d7e86d`), journal-driven (cases are built from
`meta/_journal.json` at collection time, so migration 0005 from the parallel branch
becomes a case automatically). Per earlier version: migrate a fresh database to that
version; copy the seeded dataset (all tables, ids, only the columns that version has;
seed = 40 people, 160 terms, 226 contributions, totals, 12 outside expenditures, 24 roll
calls, 480 vote positions, 144 scorecard scores, promises, 2 frameworks) plus refunds
(a negative receipt beside every 7th contribution and one member refunded in full);
apply every later migration; compare with the same data loaded into the latest schema:
per-table row counts, `person_card` (all columns, refresh time normalized), and the
answers of every public capability (12 members' profiles, money, scores, promises;
Explore, facets, compare, votes, frameworks, sources). Expand-only check: every
`relation.column` (tables, views, matviews) readable at the old version still exists with
the same type.

**Green:** 5 passed (journal check + 0000, 0001, 0002, 0003). **Negative control:** a
temporary `0099` migration that renames one person makes every case fail (`+ "full_name":
"Lost in upgrade"`) and adds a sixth case on its own (`migrations-negative-control.log`;
removed, never committed). The existing `migrations.pgtest.ts` is unchanged.

**Residual limits.** Previous-app compatibility is structural (columns and types), not an
execution of the previous app's code. No rollback, restore or real-data copy. The seed
is fictional and smaller than a live load.

## 5. CI

`.github/workflows/ci.yml` gains an `e2e` job (`203b05e`): checkout, pnpm, Node 24,
`pnpm install --frozen-lockfile`, `playwright install --with-deps chromium`, seed check,
`pnpm --filter @civic-ledger/web test:e2e`, with a `postgres:17` service (`PG_TEST_URL`)
for the shared-values spec and trace upload on failure. Existing jobs unchanged. YAML
parsed locally; **not run on GitHub** (no remote). Note the Playwright config retries once
on CI, which can mask a flaky test; the local runs below use no retries.

## 6. Docs

`docs/AGENT_NATIVE_EVIDENCE.md` re-rated from this evidence (shared capabilities and
shared state PARTIAL with reasons; scoped authority PASS locally; human usability PASS
locally automated; supervision, safe recovery and receipts not re-rated: repair in
progress on the ingest branch). `docs/API.md`: fields added since it was written (`scope`,
`scopes`, `total`, `withData`, card fields, `smallDollar`, `outsideSpending.spenders` /
`itemCount` / `items`, run `scope`) and the production credential rule.
