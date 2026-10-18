# H3 repair round 2: ingest findings H3R2-01..03

Branch `claude/h3r2-ingest-20261018` (from integration head `33ef2d5`). Review being
answered: vault `01_PROJECTS/Civic_Ledger/audits/h3-readiness-round2-2026-10-18.md`,
findings H3R2-01, H3R2-02 and H3R2-03 (round-1 rows H3-07, H3-04 and H3-05, all PARTIAL).
H3R2-04 (agent parity CI) was fixed separately (`851d4c4`). H3R2-05 is not addressed here.

How to verify the gate yourself:

- Red: `git checkout c511d71`. That commit adds only the three test files and the red
  logs; `git diff --stat 33ef2d5 c511d71` lists nothing under `packages/*/src` or `apps`.
  Run the commands below; they fail as recorded.
- Green: the fix commit `e663f83` (or later), same commands, same test files:
  `git diff c511d71 e663f83 -- packages/ingest/test` is empty.
- Raw logs: [h3-repair-round2-ingest/](h3-repair-round2-ingest/). The green per-finding
  logs use `--reporter=verbose` so each test name is listed; that flag does not change
  what runs.

All runs: Windows 10, Node 24.16.0, pnpm 11.13.1, PGlite (in-memory), embedded
PostgreSQL 17 for `pnpm test:pg`. All fetches are mocked; nothing contacted the network.

## H3R2-01 MEDIUM: a successful forced replay could not be retried normally

**Reproduction.** `pnpm exec vitest run packages/ingest/test/replay-current.test.ts`.
Uses the real congress-legislators adapter, the committed fixture as snapshot A and a
temporary copy with one fictional marker name as B.

**Red** (`red-h3r2-01.txt`, 2 failed, 1 passed):

```
x A -> B -> forced A -> A deduplicates to the forced run
  AssertionError: expected 'snapshot_superseded: this snapshot wa…' to be null
x a lost-response retry after a forced replay returns the current receipt
  expected { runId: 4, … } to match object { runId: 3, status: 'succeeded', … }
✓ still refuses a snapshot that a later run superseded (A -> B -> forced A -> B)
```

The second case wraps the outer database transaction so that it commits and then
throws ("acknowledgement lost"), as in the reviewer's probe. The retry was refused with a
new failed run (4) instead of returning committed run 3.

**Root cause.** `runtime/run.ts` deduplicated only if `findSucceededRun` (the EARLIEST
successful run of the key, `orderBy(id)`) was also the latest successful run of the
scope. After A1 -> B2 -> forced A3 the earliest run of A is 1 and the current one is 3,
so a repeat of A was refused as superseded by the run that had loaded A itself.

