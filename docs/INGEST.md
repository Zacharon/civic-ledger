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
| 6 | `census-boundaries` | none (all) | Census `cb_2025_us_cd119_500k.zip` + `cb_2025_us_state_500k.zip` (shapefiles) | 10 MB | 13 s with the files on disk; 66 s with the 10 MB of downloads, both 2026-10-20 (the 66 s on a loaded machine) |
| 7 | `member-photos` | none (all) | GitHub tree listing + `225x275` and `450x550` JPEG per member in scope (1,078 files) | 106 MB stored (117 MB downloaded) | first load ~12 min, rerun ~4 min (2026-10-20, PGlite, machine shared with other builds; see below) |

Full first load of sources 1-5: 6 min 10 s (2026-10-16, quiet machine); the sixth adds 13-66 s, so
about 6 min 25 s to 7 min 20 s. The first load of all six on 2026-10-20 took 19 minutes, but two other
agents' ingests and test suites were running on the same machine, so that is a loaded-machine
figure, not a baseline. An unchanged rerun (`pnpm ingest all`): about 10 s for the first five
(all files 304, every source deduplicated) plus about 20 s for `census-boundaries` measured on the
loaded machine (two conditional GETs, then hashing 10 MB; it does not reparse). `member-photos` adds about 12 minutes on a
first load and about 4 minutes on a rerun (see below). Defaults: `--congress` = current congress, `--cycle` = current
two-year cycle.

### member-photos (official portraits)

Self-hosted portraits for member records (DECISIONS A81-A85; source notes in
[DATA_SOURCES.md](DATA_SOURCES.md) 6b). It runs last, depends on `congress-legislators` (its run id is in
the snapshot checksum), and needs the network only for one GitHub API call (the repository tree, 60
unauthenticated calls per hour per address) plus the image files.

* **Selection:** people with a Bioguide id and a term ending after 2025-01-03 (555 on 2026-10-20). Only
  people with at least the 225x275 file in the listing are fetched (the 450x550 file is optional); a
  missing portrait is normal (16 of 555: the 15 newest members and one former member).
* **Downloads:** 6 in parallel, each file capped at 2 MiB, the whole selection capped at
  `INGEST_MAX_PORTRAIT_TOTAL_BYTES` (default 400 MiB, checked against the listing before anything is
  fetched), conditional GET with `ETag` from `data/raw/member-photos/http-cache.json`, raw files and
  `manifest.json` (sha256 per file, source URL, tree id) under `data/raw/member-photos/<date>/`. Every
  file, and every cached copy offered for a 304, is checked against the git blob SHA-1 in the listing; the
  upstream tree id is in the receipt's `note`. `GITHUB_TOKEN`, when set, lifts the API rate limit (listing
  request only, never logged).
* **Validation (per person):** complete JPEG (grayscale, colour or CMYK), inside the variant's pixel
  box and at least 20% of its area. A bad file rejects the person: counted (`rejected_*`,
  `files_rejected`), and a good pair from an earlier run is kept (`rejected_kept_previous`).
* **Metadata stripping (no re-encoding):** EXIF/XMP, Photoshop/IPTC, comments, JFXX and other APPn
  segments are dropped, the JFIF thumbnail zeroed; JFIF, ICC and Adobe segments and all image data are
  copied byte for byte, and the result is validated again. The stored sha256 (ETag, cache key) is of the
  stripped bytes; the downloaded file's sha256 and size are kept in `origin_sha256` / `origin_byte_length`.
  Counters: `origin_bytes`, `portrait_bytes`, `metadata_bytes_removed`, `files_with_exif`,
  `files_with_gps`, `files_with_thumbnail`.
* **Load:** upsert on `(person_id, variant)` with provenance, in batches of 10 people; portraits no longer
  asserted are deleted (`stale_portraits_deleted`) under the shrink guard (dataset `person_portrait`).
* **Offline reload:** `pnpm ingest member-photos --snapshot data/raw/member-photos/<date>` reads that
  directory's files instead of the network.
