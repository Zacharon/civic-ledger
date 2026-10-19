# Complete UI value parity and ingest/restart proof

Date: 2026-10-18. Base: `8ff5592`, branch `claude/parity-complete-20261018`.
Scope: close the remaining local evidence gaps in pins 4–5. This does not change
the independent H3 verdict or certify hosted operation. The 11 interrupted UI edits
were preserved and completed as additive observation attributes; business rules,
real curated data, authorization and public API schemas are unchanged.

## What is compared

`apps/web/e2e/shared-values.spec.ts` starts a production-built web process and a
separate MCP stdio process against one test-owned Postgres 17 database. Both use
the select-only login. Each capability is called through actual HTTP and MCP;
their payloads must deep-equal. Tests then select the expected business fields
independently and compare both raw DOM observation attributes and the text or
accessible labels a person can read. The app's pure number/date formatters are
reused for display conventions; component mapping functions are not reused.

The existing Explore, profile headline/money/votes, Compare and framework checks
remain. Added coverage:

| Surface | Values and readable presentation checked |
|---|---|
| Scores | Latest first/second academic dimensions, historical dimensions, Congress, peer placement accessible label, each publisher's latest score/year/scale and earlier scores, methodology links, link-only publishers |
| Promises | Total/rated/kept/rate, statement, current status, date and policy area, dated reviewer statuses, source and evidence links; unrated and absent promises |
| Platform | Cycle, area, stance, campaign URL, corresponding vote positions/titles and count; absent platforms |
| Career | Chronological term dates/seats/parties and campaign cycles/seats/outcomes; former member without campaigns |
| Industry | Gross PAC dollars, coverage, ranked gross dollar values and percentages, uncoded dollars; totals present with no itemized contributions |
| Outside spending | For/against totals, spender/item counts, spender side/dollar/buy values, largest expenditures and dates; no spending |
| Policy index/detail | Every area's bill/roll-call counts, selected area's House and Senate roll calls/tallies/party subtotals, member position matrix and readable position labels |
| Sources | Read-model time, source count, gross-dollar coverage, last run versus last success, never-loaded state, failure text, and receipt counters with cents/basis-point units |
| Home | Preview order/names/money/PAC/missed-vote values, current-member counts, source freshness/failure state, coverage and area/scorecard/framework totals |

All data is fictional. Test-only supplemental seed states include an earlier
academic score, a source never loaded, and a source whose latest failed load
retains an earlier success. A fictional `X000001` identifier aliases fictional
Avery Ashvale so an actual curated input passes the same Bioguide validation as
operator inputs. No public source is fetched.

## One publication across all surfaces and all process restarts

The new scenario invokes the real operator CLI for `ingest.run@1`, with committed
test-only snapshot files, an isolated raw directory and owner credentials for the
writer. It loads two promises (one kept, one unrated) and two platform positions.
It checks:

1. Success receipt, actor, operation, source and exact changed record counts.
2. Newly published statement/status and provenance run id in HTTP/MCP and the
   rendered profile, refreshed promise counts/rate in Explore and Compare, and
   the same receipt and refresh time in Sources/Home.
3. Retrying the identical input returns the original run with `deduplicated: true`.
4. Web and MCP stop and close their clients before Postgres stops. The database
   restarts from the same persistent fixture directory, with fsync enabled. Actual
   postmaster PIDs read from `postmaster.pid` must differ.
5. New web/MCP processes reproduce identical profile, money, scores, promises,
   refreshed Explore rows and Sources responses. An explicit JSON evidence file
   records the receipt, retry, PIDs, published values and equality result.

The fixture owns every process it stops. It never restarts `PG_TEST_URL`; this
scenario always starts its own embedded server. On Windows the embedded-postgres
package stops its own Postgres tree with `taskkill /f` (SIGINT elsewhere). This is
local process restart evidence, not power-loss, hosted backup, multi-source
restoration or service-level evidence.

## Verification and negative control

Environment: Windows, Node `24.16.0`, pnpm `11.13.1`, Next `16.4.1`, Chromium,
embedded Postgres `17.10.0-beta.17`. One Playwright worker, zero retries, fresh
fixture database per invocation. The dedicated `playwright.parity.config.ts`
avoids unrelated PGlite scale servers; the default browser configuration still
discovers this spec.