**Fix.** `packages/ingest/src/runtime/run.ts`: the latest successful run of the scope
(`latestSucceededRun`) decides. If its (source, adapter version, snapshot checksum)
equals the requested key, that run is returned with `deduplicated: true`, forced replay
or not. If the key succeeded earlier but differs from the current generation, the run is
refused as before. `findSucceededRun` (`runtime/ledger.ts`) is now only the origin for
`replayOf`. When no run of the scope has succeeded yet, the old behaviour (return the
key's earliest run) is kept. `--force-replay` still always loads.

**Green** (`green-h3r2-01.txt`): 3/3 passed. The round-1 replay tests
(`replay-manifest.test.ts`) also pass, inside `pnpm check`.

**Remaining limits.** Retrying *with* `--force-replay` after a lost response loads the
snapshot again: a new run with the same data (documented in INGEST "How to rerun").
The key is still not scoped (A18). The lost acknowledgement was simulated by wrapping
the driver's transaction call, not by dropping a real connection.

## H3R2-02 MEDIUM: FEC cancellation did not stop at statement or page boundaries

**Reproduction.** `pnpm exec vitest run packages/ingest/test/cancellation-fec.test.ts`.
The test loads legislators and the FEC fixture, then runs FEC again (adapter version
bumped, so it is not deduplicated) with the loader's database wrapped: the operator
signal aborts right after a chosen statement returns, and every statement the loader
starts after that is recorded (`execute` with its SQL, plus `transaction`, `select*`,
`insert`, `update` and `delete` calls). There are four trigger points: after
`create temp table fec_pas2_kept`, after the first `fec_pas2_kept` page read, and the
same two for IE.

**Red** (`red-h3r2-02.txt`, 4/4 failed). Statements issued after the abort:

```
pas2 after kept table : pas2 stats query, page select, transaction (page write), page select, drop
pas2 after first page : transaction (page write), page select, drop
IE after kept table   : IE stats query, page select, transaction, page select, drop, transaction (sweep)
IE after first page   : transaction, page select, drop, transaction (sweep)
```

This matches the reviewer's probe (stats, two page selects, drop) and adds the page
writes and, for IE (the last phase), the cycle sweep. Receipts were already `cancelled`
and rolled back. The test fails on the statement list only.

**Root cause.** `adapters/fec-bulk/load.ts` (`flushPas2`, `flushIe`, the end-of-stream
flushes and `deleteStaleCycleRows`) and `stage.ts` (`dedupeStaged*`, the `pages`
generator) never looked at cancellation. The runtime only checks before each parsed
record (`abortable`) and after the whole loader returns.

**Fix.** It uses the existing control; there is no new mechanism. `LoadContext` gets
`checkpoint?: () => void`, and `runtime/run.ts` passes `() => control.checkpoint()`
(`RunControl.checkpoint`, which also applies the clock-based deadline check). The FEC
loader calls it, falling back to `ctx.signal.throwIfAborted()` when there is no
checkpoint, at these points:
- before each kind batch;
- before stage create/insert;
- inside `dedupeStagedPas2` / `dedupeStagedIe` before the kept-table statement and before
  the stats query;
- before every kept-page read (`pages`) and every page write;
- before each stage drop;
- before each totals/summary chunk;
- before the cycle sweep.

A cancelled flush does not drop its temp tables; the rollback of the load transaction
removes them. A lost lock still throws through the same checkpoint, and the run stays
`failed` (`cancellationReason` is unchanged).

**Green** (`green-h3r2-02.txt`): 4/4 passed. Each case had no statements after the abort,
a `cancelled` receipt and fact-table counts equal to those before the run. The round-1
`cancellation.test.ts` and the 10 seeded `fec-sql-dedupe.test.ts` cases also pass.

**Remaining limits.** A statement already running is not interrupted. It finishes,
bounded by the statement timeout. The other loaders (legislators, Voteview, BILLSTATUS,
curated) are still checked per record only, so the statements of the batch in hand, and
after the last record their final sweep, complete before the runtime's next checkpoint.
`runtime/cancel.ts`, A52 and INGEST now say exactly this, instead of the general "next
record or statement boundary" wording. The new test runs on PGlite only; the Postgres
suite was rerun green but has no FEC cancellation case. No latency was measured at live
scale.

## H3R2-03 MEDIUM: cached 304 reuse bypassed the download byte cap

**Reproduction.** `pnpm exec vitest run packages/ingest/test/download-cache-cap.test.ts`
(mocked fetch, temporary directories).

**Red** (`red-h3r2-03.txt`, 2 failed, 1 passed):

```
x refuses to reuse a cached copy larger than a lowered cap
  promise resolved "{ bytes: 4096, notModified: true, … }" instead of rejecting
✓ still reuses an intact cached copy within the cap
x stops validating the cached copy when the run is cancelled
  promise resolved "{ bytes: 33554432, notModified: true, … }" instead of rejecting
```

**Root cause.** In `runtime/download.ts`, `isIntact` hashed the cached file without the
run signal and swallowed every error. The 304 branch returned before any `maxBytes`
check, so a 4,096-byte cached copy passed a 1,024-byte cap. An aborted run also hashed
the whole cached file and still sent the request.

**Fix.** `runtime/download.ts` has a new `checkCached`. It (1) stats the cached file and
requires its recorded size, (2) compares that on-disk size with the current `maxBytes`
BEFORE hashing, and (3) hashes with the run signal, rethrowing an abort instead of
reporting "not intact". An over-cap copy is not offered for revalidation (A65): the
request goes out without `If-None-Match` / `If-Modified-Since`, so a real server sends the
body and the existing streaming cap decides. A 304 to that unconditional request fails
with `the cached copy is 4096 bytes, over the 1024-byte download cap, so it is not
reused …`. A 304 without any intact copy now fails with a clear message rather than
"empty response body". Nothing is copied into the new snapshot directory in either case.

**Green** (`green-h3r2-03.txt`): 3/3 passed. The existing `http.test.ts` cases
(conditional GET + reuse, no partial file on a mid-stream error) and `bounded.test.ts`
(fresh-body cap, decompression cap) pass inside `pnpm check`.

**Remaining limits.** The cancellation case aborts on a 0 ms timer while a 32 MiB cached
copy is read and hashed. It proves that no request is sent and that the abort reason
surfaces, but it does not pin the exact chunk where the abort is seen. Files from
`--snapshot` directories and the repository's curated files are not download-capped (the
decompression cap still applies to zip entries); OPERATIONS, A53 and `limits.ts` now say
so. The `limits.ts` claim that the defaults are far below what would exhaust a small
host is withdrawn: they are proposals, not sized against a host. Between the size check
and the copy, a concurrent process could still replace the cached file (no lock on
`data/raw`).

