# T-A evidence: raw snapshot retention and unchanged checks (Worker A)

Branch `claude/evidence-snapshots-20261019`, worktree
`_worktrees/Civic_Ledger/fix/evidence-snapshots-20261019`. Contract:
[evidence-trust-20261019-contract.md](../evidence-trust-20261019-contract.md). Base
`76b74c3` (0006 committed by the orchestrator; schema and migrations not edited).

## Commits

| SHA | Subject |
|---|---|
| `0e508eb` | test(ingest): red regressions for same-day evidence overwrite and invisible unchanged checks |
| `03c1725` | fix(ingest): retain each fetched snapshot in its own immutable directory; record unchanged checks |
| `15cb5c2` | feat(core): sources.status reports check freshness and data coverage per source and scope |
| `2c7de88` | fix(monitor): judge freshness by successful checks and the latest attempt, per expected scope |
| `b8f84b4` | fix(backup): never archive in-flight `<source>/.staging` downloads |
| `4b376c9` | feat(web): Sources page shows last checked, last changed and data covers through |
| `016b0c8` | docs(ingest): retained snapshot locators, unchanged checks and monitor freshness |

(This file is committed after them.)

## Red evidence (base code + red tests, commit `0e508eb`)

Command: `pnpm vitest run packages/ingest/test/evidence-snapshots.test.ts packages/ingest/test/evidence-monitor.test.ts packages/ingest/test/evidence-raw-restore.test.ts`
Exit code **1**, 8 failed of 8, no retries. Key lines:

| Regression | Test | Failure at base |
|---|---|---|
| 1 same-day changed snapshots | `evidence-snapshots` R1 | `manifest checksum of run 1: expected '5c2adc3b…' to be '3e8dca2e…'` (run 2 overwrote run 1's manifest/files in `<source>/<day>`) |
| 2 later failures alter evidence | R2 | `manifest checksum of run 1: expected 'b8118d68…' to be '3e8dca2e…'` (after the parse-failure attempt) |
| 3 two scopes, same day | R3 | `manifest checksum of run 2: expected '1315404e…' to be 'cb31ee61…'` (congress:118 rewrote congress:119's manifest) |
| 4 unchanged recheck history | R4 | `expected undefined to deeply equal { id: Any<Number>, … }` (no `check`) |
| 5 monitor after failed fetch + unchanged validation | `evidence-monitor` R5 (real PGlite ledger, real `assess`) | `expected [ …(3) ] to deeply equal []` (failed, missed, stale stay) |
| 5b scope isolation | `evidence-monitor` | `expected [] to deeply equal [ 'ingest:voteview:missed', … ]` (a congress:118 check made voteview look fresh) |
| 6 coverage vs check time | R6 | `expected undefined to be '2026-02-12'` (no `coverageThrough`) |
| 7 raw restore keeps evidence access | `evidence-raw-restore` R7 | `manifest checksum of run 1: expected '4c415515…' to be '3e8dca2e…'` |

Two test-harness defects were fixed after the red commit, without changing any
assertion: the HTTP double's `BodyInit` type did not typecheck under the ingest
tsconfig (`03c1725`), and R2 renamed a member in the already-malformed body instead of
the pristine one (`03c1725`; at base R2 had already failed earlier, on the evidence
assertion above).

## Green evidence (final branch, before this file)

| Check | Command | Result |
|---|---|---|
| Targeted tests | `pnpm vitest run --maxWorkers=2 packages/ingest/test packages/core/test/ops-monitor.test.ts packages/core/test/ops-backup.test.ts packages/core/test/catalog.test.ts packages/core/test/dispatch.test.ts apps/web/test/health.test.ts apps/web/test/parity.test.ts apps/web/test/openapi.test.ts packages/mcp/test/server.test.ts` | **PASS**, exit 0, 28 files, 252 tests, 294 s, no retries |
| Lint | `pnpm lint` | **PASS** (328 files) |
| Typecheck | `pnpm typecheck` | **PASS** (root + 5 workspace projects) |
| `pnpm test:pg`, `pnpm build`, Playwright, full `pnpm test` | not run by this worker (orchestrator) | **NOT RUN** |

New tests: `packages/ingest/test/evidence-snapshots.test.ts` (R1–R4, R6, staging cleanup,
A55 compatibility), `evidence-monitor.test.ts` (R5, scope isolation, monitor inputs),
`evidence-raw-restore.test.ts` (R7), `support/evidence.ts`. No Postgres-specific test was
added; `test-pg/capabilities.pgtest.ts`, `roles.pgtest.ts` and
`migrations-forward.pgtest.ts` already dispatch `sources.status` on Postgres.

## Design

**Layout.** `stageSnapshot` downloads/copies into `<raw>/<source>/.staging/<runId>-<rand8>/`,
hashes there and writes the manifest there. `run.ts` then decides:

* not a dedupe hit: `finalizeSnapshot` renames staging to
  `<raw>/<source>/<YYYY-MM-DD of retrieval>/<runId>-<checksum first 12>/` (one rename on
  one volume; a pre-existing name, possible only when two databases share a raw root,
  gets a random suffix; nothing is ever written into an existing directory) and stores
  the relative locator on the run with the checksum, before the load transaction. The
  superseded-refusal path also finalizes and records its locator (a failed run's
  evidence, kept for diagnosis).
* dedupe hit on a fetch: one transaction inserts `ingest_check` (`unchanged`,
  `publication_run_id` = returned run, `started_at` = attempt start, checksum, adapter
  version, scope) and deletes the provisional run; the receipt is the publication's with
  `deduplicated: true` and `check: { id, checkedAt }`. The staged copy is **discarded**
  when the publication's locator is a raw-root-relative directory whose manifest still
  names the checksum; otherwise (pre-0006 publication, lost or `--snapshot`
  evidence) it is **kept** as `<source>/<day>/check-<checkId>-<checksum12>/` and logged.
  That locator is derivable from the check id but not stored (no column; see proposal).
* dedupe hit on `--snapshot`: unchanged behaviour, no check (a local reload is not an
  upstream check), `check: null`.
* any failure before finalize (download error, cancellation, DB error) removes the
  staging directory. A process killed mid-download leaves `.staging/<runId>-…`, which is
  never archived and may be deleted when no ingest runs.

**Cleanup policy.** Retained directories are never deleted by code. Failed/cancelled
runs keep theirs (diagnosis); operators may delete those once diagnosed. A directory
named by a succeeded run is that receipt's evidence.

**HTTP cache.** `downloadToFile` gained `cacheBodyDir`: the 304-reusable body is a copy in
`<source>/.http-cache/<sha256(url)[0:32]>` (written temp + rename, reflink where the OS
supports `COPYFILE_FICLONE`). The cache entry points there, never at retained evidence.
Legacy entries that still point into an old `<source>/<date>/` file keep working and are
moved to the cache copy on their first 304. Without `cacheBodyDir` (direct callers and
existing tests) behaviour is unchanged. A65/A53 are unchanged: the cap is checked on the
cache copy's on-disk size before hashing; hashing stops on cancel.

**Manifest.** Still `schema_version: 1`; additive fields `run_id` and `scope`.
`readManifest` reads only `schema_version`/`source`, so old and new readers accept both.

**sources.status@1 (additive).** Per source `freshness { lastAttemptAt,
lastAttemptOutcome, lastSuccessfulCheckAt, lastChangedAt, coverageThrough, coverageBasis }`
and `scopes[] { scope, lastAttemptAt, lastAttemptOutcome, lastSuccessfulCheckAt,
lastChangedAt, publicationRunId, coverageThrough }`. Per scope: latest run (by
`startedAt`, id) vs latest check (by `checkedAt`); the later `startedAt` is the attempt
(`unchanged` for a check, `published`/`failed`/`running` for a run; `cancelled` and
`partial` map to `failed`). `lastSuccessfulCheckAt` = max(current publication
`finishedAt`, latest check `checkedAt`); `lastChangedAt` = current publication
`finishedAt`; `publicationRunId` = latest succeeded run id (the A54 current generation).
Source level = the latest across scopes. `coverageThrough` from facts only:
voteview `max(rollcall.vote_date)` per congress; fec-bulk `max(candidate_cycle_totals.coverage_end_date)`
per cycle (weball, not the trailing candidate summary); govinfo-billstatus
`max(bill.latest_action_date)` per congress; source level = max over its scopes;
congress-legislators, curated and others null with a `coverageBasis` sentence.
`lastRun`/`lastSuccess` are computed exactly as before.

**Monitor.** `Source` gains optional `freshness`/`scopes`; `normalizeSources` projects only
timestamps, the outcome enum and scope names matching `all|congress:N|cycle:N`
(coverage dates and basis text are not projected). `stale` uses
`lastSuccessfulCheckAt`, `missed` `lastAttemptAt`, `failed` `lastAttemptOutcome`,
`stuck` a `running` outcome older than 2 h; a server without `freshness` falls back to
`lastSuccess.finishedAt` / `lastRun`. `Observation.expectedScopes` (CLI: from
`CIVIC_CONGRESS`/`CIVIC_CYCLE`, `expectedScopesFromEnv`) makes each scheduled source be
judged on its expected scope only; a missing scope entry means never attempted. Without
those variables the source-level values (any scope) are used.

**Backups.** `raw.ts` skips `<source>/.staging/`; nested retained directories,
`http-cache.json` and `.http-cache/` are archived (blobs are content-deduplicated, so the
cache copies cost index entries only). R7 proves a local archive + restore keeps every
run's locator readable and rehashing to its checksum.

**Sources page.** Three rows per source, distinctly worded: "Last checked" (with "When the
source was last fetched successfully, whether or not anything had changed"), "Last
changed" ("When new data from this source was last published here"), "Data covers
through" (date, then the basis sentence). Existing rows and `data-value`s unchanged.

## Compatibility

* Receipt: `snapshotLocator: string | null`, `check: {id, checkedAt} | null` added;
  `deduplicated` semantics unchanged; existing receipts compare equal except for `check`
  on a fetched dedupe.
* `--snapshot` on legacy `<source>/<date>` directories with unversioned or v1 manifests
  still loads (test "compatibility (A55)"); `--snapshot` on a new locator directory loads
  and does not write into it.
* Runs before 0006 keep `snapshot_locator` null; their unchanged rechecks keep a copy
  (`check-<id>-…`).
* `sources.status@1`: no field removed or redefined, no enum gained a value; the new
  outcome enum is a new field.

## Shared files changed (outside owned paths, minimal)

| File | Change |
|---|---|
| `packages/ingest/test/runtime.test.ts` | Fetch test follows the new directory (`<day>/<runId>-<checksum12>`), asserts the locator, and expects `check: {id, checkedAt}` on the 304 dedupe receipt. Same assertions otherwise. |
| `packages/ingest/test/replay-manifest.test.ts` | Reads the manifest at the receipt's locator (and asserts its prefix) instead of `<source>/<day>`. |
| `apps/web/test/health.test.ts` | `source()` fixture gains the now-required `freshness`/`scopes` fields (nulls). |
| `apps/web/e2e/support/supplemental-values.ts` | `checkSources` asserts the three new rows' `data-value` and text. **NOT RUN** (Playwright is orchestrator-only). |

## Proposed DECISIONS rows (for the orchestrator)

* **A70 (proposed)** 2026-10-19 — Raw evidence retention: a fetch stages under
  `<source>/.staging/<runId>-<random>`, writes its v1 manifest (additive `run_id`, `scope`)
  there, and is renamed to the immutable `<source>/<YYYY-MM-DD>/<runId>-<checksum12>`
  whose raw-root-relative path is stored as `ingest_run.snapshot_locator` before load
  (`--snapshot`: the absolute directory). No code writes into or deletes a retained
  directory; failed/cancelled runs keep theirs for diagnosis; staging is removed on any
  failure before finalize and never archived. The 304 body cache lives in
  `<source>/.http-cache/`, never in evidence. | Supersedes the "one directory per source
  and UTC day" layout (INGEST "How to rerun") | F1: a second same-day run (also a later
  failed one, or another scope) overwrote the first run's bytes and manifest. Cost: every
  changed fetch retains a full copy (no dedup across runs on disk); retention policy is
  an owner decision. Tests: `evidence-snapshots.test.ts` R1–R3, `evidence-raw-restore.test.ts`.
* **A71 (proposed)** 2026-10-19 — Unchanged checks: a fetch whose key equals the scope's
  current generation inserts `ingest_check` (`unchanged`) and deletes its provisional run
  in one transaction; the receipt is the publication's with `check`. Duplicate staged
  bytes are discarded when the publication's retained manifest matches, else kept as
  `check-<id>-<checksum12>`. `--snapshot` repeats record no check. | Amends A18's
  dedupe effect | F2: unchanged rechecks were invisible to `sources.status` and the
  monitor. Test: R4.
* **A72 (proposed)** 2026-10-19 — `sources.status@1` gains `freshness` and `scopes[]`
  (attempt, outcome, last successful check, last change, publication run, coverage
  through + basis); coverage is derived from facts only (Voteview vote dates, FEC weball
  coverage end, BILLSTATUS latest action) and never from check time; `lastRun` /
  `lastSuccess` unchanged. The monitor judges stale/missed/failed on these, per expected
  scope from `CIVIC_CONGRESS`/`CIVIC_CYCLE`, with a v1 fallback. | Additive (contract
  rule) | Tests: R4–R6, `evidence-monitor.test.ts`.

## Proposed changes outside my ownership

1. `.github/workflows/monitor.yml`: add `CIVIC_CONGRESS: ${{ vars.CIVIC_CONGRESS }}` and
   `CIVIC_CYCLE: ${{ vars.CIVIC_CYCLE }}` to the "Prepare deduplicated drafts" step env.
   Until then the deployed monitor uses source-level freshness (a historical-scope check
   would count).
2. `apps/web/src/server/api/health.ts` (T-O): freshness still ages
   `lastSuccess.finishedAt`, so an unchanged source reads `degraded` on
   `/api/health?strict=1` after 48 h / 14 d although the monitor clears it. Proposal:
   `freshness.lastSuccessfulCheckAt ?? lastSuccess.finishedAt`, and report it as
   `lastCheckedAt`.
3. `docs/DEPLOY_RENDER.md` "Monitoring" paragraph: replace "missed attempts … failed/partial/cancelled
   runs" with the attempt/check wording now in OPERATIONS.md, and mention the two
   variables.
4. `packages/ingest/src/adapter.ts` line 10 comment: downloads land under
   `data/raw/<source>/<date>/<run>-<checksum>/` (comment only).
5. Schema (not made): `ingest_check.snapshot_locator text null`, to store the locator of
   the copy kept when the publication has no retained evidence (today derivable as
   `<source>/<day>/check-<id>-<checksum12>`, day = UTC day of `started_at` retrieval).
6. `docs/CAPABILITIES.md` / ARCHITECTURE: document the receipt and `sources.status`
   fields (orchestrator-owned).

## Open risks

* Postgres behaviour (`selectDistinctOn`, `max(date)::text`, `ingest_check` grants via
  `scripts/db/roles.sql` default privileges) is proven on PGlite only here; `pnpm test:pg`
  NOT RUN by this worker. Default privileges apply only if 0006 runs as the role that set
  them.
* Disk growth: each changed fetch keeps a full copy (54 MB BILLSTATUS every 6 h in
  session is ~200 MB/day). No retention/pruning exists; that needs an owner decision.
* Windows: the directory rename can fail with `EPERM` if another process (antivirus,
  indexer) holds a staged file open; the run then fails (staging kept), it does not
  corrupt evidence. Linux runners are unaffected.
* `http-cache.json` stores absolute paths: after restoring the raw tree to a different
  path, the first fetch downloads in full (never a wrong reuse).
* `/api/health` uses `sources.status`; the three small coverage group-bys add work to each
  health probe (row counts in the thousands per scope; not measured on Postgres).
* Source-level `coverageThrough` is the max over all loaded scopes, so loading an older
  Congress never lowers it, but it does not tell which scope; per-scope values are in
  `scopes[]`. The Sources page shows source level only.
* The "original" dedupe fallback (no success in this scope, same key succeeded in another
  scope) records a check against that other scope's run (`publicationRunId` names it).