* `pnpm --filter @civic-ledger/web typecheck`: PASS.
* Production build: PASS. Existing whole-project filesystem-tracing warning from
  `packages/db/src/client.ts` remains; no new warning fix is claimed here.
* First complete positive browser run: **7/7 PASS, 2.1 minutes** (`parity-run-2.log`).
* Intentional negative control: **expected FAIL** (`parity-negative.log`). Only
  `<PositionStrip value={latest.dim1}>` was temporarily changed to
  `<PositionStrip value={latest.dim2 ?? 0}>`; API/MCP and observation attributes
  were untouched. Raw data remained `[119,-0.366,0.004]`, while the visible first
  dimension became `+0.004`. The assertion rejected it because it expected
  `−0.366`. This demonstrates that correct raw hooks cannot conceal a business
  field rendered from the wrong value. The mutation was restored before the
  final build.
* Final restored build: **PASS**, `parity-final-build.log`.
* Final scoped lint: **PASS**, 27 files, `parity-final-lint.log`.
* Final web TypeScript: **PASS**, `parity-final-typecheck.log`.
* Final focused browser suite: **7/7 PASS, 2.5 minutes**, `parity-final.log`.
* Direct-dispatch/HTTP/MCP adapter tests: **41/41 PASS**, 14.23 seconds,
  `parity-adapters.log` (`pnpm exec vitest run apps/web/test/parity.test.ts`).

Final publication receipt: run `4`, `succeeded`; 2 promises, 1 rating and 2
platform positions. The profile/read model reports 4 total promises, 3 rated,
2 kept, rate `0.6666666666666666`. The refresh timestamp advances from
`2026-10-19T00:14:14.117Z` to `2026-10-19T00:14:55.407Z` (UTC). Postmaster PID
`78608` becomes `82120`; the full published responses remain equal after restart.

Earlier evidence is retained: `parity-run-1.log` records the curated validator
correctly rejecting the initial synthetic `ZZ00001` identifier (the general dev
seed intentionally uses that non-Bioguide format). This was a fixture mismatch;
the fix adds a valid-shaped fictional alias in test setup. A prior exploratory
default-config run was stopped after its baseline passed, to avoid waiting for
unrelated 600-member server setup. No product bug repair is claimed.

Reproduce after building:

```powershell
pnpm --filter @civic-ledger/web build
pnpm --filter @civic-ledger/web exec playwright test -c playwright.parity.config.ts
```

Raw files are local ignored artifacts in this worktree. The negative trace is
`apps/web/test-results/parity-negative/shared-values-remaining-pr-18e5a-ues-through-UI-HTTP-and-MCP/trace.zip`.
The final ingest/restart JSON is
`apps/web/test-results/parity-final/shared-values-actual-inges-98dac-tarts-with-unchanged-values/ingest-and-restart.json`.
Logs and traces are not transferred by cherry-pick; tests reproduce
them. No full `pnpm check`, full browser suite, fresh H3 or hosted check is claimed
for this slice; integration must run the required combined checks.

## Bounded seven-gate contribution

| Gate | Contribution of this slice |
|---|---|
| Shared capabilities | Local expanded rendered-value equality across UI/HTTP/MCP, including a visible-field negative control |
| Shared state | Actual curated operator publication through all surfaces and equal durable answers after web/MCP/Postgres restarts |
| Scoped authority | Existing select-only app connections and production refusal test retained; no new authority granted |
| Human usability | Ordinary readable UI text, links, missing-state explanations and accessible matrix/scatter labels checked; manual screen reader and real users NOT RUN |
| Visible supervision | Actual CLI receipt and source ledger inspected; no public jobs or delegated actions introduced |
| Safe recovery | Duplicate retry returns original receipt and local restart preserves publication; hosted restore and arbitrary undo NOT RUN |
| Receipts | Ingest counts, actor, status, source, provenance run id and refresh time checked against public source status and retained after restart |

The canonical capability/evidence summaries and overall gate ratings belong to the
integration work. Later `people.glance`/explainer capabilities need their own
registry parity case entries and browser proof; this slice does not pre-certify
features that did not exist on its base.
