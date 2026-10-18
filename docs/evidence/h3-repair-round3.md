# H3 repair round 3: H3R2-02 residual cancellation boundaries, H3R3-01, two overclaims

Branch `claude/h3r3-cancel-restore-20261018` (from integration head `221d9cd`). Review
being answered: vault `01_PROJECTS/Civic_Ledger/audits/h3-readiness-round3-2026-10-18.md`,
sections "Remaining code defect: H3R2-02 / H3-04", "H3R3-01" and "Documentary
reconciliation" items 2 and 4. This is the third and final permitted repair cycle.

Commits:

- `209f9cc` test only, with the red logs. `git diff --stat 221d9cd 209f9cc --
  packages/ingest/src packages/db packages/core packages/mcp apps` is empty.
- `0dbf439` the fix (`packages/ingest/src`), A52, INGEST, CHANGELOG.
  `git diff 209f9cc 0dbf439 -- packages/ingest/test test-pg` is empty: the same test
  files go from red to green. The round-2 test `cancellation-fec.test.ts` is
  byte-identical to `221d9cd`.
- `e54d5ff` OPERATIONS restore comparison policy and rollback wording, the
  normalization test, CHANGELOG.

Raw logs: [h3-repair-round3/](h3-repair-round3/). All runs: Windows 10, Node 24, pnpm
11.13.1, in-memory PGlite, and embedded PostgreSQL 17 for `pnpm test:pg`. No network.

## 1. H3R2-02 residual (MEDIUM): statements still ran after an abort

**Reproduction.** These tests follow the reviewer's method, and the scenarios are shared
by both drivers (`packages/ingest/test/support/fec-boundary-scenarios.ts`; runners
`packages/ingest/test/cancellation-fec-boundaries.test.ts` and
`test-pg/cancellation-fec-boundaries.pgtest.ts`). Setup: migrate, load the committed
legislators and FEC fixtures, then record every `public` base table except `ingest_run`
and both materialized views (count + md5 of the sorted rows, `candidate_cycle_summary`
included). Then FEC is reloaded with `forceReplay: true`. Only the loader's database is
wrapped, transaction callbacks included. Right after a chosen awaited statement
resolves, the test aborts the real operator `AbortController`. After that it records
every loader `execute`, query-builder entry (`select*`, `insert`, `update`, `delete`)
and `transaction`. To pass, a case needs status `cancelled`, no loader statement after
the abort and state equal to the baseline. Coverage:

- 17 named triggers: the review's 13 (pas2 and IE initial DROP, stage CREATE, stage
  INSERT, kept-table CREATE, statistics query, first kept-page read, plus the first sweep
  DELETE) and sweep DELETEs 2 to 5.
- An exhaustive sweep. One reference reload, cancelled as `load` returns, lists every
  awaited loader statement plus each point where a savepoint callback starts (the driver
  has just awaited its SAVEPOINT). The test then aborts after each of them in turn: 39
  boundaries, listed in [boundary-list.txt](h3-repair-round3/boundary-list.txt).
- Postgres only: a lost source lock (the lock backend terminated) right after the pas2
  initial DROP and right after the first sweep DELETE. The status must stay `failed`.

**Red** at `209f9cc` ([red-pglite.txt](h3-repair-round3/red-pglite.txt): 7 failed / 11
passed; [red-pg.txt](h3-repair-round3/red-pg.txt): 9 failed / 11 passed). The results
were the same on both drivers:

| Trigger | Loader statements after the abort |
|---|---|
| pas2 initial DROP | `create temp table fec_pas2_stage` |
| IE initial DROP | `create temp table fec_ie_stage` |
| sweep DELETE 1 | 4 DELETEs (independent_expenditure, candidate_cycle_totals, committee_link, candidate_cycle_summary) |
| sweep DELETE 2 / 3 / 4 | 3 / 2 / 1 DELETEs |
| other 11 named triggers, DELETE 5 | none (pass) |
| exhaustive | 15 of 39 boundaries violated (the 6 above, plus the 9 below) |
| pg lost lock after pas2 DROP / DELETE 1 | the CREATE / the 4 DELETEs |

The audit (exhaustive sweep) found two gaps beyond the review:

- After `insert office` (the office upsert in `loadCandidates`), `insert candidacy` ran
  unchecked.
