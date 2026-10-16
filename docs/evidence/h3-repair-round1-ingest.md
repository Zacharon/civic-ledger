# H3 repair round 1: ingest and data-integrity cluster

Branch `fix/h3-ingest-receipts-20261016` (from `dd7dbe5`). Review being answered:
vault `01_PROJECTS/Civic_Ledger/audits/h3-readiness-2026-10-16.md` (findings H3-01..H3-08,
probes P1..P6). Repair rule: H3 protocol "Code defect repro gate (red -> green)".

How to verify the gate yourself:

- Red: `git checkout 0d1f4d0` (tests only, production code identical to `dd7dbe5`) and run
  the commands below; they fail as recorded.
- Green: this branch's head, same commands, same test files. After the fix commit the test
  files changed only by `biome` line wrapping (`git diff -w 0d1f4d0 -- packages/ingest/test`
  shows wrapping only); no assertion was edited, removed or weakened.
- Raw logs: [h3-repair-round1-ingest/](h3-repair-round1-ingest/) (`red-*.txt`, `green-*.txt`).

All runs: Windows 10, Node 24.16.0, pnpm 11.13.0, PGlite 0.5.10, embedded PostgreSQL 17.

## H3-01 HIGH: publication / receipt boundary

**Reproduction.** `pnpm exec vitest run packages/ingest/test/publication.test.ts` (PGlite) and
`pnpm exec vitest run --config vitest.pg.config.ts test-pg/publication.pgtest.ts` (Postgres).
Shared scenarios: `packages/ingest/test/support/publication-scenarios.ts`. Each loads a good
legislators snapshot, then a second snapshot that renames one member to a marker and fails
at one publication step: refresh 1 (injected), refresh 2 (person_card refreshed, then an
injected failure), the final ledger write (a database trigger raises when the run's row
becomes `succeeded`), and process loss (`test/support/crash-run.ts` is a child process that
calls `process.exit(86)` the moment publication starts; PGlite data directory and Postgres).

**Red** (both drivers, 4/4 failed; `red-h3-01-pglite.txt`, `red-h3-01-pg.txt`):

```
x refresh 1 fails ...           expected { markerFacts: 1, ... } to deeply equal { markerFacts: 0, ... }
x refresh 2 fails after refresh 1 ...  "markerCards": 1, "markerFacts": 1, cardRefreshedAt advanced
x the final ledger write fails ...     "markerCards": 1, "markerFacts": 1
x a process that dies after loading ... expected { people: 9, running: 1 } to deeply equal { people: 0, running: 1 }
```

**Root cause.** `runtime/run.ts` committed the load transaction, then refreshed the two
views and wrote the success receipt as separate statements/commits. `read-model.ts` claimed
`REFRESH ... CONCURRENTLY` cannot run in a transaction; that is false (verified with a probe
on PostgreSQL 17 and PGlite before the change: both refreshes inside `BEGIN ... COMMIT`
succeeded; only `CREATE INDEX CONCURRENTLY` has that restriction).

**Fix** (DECISIONS A50). `packages/ingest/src/runtime/run.ts` (`loadAndPublish`): load,
shrink guard, both `REFRESH MATERIALIZED VIEW CONCURRENTLY`, and the `succeeded` receipt
run in one transaction. Any error, cancellation or process loss before commit rolls back
facts, views and counts. `runtime/ledger.ts` `finishRun` writes `failed`/`cancelled` only
while the row is still `running`, so a commit whose acknowledgement was lost is returned,
not overwritten. Receipt errors now show the database's own message (`runtime/errors.ts`;
Drizzle hid it behind the full parameter list). Migration 0005 sets
`refreshed_at = statement_timestamp()` (inside a transaction `now()` is the start time).
`packages/db/src/read-model.ts` comment corrected. Docs: INGEST "What a run does" and
failure handling, OPERATIONS "Data" rollback and caching, CAPABILITIES write semantics;
A41's claim is superseded by an appended row (A50), not rewritten.

Design choice: one transaction rather than phased `loading -> committed -> published`
states. With both drivers allowing CONCURRENTLY in a transaction there is no
committed-but-unpublished state to represent, so no republish command is needed.

**Green.** Same commands: PGlite 4/4 passed (`green-publication.txt`); Postgres included in
the full `pnpm test:pg` run, 38/38 passed (`green-test-pg.txt`).

**Remaining limits.** Two writes stay outside the transaction by design: the `source`
metadata upsert and the `running` row with its snapshot checksum. While a run holds a
view's EXCLUSIVE lock until commit (readers unaffected), another source's refresh waits,
up to `DB_LOCK_TIMEOUT_MS`, and then fails and rolls back. Process loss was simulated by
`process.exit` in a child process, not by an OS-level kill or power loss.

