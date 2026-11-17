# T-B Voteview corrections (F3): evidence

Worker B, branch `claude/voteview-reconcile-20261019`, worktree
`_worktrees/Civic_Ledger/fix/voteview-reconcile-20261019`. Not pushed, not merged.

| Item | Value |
|---|---|
| Base | `76b74c3` (0006 committed: `ideology_score.provisional`) |
| Red commit | `68475de` test(voteview): red regressions (16 tests) |
| Fix commit | `b36d9cc` fix(voteview): reconcile, completeness checks, provisional |
| Evidence commit | the commit adding this file |

## Red (against `76b74c3`, source unchanged)

Command: `pnpm vitest run packages/ingest/test/voteview-reconcile.test.ts apps/web/test/scores-provisional.test.ts`
(run with the only working-tree change stashed; HEAD `76b74c3`). Exit code **1**:
`Test Files 2 failed (2) · Tests 16 failed (16)`, 154 s. Key lines:

| Test | Failing assertion at base |
|---|---|
| R1 ICPSR→Bioguide A→B | `119H144:22325: expected [ 7, 8 ] to deeply equal [ 8 ]`: one source vote under two people |
| R2 dim1 now missing | counts lack `stale_ideology_scores_deleted` (old score still current) |
| R3 cast_code 0 + removed row | `vote_positions: 136 …` not matched (no sweep; rows stay) |
| R3b rollcall absent | counts lack `rollcalls_absent_from_snapshot` / sweep |
| R4 provisional | `A000375: expected null to be false` (flag never stored) |
| R5 out-of-scope congress | `expected 'succeeded' to be 'failed'` (a 118 row was loaded by a 119 run) |
| R6 small correction | `vote_positions: 137 …` not matched (no sweep counters) |
| R7 failure during reconciliation | `expected 'succeeded' to be 'failed'` (nothing to reconcile, trigger never fires) |
| 7 completeness refusals | 6 × `expected 'succeeded' to be 'failed'`; empty members file: `expected 'shrink guard: loaded 36 records again…' to match /voteview snapshot incomplete…/` (only the record floor caught it) |
| HTTP/MCP provisional | `arden-brackenridge: expected { congress: 119, …(5) } to have property "provisional" with value true` |

One red-test bug was fixed in the fix commit: R7 compared `first.id`; the receipt field is
`runId` (it failed earlier at the status assertion at base, so the red result stands).

## Green (at `b36d9cc`)

| Check | Command | Result |
|---|---|---|
| New regressions | `pnpm vitest run packages/ingest/test/voteview-reconcile.test.ts apps/web/test/scores-provisional.test.ts apps/web/test/ideology-status.test.ts` | PASS, exit 0, 3 files / 17 tests, 109 s |
| Existing ingest tests touching voteview, the sweep or the guard | `pnpm vitest run packages/ingest/test/{pipeline,runtime,shrink-guard,shrink-scope,rules,bounded,replay-manifest,replay-current,publication}.test.ts` | PASS, exit 0, 9 files / 90 tests, 178 s |
| Core + adapters | `pnpm vitest run packages/core/test/{scores-promises,glance,catalog,dispatch}.test.ts packages/ingest/test/smoke.test.ts apps/web/test/{parity,openapi}.test.ts` | PASS, exit 0, 7 files / 80 tests, 38 s |
| Lint | `pnpm lint` | PASS, exit 0 |
| Typecheck | `pnpm typecheck` | PASS, exit 0 (after typing fix in the test) |
| `pnpm test:pg`, `pnpm build`, Playwright, full `pnpm test` | — | NOT RUN (orchestrator-only per contract) |

No existing assertion was changed or relaxed. Existing receipts only gain counters
(`toMatchObject` everywhere); P3 (`shrink-scope.test.ts`) still reaches the shrink guard
because C8b is judged only from 1,000 vote rows.

## Design as implemented

* **C1 one congress** (`parse.ts`): every members/rollcalls/votes row, President rows
  included, must carry the scope's congress; otherwise
  `HS119_rollcalls.csv line N: congress 118 is outside the run scope (congress 119)`.
