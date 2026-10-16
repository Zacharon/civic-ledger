# Ingest runbook

Operator guide for `ingest.run@1` (`pnpm ingest`). Contract: [CAPABILITIES.md](CAPABILITIES.md)
"Write semantics"; source formats: [DATA_SOURCES.md](DATA_SOURCES.md); rule choices:
[DECISIONS.md](DECISIONS.md) A12–A23.

## Sources and order

Each source joins rows loaded by the ones before it, so a full refresh runs in this order
(`pnpm ingest all` does exactly this and stops at the first failure).

| # | Source | Scope flag | Files | Typical size | Live duration (2026-10-16, PGlite) |
|---|---|---|---|---|---|
| 1 | `congress-legislators` | none (all) | legislators-current/historical JSON | 15 MB | 24 s |
| 2 | `voteview` | `--congress 119` | HS119 members / rollcalls / votes CSV | 11 MB | 106 s |
| 3 | `fec-bulk` | `--cycle 2026` | cn, cm, ccl, weball, pas2 zips + IE CSV + candidate summary CSV | 20 MB | 80 s |
| 4 | `govinfo-billstatus` | `--congress 119` | 8 BILLSTATUS type zips | 54 MB | 89 s |
| 5 | `curated` | none (all) | `data/curated/**` YAML | <1 MB | 33 s |

Full first load: 6 min 10 s. An unchanged rerun (`pnpm ingest all`): 10 s, all files 304,
every source deduplicated. Defaults: `--congress` = current congress, `--cycle` = current
two-year cycle.

## Commands

```sh
pnpm install
pnpm ingest --help
pnpm ingest all --db .pglite/live --migrate          # local PGlite, applies migrations first
DATABASE_URL=postgres://... pnpm db:migrate && pnpm ingest all   # Postgres
pnpm ingest voteview --allow-shrink                  # commit a load the shrink guard refused
pnpm ingest voteview --congress 119                  # one source
pnpm ingest fec-bulk --snapshot data/raw/fec-bulk/2026-10-16   # reload files already on disk
pnpm ingest:report --db .pglite/live                 # data-quality report (read-only)
pnpm curate:validate                                 # check curated YAML before a PR
```

stdout is the run receipt (the `ingest_run` row) as JSON; stderr is structured pino JSON
with `runId`, `source` and `scope` on every line (`LOG_LEVEL=debug` for more). Exit code
0 = succeeded or already loaded, 1 = failed or refused, 2 = usage error.

## What a run does

1. Takes the per-source lock (Postgres advisory lock on a dedicated connection; PGlite:
   in-process). A second run of the same source is refused with
   `conflict: run_in_progress`. Rows left `running` by a dead process are marked failed.
2. Writes the `ingest_run` row (`running`) before fetching anything.
3. Downloads into `data/raw/<source>/<YYYY-MM-DD>/` (gitignored) with a `manifest.json`
   (sha256 per file, upstream run ids, snapshot checksum). Requests use a timeout,
   at most 3 retries with full-jitter backoff on 429/5xx/network errors only, follow
   redirects (FEC → S3) and send `If-None-Match` / `If-Modified-Since` from
   `data/raw/<source>/http-cache.json`.
4. If (source, adapter version, snapshot checksum) already succeeded, the provisional row
   is dropped and the original receipt is returned with `"deduplicated": true`.
5. Streams, parses and upserts in batches, then deletes rows the source no longer
   asserts (DECISIONS A18). The whole load is **one transaction** (each batch is a
   savepoint inside it, DECISIONS A41), so nothing is visible, and nothing changes, unless
   the run succeeds.
6. Before committing, the shrink guard compares the load with what the source already
   has (see below). A violation rolls the transaction back and records `failed`.
7. Refreshes `person_card` / `person_card_scorecard` only after the commit, then records
   `succeeded`, counts and refresh times.

## Proposed schedules (UTC, GitHub Actions cron once D1 picks the database)