### Found while recording H3-01 red: `pnpm test:pg` exited 0 with failing tests

**Red** (`red-pg-exitcode.txt`): `node node_modules/vitest/vitest.mjs run --config
vitest.pg.config.ts test-pg/publication.pgtest.ts -t "refresh 1"` reported `2 failed` and
exited **0**. **Cause:** `embedded-postgres` registers `async-exit-hook` when imported. Its
`beforeExit` handler calls `process.exit(0)`, which overrode vitest's exit code. The module
was imported unconditionally, so CI (with `PG_TEST_URL`) was affected too. **Fix** (A56,
commit `1a996b2`): `test-pg/global-setup.ts` imports it lazily and removes that one
listener. **Green** (`green-pg-exitcode.txt`): same command, same failing tests, exit **1**.

## H3-02 HIGH: shrink guard by dataset and scope

**Reproduction.** `pnpm exec vitest run packages/ingest/test/shrink-scope.test.ts`, run
through the real runtime with committed fixtures:
- P3: votes file whose `icpsr` no longer matches, so every position turns into the
  `votes_unmatched_member` diagnostic (guard `minBaseline: 10`, because the fixture has 18
  positions);
- P4: an emptied weball (totals) file for cycle 2026 while 400 cycle-2024 rows of the same
  source dilute the source-wide counts;
- one-file collapse: an emptied IE file within one cycle;
- `--allow-shrink` must record the violation on the receipt.

**Red** (4/4 failed; `red-h3-02.txt`): `expected 'succeeded' to be 'failed'` for P3, P4 and
one-file collapse; `expected {...} to match object { note: ... }` for the override note.

**Root cause.** `shrink-guard.ts` compared aggregates: every non-sweep counter, diagnostics
included, against all rows the source owns in every table and scope.

**Fix** (A51). `SourceAdapter.shrinkDatasets` (`src/adapter.ts`) declares each table's
explicit loaded-row counter, its sweep counter and its scope column (or a `scopeVia` parent
for BILLSTATUS child tables). It is declared in the `congress-legislators`, `voteview`,
`fec-bulk` and `govinfo-billstatus` adapter `index.ts` files. `runtime/shrink-guard.ts`:
`countDatasetRows` counts rows per table in the current scope before the load;
`evaluateShrink` adds per-dataset sweep fractions and per-dataset floors against the last
successful same-scope run. A sweep that would empty a table always counts. The A42 source
totals stay as an outer bound and now count only declared counters. FEC and BILLSTATUS
emit per-table `stale_<table>_deleted` counters (`stale_rows_deleted` stays as their sum).
The override text is stored in the new `ingest_run.note` and shown in the receipt `note`.
The thresholds keep their environment-variable defaults and still await the owner.

**Green.** Same command: 4/4 passed (`green-shrink-scope.txt`). The existing
`shrink-guard.test.ts` cases pass unchanged.

**Remaining limits.** On fixture-sized data the per-dataset floor needs a lower
`INGEST_MIN_RECORD_BASELINE`. With the default of 20, the floor does not judge
datasets that had fewer than 20 rows last run (the empty-table sweep rule still does).
Voteview tables are not swept, so a collapse there is refused by the floor only. The
thresholds were not tuned on live data.

## H3-03 MEDIUM: null versus 0% industry-coding coverage

**Reproduction.** `pnpm exec vitest run packages/core/test/coverage-null.test.ts`: on the
fictional seed, three members get only uncoded positive PAC gifts, only refunds, or a mix.
For each, `people.get` card coverage must equal `money.summary` coverage.

**Red** (`red-h3-03.txt`): `expected { money: 0, card: null } to deeply equal { money: 0,
card: 0 }`. The all-refunds and mixed cases already passed; they are kept as regression
checks.

**Root cause.** In `0004_person_card_scope_and_shares.sql` the numerator
`sum(...) FILTER (WHERE industry_id IS NOT NULL)` is NULL when no row is coded.

**Fix** (A57). New forward migration
`packages/db/migrations/0005_ingest_receipts_and_coverage.sql` coalesces only the coded
numerator. NULL remains only when the gross denominator is 0. `0004` is unchanged, and a
rollback note was added to `packages/db/migrations/README.md`.

**Green.** Same command: 3/3 passed (`green-coverage.txt`). Migration upgrade on Postgres:
`test-pg/migrations.pgtest.ts` passes inside the 38/38 run.

## H3-04 MEDIUM: cancellation and deadline