* **Timings** (2026-10-20, PGlite, while three other agents were building and ingesting on the same PC, so
  read them as upper bounds): first load 11 min 59 s (about 10 min of downloads, 2 min to validate and store
  117 MB); rerun after an adapter version bump, every file answered 304: 4 min 6 s. An unchanged rerun with the
  same adapter version stops after the 304s with `"deduplicated": true`.
* **Receipt counters:** `portraits` (rows, two per person), `people_with_portrait`, `people_in_scope`,
  `people_without_portrait`, `people_without_450`, `portrait_bytes`, `files_rejected` and
  `rejected_{bad_name,missing_1x,too_large,not_jpeg,wrong_size,unreadable}`,
  `bioguide_not_in_legislators`, `rejected_kept_previous`, `stale_portraits_deleted` and the metadata counters
  above. Run 2026-10-20 (`member-photos@4`): 1,078 portraits, 539 people, 555 in scope, 16 without, 0 rejected,
  stored 105,855,819 bytes from 117,303,947 downloaded (11,448,128 removed; 508 files with EXIF/XMP, 386 with
  a thumbnail, 0 with GPS), 1,078 files verified against their git blob SHA-1, 5 min 43 s with every file a 304
  (machine shared with other builds).

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
   `data/raw/<source>/http-cache.json`. A cached copy is offered for that 304 reuse only
   if it still matches its recorded size and sha256 and is within the current
   `INGEST_MAX_DOWNLOAD_BYTES`; otherwise the file is fetched in full (A65).
4. If (source, adapter version, snapshot checksum) is the key of the latest successful
   run of the scope (also when that run was a `--force-replay`), the provisional row is
   dropped and that run's receipt is returned with `"deduplicated": true`. If the key
   succeeded earlier but a later run superseded it, the run is refused with
   `snapshot_superseded` (see "How to rerun").
5. Opens **one transaction** (DECISIONS A50) and, inside it: streams, parses and upserts
   in batches (each a savepoint), stages FEC pas2/IE rows and dedupes them in SQL
   (A53), deletes rows the source no longer asserts (A18), runs the shrink guard (below),
   refreshes `person_card` and `person_card_scorecard` (`CONCURRENTLY`: readers keep the
   old rows), and writes the `succeeded` receipt with counts and refresh times.
6. Commits. Facts, both read models and the receipt become visible together. Any error,
   refusal, Ctrl-C or deadline before this point rolls all of it back; the receipt then
   says `failed` or `cancelled`. Written before the transaction (and kept on failure):
   the `source` metadata row and the `running` receipt with its snapshot checksum.

## Proposed schedules (UTC, GitHub Actions cron once D1 picks the database)

| Job | When | Why |
|---|---|---|
| `pnpm ingest all` | daily 09:00 | Unchanged files dedupe in seconds via 304 / checksum. |
| `pnpm ingest fec-bulk` | daily 13:00 extra in Sep–Nov of election years | FEC masters refresh daily, pas2 ~weekly, IE 24/48-hour reports daily near elections. |
| `pnpm ingest govinfo-billstatus` | every 6 h while Congress is in session | BILLSTATUS updates every 4 h for the current congress. |
| `pnpm ingest curated` | on every merge to `main` touching `data/curated/**` | Owner merge is the approval (D3). |

`census-boundaries` depends on no other source (it writes `district_map`, keyed by state code and district number), so it can run alone and is last only so that a Census outage never blocks the money, vote and identity data. It downloads two shapefile zips, projects each state with its own projection, simplifies and stores SVG path data (about 4-5 s of CPU for the whole country). Each zip must hold exactly one `.shp` and one `.dbf` (and at most one `.shp.iso.xml`) at its root, named for the file, with the same record count, and no entry may inflate past 64 MiB (the generic 2 GiB cap also applies); anything else fails the run. The loader refuses any generated path that is not plain drawing commands. Its vintage (`GENZ2025`, 119th Congress) is pinned in `adapters/census-boundaries/parse.ts`; to move to a new vintage change `CENSUS_VINTAGE_YEAR` / `CENSUS_CONGRESS`, check the new metadata abstract still states when the states provided boundaries (the run fails otherwise, so the shown as-of date is never guessed), and bump the adapter `version`. Counters: `shapes` (rows written), `states`, `districts` (numbered), `whole_state_districts` (`00`/`98` records with no shape of their own), `vertices_in` / `vertices_out`, `rings_dropped`, `stale_shapes_deleted`. The shrink guard compares `shapes` with the last run (about 440).