- At the start of each of the 8 savepoint callbacks (committee, candidacy, link, totals,
  summary, contribution page, IE page, sweep), the callback's first statement ran
  unchecked. For the candidacy savepoint that is two statements, and for the sweep all
  five DELETEs.

Every red case still rolled back and had a `cancelled` receipt (or `failed` for the lost
lock). The failures are on the statement list only.

**Cause.**

- `stage.ts` `createPas2Stage` / `createIeStage` ran DROP then CREATE with nothing in
  between.
- `load.ts` checked only around each whole helper.
- `deleteStaleCycleRows` ran five awaited DELETEs in one savepoint with no check
  between them, and the only check was before the sweep as a whole.
- `loadCandidates` ran the office upsert and the candidacy insert back to back.
- Drizzle's nested `transaction()` awaits `savepoint spN` before it calls the callback.
  The loader checked before `transaction()`, not inside it.

**Fix** (`0dbf439`). This is the same combined `RunControl.checkpoint` that
`LoadContext.checkpoint` already passes in; no new mechanism.

- `createPas2Stage` / `createIeStage` take the checkpoint and call it between DROP and
  CREATE.
- A `savepoint()` helper checks before it opens the savepoint and again as the first
  step of its callback. Every loader savepoint uses it.
- A check before each sweep DELETE, between the office upsert and the candidacy insert,
  before the initial identifier lookup and before the chamber lookup in `flushTotals`.

**Audit of every statement in `load.ts` / `stage.ts`** (a check now comes directly
before each one, with no other await in between):

- Identifier lookup: new check.
- Committee, candidacy, link, totals chunk, summary chunk, contribution page and IE page
  writes: a check before the savepoint and at callback entry (callback entry is new).
- Office upsert to candidacy insert: new check.
- Chamber lookup: new check.
- Stage DROP: existing check. Stage CREATE: new check. Stage INSERT: existing check.
- Kept-table CREATE and statistics query: existing checks.
- Every kept-page read and the stage drops: existing checks.
- Sweep DELETEs 1 to 5: new check before each.

Unchanged by design:

- A statement already running finishes.
- `cancellationReason()` is untouched, so a lost lock is `failed` and an operator abort
  or deadline is `cancelled`.
- A thrown checkpoint unwinds into the outer load transaction's rollback (A50).
- The replay and retry rules (A54) are not touched.

**Green** at `0dbf439`/`e54d5ff`:

- [green-pglite.txt](h3-repair-round3/green-pglite.txt): 18/18 boundary tests, plus the
  round-2 `cancellation-fec.test.ts` (4), `cancellation.test.ts` (4),
  `fec-sql-dedupe.test.ts` and the normalization test; 5 files / 38 tests.
- [green-pg.txt](h3-repair-round3/green-pg.txt): 20/20, including both lost-lock cases
  (`failed`, `source lock connection lost`, no statement after, state equal).

**Residual limits.**

- The fixture reaches one stage INSERT batch, one data page per kept table and one
  totals and summary chunk. The loops (more batches, pages, chunks) run the same
  per-iteration checks, but no trigger exercises a second iteration.
- Not checked: the driver's own SAVEPOINT, RELEASE and ROLLBACK TO SAVEPOINT. When a
  check throws inside a callback, drizzle issues ROLLBACK TO SAVEPOINT. When the abort
  arrives during a callback's last statement, RELEASE runs before the next check. These
  are unwinding statements, not loader work, but they are statements. The wrapper does
  not see them.
- No statement is interrupted. Latency after an abort is still bounded by the running
  statement and its statement timeout. Nothing was measured at live scale.
- The deadline was not triggered at the new boundaries. It uses the same
  `RunControl.checkpoint` (with the clock check). Only the operator abort and the lost
  lock were exercised here.
- The lost-lock cases are Postgres only, because the PGlite lock cannot be lost. They
  depend on timing: they poll until the advisory lock is gone, then wait 500 ms for the
  pg client's error event.
- Other loaders are still checked per record only (A52), unchanged.
- The round-2 report's "FEC cancellation now stops at statement boundaries" was
  supported only for its four triggers. Its dated logs are kept as they are; this report
  adds the residual.

## 2. H3R3-01 (LOW): the restore comparison rejected regenerated timestamps