**Reproduction.** `pnpm exec vitest run packages/ingest/test/cancellation.test.ts`:
- P5: the signal is already aborted;
- abort during the load (at parsed record 3);
- abort during publication (inside the refresh);
- a 50 ms whole-run deadline crossed by a slow parse.

**Red** (4/4 failed; `red-h3-04.txt`): `expected 9 to be +0` (nine people loaded in every
case).

**Root cause.** The signal reached only `fetchSnapshot`. The snapshot path, plan, hashing,
parse and load never checked it, and there was no run deadline.

**Fix** (A52). `runtime/cancel.ts` `RunControl` combines the operator signal, the lock
signal and a deadline (a timer plus a clock check, because a synchronous parse blocks the
timer). It is checked before plan, after hashing or fetch, before every parsed record
(`abortable`), after the load, after the refresh and right before commit. The signal is
passed to `plan`, `hashFile`, `fetchSnapshot`, `parse` and `load`. Status `cancelled` comes
from migration 0005 and `INGEST_STATUSES`. A lost lock stays `failed`. CLI:
`--deadline-minutes` / `INGEST_RUN_DEADLINE_MS`. `sources.status@1` reports a cancelled run
as `failed` with an error starting `cancelled:`, so v1 clients never see a new enum value
(`packages/core/src/capabilities/sources.ts`).

**Green.** Same command: 4/4 passed (`green-cancellation.txt`). The existing lock-loss test
on Postgres still records `failed / source lock connection lost`.

**Remaining limits.** A statement already executing is not cancelled. It finishes, bounded
by the 10-minute ingest statement timeout, and the next checkpoint stops the run. The
commit is the irrevocable boundary: an abort that arrives after it leaves the run
`succeeded`. SIGINT during a run was exercised by tests, not by an interactive Ctrl-C.

## H3-05 MEDIUM: bounded memory and byte caps

**Reproduction.** `pnpm exec vitest run packages/ingest/test/bounded.test.ts`:
- the parser must hand on pas2 rows, and IE rows, before it reaches a malformed later row
  in the same file;
- a 4 KiB download against a 1 KiB cap must fail;
- a fixture zip entry against a 200-byte decompression cap must fail.

**Red** (4/4 failed; `red-h3-05.txt`): `expected 0 to be greater than 0` (no record left
the parser before the whole file was read) twice, and `expected 'succeeded' to be 'failed'`
twice (no caps existed).

**Root cause.** `fec-bulk/parse.ts` pushed every pas2 and IE row into arrays and deduped
them in memory, because the amendment and supersession rules compare rows across the whole
file. `download.ts` counted bytes but had no maximum, and zips were inflated without a
limit.

**Fix** (A53). New `fec-bulk/stage.ts`. The parser applies the row-local rules (type,
memo) and yields each row. The loader stages rows in temp tables inside the load
transaction, applies dedupe rules 3 and 4 (pas2) and the IE rules in SQL, and loads the
kept rows in keyset pages of 1,000. `dedupe.ts` stays the reference: the new
`test/fec-sql-dedupe.test.ts` checks over 10 seeded random inputs that the kept rows and
counters match exactly. The receipt counters of the committed fixture are unchanged; the
`pipeline.test.ts` expectations pass. Caps: `INGEST_MAX_DOWNLOAD_BYTES` (1 GiB default,
checked against Content-Length and while streaming; a partial file is removed) and
`INGEST_MAX_DECOMPRESSED_BYTES` (2 GiB default per entry, checked against the header and
the bytes actually inflated) in `runtime/download.ts`, `parse/zip.ts` and
`runtime/limits.ts`. BILLSTATUS zips get the same cap.

**Green.** Same command: 4/4 passed (`green-bounded.txt`); `fec-sql-dedupe.test.ts`
10/10 passed.

**Memory measurement.** Script `packages/ingest/test/support/memory-probe.ts`: `parse`
mode, peak RSS from `process.resourceUsage().maxRSS`. The "before" run used `parse.ts`
from `dd7dbe5` placed temporarily beside the current one.

| Input | records | dd7dbe5 peak RSS | this branch peak RSS |
|---|---|---|---|
| committed FEC fixture | 172 / 178 | 328 MiB | 331 MiB |
| synthetic 60k pas2 + 20k IE | 80,138 | 334 MiB | 331 MiB |
| synthetic 600k pas2 + 200k IE | 800,138 | **689 MiB** | **336 MiB** |

The process baseline (tsx plus modules) is about 330 MiB. The old parser grew by about
360 MiB at 800k rows; the new one stays flat. The record counts differ on the fixture
because the new parser yields every staged row instead of the deduped result.

