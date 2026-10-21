# Vote visuals evidence (2026-10-20)

Branch `claude/vote-visuals-20261020`, based on `fda8c59`. Three visuals, each fed by a core
capability that `/api/v1` and MCP also expose (feature standard gates 1-4; gates 5-7 do not
apply: reads only, no user data, no external effect). No schema change, no new dependency.

| Visual | Where | Capability | Notes |
|---|---|---|---|
| How each party voted | `/policy/[area]` roll-call list; member profile, Votes table (folded per row) | `votes.list@1` `byParty` (extended; no `rollcalls.get`, no roll-call page) | Party = party on the vote date (term data supports it). Rows sum to the roll-call tally. |
| Attendance by month | Member profile, Votes section | `votes.attendance@1` `{slug, congress?}` | Eligible and missed use the `person_card` definitions; totals equal `votesEligible` / `missedVoteRate`. |
| Chamber seat chart | Home, "Who serves now" | `chamber.composition@1` `{}` | Owner-approved party colour for this chart only. Order: Democrat, Independent, Republican, then other parties alphabetically. |

## Verification (local proof)

| Command | Result |
|---|---|
| `pnpm check` (lint, typecheck, test, build) | pass: 60 test files, 522 tests, lint clean, build ok (the Turbopack "dynamic filesystem access" warning in `packages/db/src/client.ts` is pre-existing) |
| `pnpm test:pg` (real Postgres 17) | 70 of 71 passed first run; the one failure was `readonly-credentials` serving every public capability without an input for `votes.attendance` (a test gap, fixed: input added); that file then passed 3 of 3. Capability results on Postgres equal PGlite for the new capabilities. |
| `E2E_PORT=3330 E2E_SCALE_PORT=3331 pnpm --filter @civic-ledger/web test:e2e` | first run: 90 passed, 1 failed (`shared-values` "actual ingest publication ... restarts", a 180 s timeout while other agents were running suites; 5 dependent tests did not run). Rerun of `shared-values.spec.ts` alone: 7 of 7 passed (that test took 41 s). `--project=performance --no-deps`: 2 of 2 passed (Explore, 600 members: cold LCP 1352 ms, warm 616 ms, CLS 0). Nothing skipped or weakened. |
| `apps/web/e2e/vote-visuals.spec.ts` (23 tests, in the run above) | axe WCAG 2.2 AA in light and dark on `/`, `/policy/health`, `/people/avery-ashvale`, `/people/jules-kindlewood`; the same four at 390 px with no sideways scroll; keyboard: the phone fold opens with Enter, the attendance table twin opens with Enter and its scroll region is focusable; every number compared with `/api/v1`. |
| `apps/web/e2e/design-system.spec.ts` | `/people/jules-kindlewood` added to `ROUTES` (reflow at 320 to 1440 px). |
| API / MCP parity | `apps/web/test/parity.test.ts` (direct dispatch = HTTP = MCP for `votes.attendance` x4 inputs and `chamber.composition`, and identical errors); `e2e/support/supplemental-values.ts` adds attendance (per profile) and seat chart (Home) comparisons that run against HTTP and MCP before and after a data change and a restart (`shared-values.spec.ts`). |

Unit and semantics tests added: `packages/core/test/vote-visuals.test.ts` (party sums, party
switch, overlapping terms, late end dates, month classification, attendance equals the
Explore figures for every seeded member, delegates and vacancies on a synthetic full
roster, seat order), `apps/web/test/vote-visuals.test.ts` (component data logic) and
`apps/web/test/vote-semantics.test.ts` (extended: new components never reference party or
Yea/Nay colours where they must not, only Democrat and Republican seat squares take party
colour, seat fills are at least 3:1 on the surface in both modes).

## Fictional seed additions