**Reproduction.** The reviewer's PGlite probe: after seed, `sources.status`, refresh,
`sources.status` again, the raw answers differ only in `readModelRefreshedAt`. In this
round, `packages/core/test/restore-normalization.test.ts` repeats it for
`sources.status`, `people.get` (`card.refreshedAt`) and `explore.table`
(`scope: 'all'`). The raw answers and the raw `person_card` checksum differ. The
normalized answers, and the checksum over `to_jsonb(t) - 'refreshed_at'`, are equal. A
changed fact still differs after normalization. There is no red/green, because this is
a procedure (documentation) defect and the test only checks the policy.

**Cause.** `docs/OPERATIONS.md` step 4 required exact JSON equality, but every refresh
regenerates `refreshed_at` (`statement_timestamp()` in the view). A pg_restore of a dump
repopulates materialized views by refreshing them; this is known pg_dump behaviour and
was not run here. "Current" answers and `tenure_years` also depend on `current_date`.

**Fix** (`e54d5ff`, OPERATIONS "Backup and restore", steps 0 and 4):

- The record now stores its date.
- A comparison policy names the only volatile fields (`readModelRefreshedAt`, every
  `refreshedAt`, the column `person_card.refreshed_at`) and keeps exact equality for
  every business value, provenance field, count, receipt field and `ingest_run` row.
- Date-dependent answers are named: `isCurrent`, `scope: 'current'` answers, the
  current counts of `explore.facets`, the `people.search` order and `tenureYears` /
  `tenure_years`. They are compared exactly on the record date, or else excluded and
  listed with both dates. No capability takes an as-of date, so the record uses
  `scope: 'all'` wherever an input has a member scope.
- Content integrity is now a separate result from freshness and traffic readiness.
  Non-strict health must be 200. Strict health may legitimately be 503 for an old,
  correct backup, and is recorded next to the integrity result.
- "This drill has never been run" is kept.

**Residual limits.** The drill is still not implemented or run (VC-084). The date-change
branch and the pg_restore view refresh are not tested at runtime. The test runs on the
fictional seed and PGlite only.

## 3. Overclaims

- **A52 / loader comment / runbook.** A52 is amended in place with a dated note: the
  round-2 wording, the specific gaps, the exact new guarantee, what is not checked and
  the fixture-bounded proof. Also updated to the same wording: the `load.ts` and
  `stage.ts` comments, `runtime/cancel.ts`, `LoadContext.checkpoint` and the INGEST
  failure-table row.
- **Rollback.** OPERATIONS now calls stable `/api/v1` paths design intent. A rollback
  removes any additive fields or capabilities the bad release added. No previous app or
  client was run against the current schema, and A63's structural check is not such a
  run. VC-055 is unverified.
- **CHANGELOG.** Three "Fixed" entries.

Not touched: `AGENT_NATIVE_EVIDENCE.md` (it still cites round-2 ratings pending review)
and the historical files under `docs/evidence/`.

## Seven gates (changed behaviour only: `ingest.run` cancellation; the restore runbook)

- Shared capabilities / shared state: PASS, local. The tests call `runIngest`, the same
  path as `pnpm ingest`.
- Scoped authority: not applicable (operator-only, unchanged).
- Human usability: PASS, local. The INGEST failure table and OPERATIONS describe the
  behaviour and the drill policy.
- Visible supervision: this repair supports PASS for the FEC loader's own statements,
  within the limits above. Re-rating is for the independent reviewer. Other loaders are
  still per record.
- Safe recovery and receipts: PASS, local. The state equalled the baseline in every
  case, with `cancelled` / `failed` receipts.

## Verification runs

- `pnpm check`: **exit 0**. Lint, typecheck, 48 files / 413 tests, build
  ([pnpm-check.txt](h3-repair-round3/pnpm-check.txt)).
- `pnpm test:pg`: **exit 0**, 9 files / 67 tests ([test-pg.txt](h3-repair-round3/test-pg.txt)).
  The one logged `database pool error` ("terminating connection due to administrator
  command") comes from the lost-lock tests, which terminate the lock backend on purpose.
- The new tests on each driver: see "Green" above.

All of this is local evidence. Nothing was pushed, merged, run in CI or run against a
live provider or production database.