Run `curated` after any upstream reload: its snapshot includes upstream run ids, so it
re-codes new committees and re-resolves framework targets even when the YAML is unchanged.

## Failure handling

| Symptom | Meaning | Action |
|---|---|---|
| `conflict: run_in_progress` | Another run of that source holds the lock. | Wait; check the `running` row in `sources.status`. |
| receipt `status: cancelled` | Ctrl-C or the run deadline (`--deadline-minutes`, `INGEST_RUN_DEADLINE_MS`) stopped the run before its commit, at the next record or phase boundary; inside the FEC loader, before its next statement (stage, dedupe, page and each sweep statement; DECISIONS A52). A statement already running finishes first; other loaders finish the batch in hand. Nothing was committed. | Rerun when ready (a longer deadline if it timed out). |
| `failed`, `error: snapshot_superseded: …` | You replayed a snapshot an older run loaded, after a later run loaded other data. Replay is not a restore. | Rerun with `--force-replay` if you really want that snapshot back; the receipt records `replayOf`. |
| `failed`, `error: … download cap` / `… decompression cap` | A downloaded file, a cached copy that would be reused, or a zip entry is larger than `INGEST_MAX_DOWNLOAD_BYTES` / `INGEST_MAX_DECOMPRESSED_BYTES`. | Check the upstream file; raise the cap only if the size is genuine. |
| `failed`, `error: … GitHub API … HTTP 403` (member-photos) | The unauthenticated API rate limit (60 per hour per address) or a block. | Wait an hour and rerun; nothing was loaded. |
| `failed`, `error: … repository listing is truncated` (member-photos) | The tree answer exceeded GitHub's limit, so the list would be partial. | Do not load; switch the plan to per-folder trees. |
| `failed`, `error: … INGEST_MAX_PORTRAIT_TOTAL_BYTES cap` | The selected photos total more than the cap (the listing grew or the scope widened). | Check the selection; raise the cap only if the size is genuine. |
| counter `files_rejected` > 0 (member-photos) | A pair failed validation; the log line `portrait rejected` names the file and why. | Inspect the file upstream; the previous good pair, if any, was kept. |
| `failed`, `error: … manifest schema_version N is not supported` | `--snapshot` points at a snapshot written by a newer build. | Use a build that reads that version. |
| receipt `status: failed`, `error: GET … HTTP 404` | File moved or not published yet (new cycle/congress). | Check the URL in DATA_SOURCES.md; nothing was loaded. |
| `failed` after retries on 5xx / timeout | Source down or slow. | Rerun later; nothing was loaded. |
| `failed`, `error: shrink guard: …` | The upstream file looks truncated or empty (see below). Nothing was changed. | Check the upstream file (size, row count). If the source really shrank, rerun with `--allow-shrink`. |
| `failed` with a parse error (`line N`, `Unexpected BILLSTATUS shape`, `Unknown Voteview cast_code`) | Source format changed. | Fix the parser with a fixture cut from the new file, bump the adapter `version`, rerun. |
| `failed`, `error: … the metadata no longer states when the states provided district boundaries` | Census reworded the metadata abstract, so the as-of date cannot be read (it is shown to readers and must not be guessed). | Read the new `.shp.iso.xml` abstract, update `asOfFromMetadata` and its test, bump the adapter version. |
| `failed`, `error: Census boundary files look truncated` / `… is for Congress N, expected 119` | A cut-off download, or the URL now serves another Congress. | Check the two zips (441 district and 56 state records expected); nothing was loaded. |
| `failed`, `error: … unexpected entry` / `duplicate entry` / `has no <name>.shp and <name>.dbf` / `the .shp has N records but the .dbf has M` / `feature N (GEOID) has no geometry` / `has STATEFP xx, which is not in …` / `duplicate district …` | The archive layout or contents differ from the Census files the adapter was written for. | Open the zip; nothing was loaded. Fix the adapter only after reading the new layout. |
| `Curated data is invalid: file:line …` | A merged YAML file fails the schema. | Fix the file; nothing from the curated run was loaded. |
| Voteview TLS error | Their certificate chain; never disable verification. | Retry later; report upstream if it persists. |