## Documentation changed

DECISIONS: A52 (checkpoint list and its per-loader limit), A53 (cap now covers cached
reuse; exclusions), A54 (the current generation decides; amended note) amended in
place with dated "Amended 2026-10-18" text; new **A65** (an over-cap cached copy is
refetched unconditionally rather than failed outright). Also updated: CAPABILITIES
"Write semantics", INGEST (steps 3 and 4, failure table, "How to rerun"), OPERATIONS
`INGEST_MAX_DOWNLOAD_BYTES` row, DATA_SOURCES FEC note, the `ingest.run` contract
comment, the CLI help, `runtime/cancel.ts` and `runtime/limits.ts`. CHANGELOG has three
"Fixed" entries. Not touched: the reviewer's other reconciliation items
(`ARCHITECTURE.md:119-120` refresh-after-commit wording, `AGENT_NATIVE_EVIDENCE.md`
"repair in progress"), which are outside these three findings.

## Seven gates (operator capability `ingest.run`, changed behaviour only)

Same runtime for the human CLI (`pnpm ingest`) and the agent/capability path
(`runIngest`, `ingest.run@1`). These fixes change shared runtime code, not an adapter.

- Shared capabilities / shared state: PASS, local. The tests call `runIngest`, which the
  CLI also calls.
- Scoped authority: NOT APPLICABLE. No authority change (operator-only, unchanged).
- Human usability: PASS, local. The CLI help and the INGEST failure table give the new
  messages and the retry rule.
- Visible supervision: PARTIAL. FEC cancellation now stops at statement boundaries. The
  other loaders still finish the batch in hand, as documented.
- Safe recovery: PASS, local. Same key and payload after a forced replay or a lost
  response gives one effect; a stale key still refuses.
- Receipts: PASS, local. Cancelled and deduplicated receipts were checked against the
  committed state in the tests.

## Verification runs

- `pnpm check`, first run: exit 1. One unrelated timeout in
  `packages/mcp/test/cli-credentials.test.ts` (30.3 s, 1 failed / 392 passed;
  `pnpm-check-run1-timeout.txt`). Another agent was using the machine at the same time.
- That file alone: 3/3 passed (`rerun-mcp-cli-credentials.txt`).
- `pnpm check`, second full run: **exit 0**. Lint, typecheck, 46 files / 393 tests passed
  and build done (`green-pnpm-check.txt`).
- `pnpm test:pg`: **exit 0**, 8 files / 47 tests passed (`green-test-pg.txt`). After the
  summary, embedded-postgres prints its known shutdown `TypeError: done is not a
  function` (H3R2-05, not addressed here); the exit code was still 0 with all tests
  passing.

Everything above is local evidence. Nothing was pushed, run in CI, or run against a
live provider or a production database.