Jules Kindlewood (House, ZZ-2) is sworn in on 2025-06-10; positions before that date are
dropped after all random draws, so no random draw changed (only that member's earlier positions are gone). The House holds no votes in
June, July, October or December 2025, and nobody votes in January 2025 or December 2025. The
seed has three parties (Harbor, Prairie, Independent). The seed has no delegates, and its
roster is partial, so vacancies are not drawn there (covered by a synthetic-roster unit test
and the real data).

## Real data (`.pglite/live`, ingest of 2026-10-20, 382,871 vote positions)

`DATABASE_URL= pnpm ingest all --db .pglite/live --migrate`: all five sources succeeded.

- **Composition** (`chamber.composition`, as of 2026-10-20): House 433 voting members (214
  Democrat, 1 Independent, 218 Republican), 2 vacancies, plus 6 non-voting (3 Democrat, 3
  Republican: AS, DC, GU, MP, PR, VI) = 439 House rows (221 R / 217 D / 1 I as the Explore
  table counts them). Senate 100 (45 Democrat, 2 Independent, 53 Republican), 0 vacancies.
  Provenance: congress-legislators run 1.
- **Attendance** for Lisa Murkowski and Jon Ossoff: 915 eligible votes each in the 119th
  Congress (Jan 2025 to Sep 2026, 21 months), 38 and 51 missed, 0 present: 4.2% and 5.6%,
  equal to the profile's missed-vote rate. Ashley Moody (sworn in Jan 21, 2025): 20 of the
  28 votes held in January 2025, 907 eligible, matches her card. Real data has no month
  without a roll call and no mid-Congress "not yet serving" month for these members; those
  states are exercised by the fictional seed and unit tests only.
- **Party at the vote date**: 17 positions in the 119th Congress (11 House, 6 Senate; 4
  House and 3 Senate members) had no term in force on the vote date because the member's
  recorded last day is a day or two before their last recorded vote (for example David Scott's
  term ends 2026-04-21 and Voteview records him on 04-22; also Sylvester Turner, Mikie
  Sherrill, Tony Gonzales). They take the party of their latest earlier term, so the real data
  shows no "Unknown" row; "Unknown" appears only for a member with no earlier term. No two
  terms of one person overlap in the data.
- Party rows sum to the tally on every roll call checked (newest 100, and the Health house
  and senate lists): 0 mismatches.

### Performance (real data, PGlite, same machine, noisy because other agents ran suites)

Capability level, median of 7 after a warm-up, old = `votes.list` at `fda8c59` in the same
process, new = this branch:

| Call | Old | New |
|---|---|---|
| `votes.list` Health, House, 10 (has the 4 late-end-date members) | 144 ms | 237 ms (exact fallback for the few roll calls that need it) |
| `votes.list` Health, Senate, 10 | 157 ms | 90 ms |
| `votes.list` Murkowski, 20 | 82 ms | 94 ms |
| `votes.list` Ossoff, 20 | 93 ms | 80 ms |
| `votes.attendance` Murkowski / Ossoff | n/a | 146 / 139 ms |
| `chamber.composition` | n/a | 47 ms |

The first implementation (a correlated subquery, then a distinct-on join) cost +50 to
+250 ms; the shipped one is a single grouped query plus a count check, with the exact path
only for roll calls whose party cannot be read from the term in force.

Page level (`curl`, built app on port 3332, median of 7, warm). Before = base web files
(`fda8c59`) on the same core; after = this branch. The before run happened while the machine
was busier, so a difference under about 0.2 s is not meaningful:

| Page | Before | After | HTML bytes before / after (gzip) |
|---|---|---|---|
| `/` | 0.72 s | 0.65 to 0.87 s | 56 KB to 136 KB (13.1 to 21.5 KB) |
| `/policy/health` | 1.18 s | 0.83 to 1.36 s | 704 KB to 729 KB (28.4 to 30.3 KB) |
| `/people/lisa-murkowski-m001153` | 1.13 s | 0.86 to 1.29 s | 275 KB to 533 KB (37.8 to 49.5 KB) |
| `/people/jon-ossoff-o000174` | 1.30 s | 0.82 to 1.33 s | 371 KB to 629 KB |

No index was added, so there is nothing to report as a schema change. `vote_position` has
`(rollcall_id, person_id)` and `(person_id)` indexes and `term` has a `(person_id, ...)`
unique index; these served every query above. EXPLAIN on real Postgres was not run.

## Screenshots

`C:\Users\user\Workspace\_worktrees\Civic_Ledger\_gate\vote-visuals\`, each at 1440 and
390 px, light and dark (`-1440-light.png`, `-1440-dark.png`, `-390-light.png`, `-390-dark.png`):
`home-seats`, `policy-health`, `policy-first-rollcall-open`, `murkowski-attendance`,
`murkowski-votes`, `ossoff-votes`. `shoot.mjs` is the script that produced them against the
built app on the live database.

## Limitations

- The attendance strip's cells are not individually focusable (they are plain text with a
  sentence per month); the keyboard route is the table twin disclosure and its focusable
  scroll region.
- Other (non Democrat, Republican, Independent) parties in the seat chart are told apart by
  pattern and by the legend; three patterns repeat for a fourth party.
- Democrat and Republican seat fills differ mainly by hue; their order, labels and counts are
  always printed, so colour is never the only cue.
- Vacancies depend on the congress-legislators file being current; the 2 House vacancies on
  2026-10-20 are as that file states.
- Party at the vote date uses the term data; a member's mid-term party change is recorded in
  congress-legislators as a new term, and a source that did not record it would show the old
  party.
- Not run: EXPLAIN on real Postgres, `pnpm smoke:real`, a visual check of a real member who
  was not yet serving in an earlier month.