A failed, refused or cancelled run leaves facts, read models and counts as they were (the
transaction rolled back), so the site keeps serving the last good state. A process that
dies mid-run leaves a `running` row, which the next run of that source marks `failed`
(`abandoned: …`); its transaction never committed. Only the source metadata row and the
run's own receipt row are written outside the transaction.

## Shrink guard (data-loss protection)

Sources are complete snapshots, so a stale-row sweep deletes whatever the new file no
longer contains. An empty or truncated file that still downloads with HTTP 200 would
therefore wipe a source's rows. Each guarded adapter declares its datasets
(`shrinkDatasets`: table, explicit loaded-row counter, sweep counter, scope column;
DECISIONS A51). Diagnostic counters (`votes_unmatched_member`, `*_dropped`, `*_matched_*`)
are never counted as loaded records. Before a load commits, the runtime refuses it (status
`failed`, transaction rolled back, nothing changed) when any of these holds:

* **Dataset sweep too large.** A table's sweep counter (e.g. `stale_totals_deleted`)
  exceeds `INGEST_MAX_DELETE_FRACTION` (default **0.1**, 10%) of that table's rows **in
  this scope** (e.g. `cycle = 2026`), counted before the load. Judged when the table has at
  least `INGEST_MIN_RECORD_BASELINE` rows, and always when the sweep would empty it.
* **Dataset floor.** A table's loaded rows fall below `INGEST_MIN_RECORD_RATIO` (default
  **0.5**) of the same counter in the last successful run of the same source and scope,
  when that run loaded at least `INGEST_MIN_RECORD_BASELINE` (default 20).
* **Source totals** (outer bound, A42): all declared sweep counters against every row the
  source owns, and the sum of the declared loaded counters against the last run's sum.

The error names every violated check, for example `shrink guard: the stale-row sweep
would delete 19 of 19 existing rows in candidate_cycle_totals for cycle:2026 (100%, limit
10%). Rolled back; no rows were changed.`

`--allow-shrink` commits the load anyway, logs the violation at `warn` and records it in
the receipt's `note` (`shrink guard overridden (--allow-shrink): …`), for a source that
legitimately shrank, such as a repealed program or a corrected double count. The first
load of a source and the `curated` source (git-reviewed, where removing a file is an
intended change) are not guarded. Thresholds are the agent's defaults pending owner input
(readiness audit, owner item 8); tune them with the environment variables above.

## How to rerun

- Same files again → deduplicated, no writes (by design). This also holds right after a
  `--force-replay`: retrying the replayed snapshot without the flag returns the replay
  run. Retrying *with* `--force-replay` loads it once more (a new run, same data).
- **Replaying an older snapshot is not a restore.** If snapshot A succeeded, then B, then
  A is offered again, the run is refused (`snapshot_superseded`) and B's data stays. To
  load A again as a new run (receipt `replayOf` = A's run), pass `--force-replay`:
  `pnpm ingest <source> --snapshot data/raw/<source>/<date> --force-replay`. It is a new
  load under the shrink guard, not a rewind of other sources or of curated data.
- Reload a saved snapshot after restoring a database: `--snapshot` as above (add
  `--force-replay` if the restored ledger already lists it as superseded). Snapshot
  manifests carry `schema_version: 1` (DECISIONS A55).
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