| Job | When | Why |
|---|---|---|
| `pnpm ingest all` | daily 09:00 | Unchanged files dedupe in seconds via 304 / checksum. |
| `pnpm ingest fec-bulk` | daily 13:00 extra in Sep–Nov of election years | FEC masters refresh daily, pas2 ~weekly, IE 24/48-hour reports daily near elections. |
| `pnpm ingest govinfo-billstatus` | every 6 h while Congress is in session | BILLSTATUS updates every 4 h for the current congress. |
| `pnpm ingest curated` | on every merge to `main` touching `data/curated/**` | Owner merge is the approval (D3). |

Run `curated` after any upstream reload: its snapshot includes upstream run ids, so it
re-codes new committees and re-resolves framework targets even when the YAML is unchanged.

## Failure handling

| Symptom | Meaning | Action |
|---|---|---|
| `conflict: run_in_progress` | Another run of that source holds the lock. | Wait; check the `running` row in `sources.status`. |
| receipt `status: failed`, `error: GET … HTTP 404` | File moved or not published yet (new cycle/congress). | Check the URL in DATA_SOURCES.md; nothing was loaded. |
| `failed` after retries on 5xx / timeout | Source down or slow. | Rerun later; nothing was loaded. |
| `failed`, `error: shrink guard: …` | The upstream file looks truncated or empty (see below). Nothing was changed. | Check the upstream file (size, row count). If the source really shrank, rerun with `--allow-shrink`. |
| `failed` with a parse error (`line N`, `Unexpected BILLSTATUS shape`, `Unknown Voteview cast_code`) | Source format changed. | Fix the parser with a fixture cut from the new file, bump the adapter `version`, rerun. |
| `Curated data is invalid: file:line …` | A merged YAML file fails the schema. | Fix the file; nothing from the curated run was loaded. |
| Voteview TLS error | Their certificate chain; never disable verification. | Retry later; report upstream if it persists. |

A failed or refused run leaves the database exactly as it was, and the read model is not
refreshed, so the site keeps serving the last good state.

## Shrink guard (data-loss protection)

Sources are complete snapshots, so a stale-row sweep deletes whatever the new file no
longer contains. An empty or truncated file that still downloads with HTTP 200 would
therefore wipe a source's rows. Before a load commits, the runtime refuses it (status
`failed`, transaction rolled back, nothing changed) when either holds:

* **Sweep too large.** The stale-row counters (`stale_*_deleted`) exceed
  `INGEST_MAX_DELETE_FRACTION` (default **0.1**, 10%) of the rows the source owns (every
  table with a `source_id`, counted before the load).
* **Record floor.** The records loaded (sum of the receipt counters except the stale
  ones) fall below `INGEST_MIN_RECORD_RATIO` (default **0.5**) of the last successful
  run of the same source and scope, when that run loaded at least
  `INGEST_MIN_RECORD_BASELINE` (default 20).

The error names the numbers, for example `shrink guard: the stale-row sweep would delete
56 of 99 existing rows (56.6%, limit 10%). Rolled back; no rows were changed.`

`--allow-shrink` commits the load anyway and logs the violation at `warn` (a source that
legitimately shrank, such as a repealed program or a corrected double count). The first
load of a source and the `curated` source (git-reviewed, where removing a file is an
intended change) are not guarded. Thresholds are the agent's defaults pending owner input
(readiness audit, owner item 8); tune them with the environment variables above.

## How to rerun

- Same files again → deduplicated, no writes (by design).
- Reload a saved snapshot (e.g. after restoring a database):
  `pnpm ingest <source> --snapshot data/raw/<source>/<date>`.
- Re-parse unchanged files after a parser/loader fix: bump `version` in the adapter's
  `index.ts` (it is part of the idempotency key), then run the source and every source
  after it in the order above.
- Raw snapshots are one directory per source and UTC day; a second download on the same
  day with changed content replaces that day's files (the earlier run keeps its checksum
  in the ledger).

## Data-quality checks after a load

Read the receipt counters and `pnpm ingest:report`. Investigate when a counter moves
sharply between runs.