* **Reconciliation** (`load.ts` `reconcile`, inside the run transaction as a savepoint,
  after the completeness checks, with `ctx.checkpoint()` before each statement): every
  row this run upserts carries its `ingest_run_id`, so
  `delete from vote_position where source_id='voteview' and ingest_run_id <> run and rollcall_id in (rollcalls of the congress)`
  (both chambers: the plan fetches the `HS` files, which hold House and Senate) and the
  same for `ideology_score` (`congress`, `method='dw-nominate'`). Counted as
  `stale_vote_positions_deleted`, `stale_ideology_scores_deleted`, `stale_rows_deleted`
  (sum), following the FEC/BILLSTATUS `stale_<loaded counter>_deleted` naming (plural; the
  brief's singular names would break that convention). Rollcalls are never deleted;
  `rollcalls_absent_from_snapshot` counts those the snapshot omitted (their positions are
  withdrawn, the row stays for BILLSTATUS links).
* **Shrink guard**: `shrinkDatasets` now declares `swept` for `vote_position`
  (scope via `rollcall_id → rollcall.congress`, the existing `scopeVia` support) and
  `ideology_score` (`scopeColumn: congress`). No runtime change was needed.
* **Identity**: votes are keyed by the person the snapshot's members file gives the icpsr
  (Bioguide only, never names); `source_key` stays `<rollKey>:<icpsr>`. After
  reconciliation each source vote maps to exactly one person (R1 asserts no `source_key`
  appears twice). A Voteview-owned `icpsr` identifier follows a corrected mapping
  (`icpsr_reassigned`); a congress-legislators-owned one is never moved
  (`icpsr_held_by_other_person`, unchanged).
* **Provisional**: `provisional: m.provisional` (`conditional = 1` → true, anything else
  → false) on every loaded score; the upsert overwrites it, so a later final estimate
  updates it (R4).
* **Adapter version** `voteview@2` (loader semantics changed; reruns of an unchanged
  snapshot reprocess once and fill `provisional`).

### Completeness rules and thresholds (`VOTEVIEW_COMPLETENESS`)

| Rule | Refused when | Threshold rationale |
|---|---|---|
| C1 | any row's congress ≠ scope | zero tolerance: wrong-scope data is never valid |
| C2 | members file has no member rows | zero tolerance |
| C3 | rollcalls file empty while the congress has rollcalls loaded | allows a brand-new congress with no votes yet |
| C4 | any vote row's rollcall missing from the rollcalls file | zero tolerance: Voteview files are generated together |
| C5 | any rollcall with no vote rows (any cast code) | zero tolerance: Voteview writes a row for every member on every rollcall |
| C6 | one icpsr with two Bioguide ids | zero tolerance (identity) |
| C7 | two icpsrs → one person with positions on one rollcall | zero tolerance (identity); a party switcher's inactive icpsr has cast code 0 |
| C8a | > 10% of member rows match no person, from 20 member rows | INGEST.md expects 0; a lagging c-l adds a handful of ~545 |
| C8b | > 1% of vote rows name an icpsr absent from the members file, from 1,000 vote rows | expected 0 on real files; baseline mirrors `INGEST_MIN_RECORD_BASELINE` so small fixtures defer to the shrink guard |

The per-dataset shrink guard stays the outer bound (R6 commits a 1-of-138 correction under
the default guard; R1's one-member correction deletes 3 of 138 positions and commits).

### History of a withdrawn assertion

Facts are current state; no history table was added. A withdrawn vote, score or mapping
is traced through (1) the reconciling run's receipt (`stale_*_deleted`,
`rollcalls_absent_from_snapshot`, `icpsr_reassigned`) and (2) the previous successful
run's receipt and its raw snapshot (`snapshot_locator`, made immutable by Worker A), whose
CSV rows still hold the earlier assertion. `vote_position.source_key` / `ideology_score.source_key`
(`<congress>:<chamber>:<icpsr>`) give the row to look up there.

## Public field changes (additive)

* `scores.list@1` `ideology[]` gains `provisional: boolean | null` (described in the
  schema). HTTP and MCP pick it up through the registry: `apps/web/test/scores-provisional.test.ts`
  asserts dispatch = HTTP = MCP for true, false and null; `parity.test.ts` stays green.
* `ingest.run` receipt for voteview gains counters: `stale_rows_deleted`,
  `stale_vote_positions_deleted`, `stale_ideology_scores_deleted`,
  `rollcalls_absent_from_snapshot`, `icpsr_reassigned`, `votes_icpsr_not_in_members`.
  `votes_unknown_rollcall` stays (always 0 on success now; C4 refuses otherwise).
* Profile Scores: the latest estimate shows "Provisional estimate" or "Status unknown"
  (nothing for final); the By-Congress table gains a Status column with the same labels;
  `data-provisional` (JSON true/false/null) on `[data-ideology]` and each
  `[data-ideology-congress]` row (A62 pattern). `data-value` is unchanged.

## Seven gates (feature standard), provisional status

| Gate | Evidence |
|---|---|
| Human control | profile Scores label (`scores-section.tsx`, `ideology-status.ts` + unit test) |
| Agent capability | `scores.list@1` field via `/api/v1` and MCP (same registry) |
| Same command | the UI reads `scores.list` through `read()`; no parallel query |
| Authorization | public read, unchanged; ingest remains operator-only |
| Validation | zod output schema `z.boolean().nullable()` |
| Durable state | `ideology_score.provisional` (0006), written by every voteview@2 load |
| Tests | R4 (DB + core), `scores-provisional.test.ts` (HTTP/MCP); UI rendering NOT RUN (Playwright is orchestrator-only) |

## Proposed DECISIONS rows (orchestrator to add)

| ID | Date | Decision | Status | Notes |
|---|---|---|---|---|
| A7x | 2026-10-19 | Voteview is reconciled per congress: after a complete snapshot loads, Voteview `vote_position` rows of the congress's rollcalls and `dw-nominate` scores of the congress that the run did not write are deleted (`stale_vote_positions_deleted`, `stale_ideology_scores_deleted`, `stale_rows_deleted`), inside the load transaction and under the per-dataset shrink guard; rollcalls are kept and counted (`rollcalls_absent_from_snapshot`); a Voteview-owned icpsr identifier follows a corrected mapping | Amends A18 (agent) | F3: upsert-only loading kept withdrawn votes and scores current and attributed one source vote to two people after an icpsr correction. History = previous receipt + raw snapshot. |
| A7y | 2026-10-19 | Voteview completeness rules C1-C8 refuse a snapshot before reconciliation (one congress per snapshot; members present; no unknown or vote-less rollcalls; one Bioguide per icpsr; one position per person and rollcall; ≤ 10% unmatched members from 20; ≤ 1% vote rows for unlisted icpsrs from 1,000) | Adopted (agent defaults; thresholds await the owner like A42) | A missing row is treated as a withdrawal only when the snapshot is internally consistent; the shrink guard stays the outer bound. |
| A7z | 2026-10-19 | `ideology_score.provisional` is stored from Voteview `conditional` on every load (true provisional, false final, null unknown for pre-0006 rows) and exposed as `scores.list@1` `ideology[].provisional` (additive); the profile labels provisional and unknown estimates | Adopted (agent) | No enum change; null is never shown as final. |

## Requests outside my paths

* **Runtime (Worker A)**: none required. The existing `scopeVia` in `countDatasetRows`
  covers `vote_position`. Note for A: the reconciliation calls `ctx.checkpoint()` before
  each sweep statement, so cancellation semantics match FEC.
* **Glance (unowned)**: `people.glance` `dwNominate` and `person_card` / `explore.table`
  do not carry `provisional`. Proposal: add `provisional` to `people.glance` `dwNominate`
  (additive) so the glance text can say "provisional"; the read model can follow later.
* **Playwright (orchestrator)**: `apps/web/e2e/support/supplemental-values.ts` could
  assert `data-provisional` on `#scores [data-ideology]` equals
  `JSON.stringify(scores.ideology[0].provisional)`.
* **Seed (orchestrator)**: `seedDevData` leaves `provisional` null, so the seeded profile
  shows "Status unknown" for every estimate. Consider seeding `false` (and one `true`) so
  the dev site shows the intended default.

## Open risks

* **First voteview@2 run per congress** reconciles everything earlier runs left behind;
  if that exceeds 10% of a congress's positions or scores the shrink guard refuses it
  and the operator must review and use `--allow-shrink`.
* **C5 / C7 assume Voteview's file conventions** (a row for every member on every
  rollcall; cast code 0 on a party switcher's inactive icpsr). Verified on the committed
  fixture cut only, not on a full live file in this task; a live mismatch fails safe
  (refusal) and would need a threshold.
* **Identifier flip-flop**: if two congress snapshots disagree on an icpsr's Bioguide,
  the Voteview-owned identifier follows the most recent run. Votes and scores are not
  affected (they are keyed per congress from each members file).
* **Memory**: C7 keeps one numeric key per loaded position (~400k per congress, tens of
  MB); not measured on a live file here.
* Real-Postgres behaviour (`with d as (delete … returning 1)` inside a savepoint) is not
  covered by `test:pg` in this task (NOT RUN, orchestrator-only).