Full ingest on this branch (`pnpm ingest fec-bulk --snapshot <600k/200k dir> --db <tmp PGlite>`,
after a fixture legislators load) **succeeded** in 9 min 30 s. All 600,000 pas2 rows were
staged, deduped in SQL and read back page by page. All of them were then counted as
`contributions_unknown_committee`, because the synthetic giver committees are not in the
fixture `cm` file; that is a property of the synthetic data, not a dedupe result. All
200,000 IE rows loaded (`independent_expenditures: 200000`). Peak RSS was not measured for
this end-to-end run: PGlite holds the database in process, so the number would not
isolate the loader.

**Remaining limits.** Memory is O(entities), not O(transactions): committee and candidate
maps and the weball and candidate-summary rows (thousands) are still held for one run.
Staged rows use database temp space inside the load transaction. The cap defaults are
agent choices, not measured host limits. The parser numbers isolate the parser and are
not end-to-end process RSS on the production host.

## H3-07 MEDIUM: snapshot replay A -> B -> A

**Reproduction.** `pnpm exec vitest run packages/ingest/test/replay-manifest.test.ts -t
"A -> B -> A"`.

**Red** (`red-h3-07-08.txt`): the refusal test failed with `expected true to be false`
(`deduplicated: true`, B's data left in place, as in P2). The `--force-replay` test failed
with `CapabilityError: Input failed validation` (no such input). The immediate-repeat
check passed and is kept as a regression check.

**Root cause.** `ledger.findSucceededRun` matched any historical success of the key, and
`run.ts` returned it without asking whether a later run had loaded other data.

**Fix** (A54). `run.ts` with `ledger.latestSucceededRun`:
- a key that is still the latest success of its source and scope deduplicates as before;
- a superseded key gets a `failed` receipt whose error starts `snapshot_superseded:`, names
  both runs and points to `--force-replay`; nothing changes;
- `forceReplay` (contract `packages/core/src/contracts/ingest.ts`, CLI `--force-replay`)
  loads the snapshot as a new run under the shrink guard, with `replayOf` (new column
  `ingest_run.replay_of`).

INGEST "How to rerun" now says plainly that replay is not restoration.

**Green.** Same command: 3/3 passed (`green-replay-manifest.txt`).

**Remaining limits.** `--force-replay` reloads one source. It does not rewind dependent
sources or curated data: rerun those in pipeline order.

## H3-08 LOW: manifest schema version

**Reproduction.** Same file, `-t "manifest"`.

**Red:** `expected undefined to be 1` (fetched manifest had no version);
`expected 'succeeded' to be 'failed'` (an unknown version was accepted). The test that
accepts v1 and legacy manifests passed and is kept as a regression check.

**Fix** (A55). `runtime/snapshot.ts` writes `schema_version: 1`. `readManifest` accepts v1
and legacy manifests without a version (same shape), and rejects any other version.
`--snapshot` also refuses a manifest that belongs to another source.

**Green:** 3/3 passed.

## CAPABILITIES partial-batch wording

The `ingest.run@1` write semantics no longer say "batches already committed are valid
upserts". They now describe the single transaction, the `failed` / `cancelled` outcomes,
superseded replays, `note` / `replayOf`, and the two writes outside the transaction.

## Regression runs (this branch head)

| Check | Result | Log |
|---|---|---|
| `pnpm check` (biome, typecheck all workspaces, vitest, Next build) | exit 0; biome 260 files clean; **40 files, 371 tests passed** (was 33 / 336 at `dd7dbe5`) | `green-pnpm-check.txt` |
| `pnpm test:pg` (embedded PostgreSQL 17) | exit 0; **6 files, 38 tests passed** (was 5 / 34) | `green-test-pg.txt` |
| `pnpm db:seed` then `pnpm --filter web test:e2e` (one run) | exit 0; **43 passed** (2.1 min) | `e2e.txt` |

The new test files are publication, shrink-scope, cancellation, bounded, replay-manifest,
fec-sql-dedupe (ingest), coverage-null (core) and publication.pgtest. No existing test was
deleted or weakened. `shrink-guard.test.ts`, `runtime.test.ts`, `pipeline.test.ts`,
`rules.test.ts`, `ingest.pgtest.ts` and `migrations.pgtest.ts` pass unchanged.

## Not repaired here

- H3-06 (intermittent E2E) belongs to the parallel app-parity branch.
- Backups, alerts and owner thresholds (VC-084, VC-062, A42/A51 owner input) are owner or
  D1 items.
- No live ingest or network run was performed. The memory numbers come from synthetic
  files.