| Counter / metric | Expected (2026-10-16) | If it moves |
|---|---|---|
| `voteview.members_bioguide_not_in_legislators`, `votes_unmatched_member` | 0 | c-l is behind Voteview: rerun c-l, then voteview. |
| `voteview.ideology_missing_dim1` | 2 (new members) | Normal for members with few votes. |
| `fec-bulk.pas2_amendment_superseded`, `pas2_duplicate_reports` | 2, 10 | A jump means FEC changed how amendments appear: review A13. |
| `fec-bulk.ie_implausible_amount_dropped` | 15 | New bogus filings; check none is a real buy. |
| `fec-bulk.ie_unattributed_dropped` | ~2,500 | IEs filed without a candidate id (not attributable). |
| `fec-bulk.contributions_unresolved_recipient` | ~24 | Recipient committee linked to several candidates. |
| `fec-bulk.summaries`, `summaries_matched_to_person` | 4,482, 448 | The candidate summary file moved or changed shape (DECISIONS A31). |
| `fec-bulk.summary_unitemized_out_of_range` | 2 | Filer errors (e.g. negative unitemized); those members' small-donor share reads "No data". |
| `fec-bulk.summary_period_differs_from_totals` | ~300 | Normal: the summary file trails weball by up to a quarter; each share states its own date. |
| `fec-bulk.links_unknown_committee` | ~490 | ccl rows whose committee is missing from cm. |
| `govinfo-billstatus.recorded_votes_without_rollcall` | 0 | Voteview lags BILLSTATUS: rerun voteview, then BILLSTATUS. |
| `curated.industry_coverage_bps` | ~7,700 (77% of PAC → candidate dollars) | Falls when new PACs appear: see `topUncoded` in the report and propose rules. |
| report `rollcallsLinkedToBills / rollcalls` | 852 / 1,589 | Unlinked are nominations (223), cloture and procedural votes. |

Individual contributors are never loaded: the pipeline does not download individual
contribution files and never reads pas2 payee names (52 U.S.C. 30111(a)(4)).

## Real-data smoke suite (`pnpm smoke:real`)

Not part of `pnpm check` or CI (it needs a loaded database). Run it after a full load and
before any release; it is read-only.

```sh
pnpm smoke:real -- --db .pglite/live            # PGlite
DATABASE_URL=postgres://... pnpm smoke:real     # Postgres
pnpm smoke:real -- --db .pglite/live --former 0 # skip the former-member sample
```

It dispatches every public capability through the same registry as the UI, `/api/v1` and
MCP: `people.get`, `money.summary` (every available cycle), `votes.list` (first page),
`scores.list` and `promises.list` for **every current member** plus a sample of former
members (`--former`, default 100); `explore.table` for every sort column x asc/desc x both
scopes (first and last page) and both chambers by PAC share; `explore.facets`,
`people.search`, `people.compare` (all current members in groups of three, plus a
current + former pair); every policy page (`votes.list` per chamber and the
`frameworks.evaluate` matrix); every listed framework and a sample spec with roll-call and
bill rules; `sources.status`. Any `CapabilityError`, including output validation, is a
failure. stdout is a JSON report (counts and timings per capability, each failure with its
input and the first validation issues); stderr prints progress and a one-line verdict; exit
code 1 on any failure. Code: `packages/ingest/src/smoke/`; the runner is also covered on the
fictional seed by `packages/ingest/test/smoke.test.ts`.

Last run (2026-10-16, fresh `pnpm ingest all --db .pglite/live --migrate`, 4 min 49 s):
**PASS, 3,667 calls, 0 failures**, 539 current members, 100 former sampled, 16 sort
columns x 2 scopes, 32 policy areas, 121 s.

Real-data visual QA (`apps/web/playwright.real.config.ts`, also outside CI) captures the
key pages into `apps/web/screenshots/real/`, writes warm timings to `timings.json` and fails
on any horizontal overflow at 390 px:

```sh
PGLITE_DATA_DIR=../../.pglite/live pnpm --filter web start -p 3400
REAL_BASE_URL=http://localhost:3400 pnpm --filter web screenshots:real
```
