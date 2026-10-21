# Evidence: 2026 races, every registered candidate, outside money per race

Branch `claude/races-20261020` (base `fda8c59`), 2026-10-20. Local proof only: nothing was
pushed, deployed or run against a production database. Decisions: DECISIONS A21
(amended), A72 to A78.

## What was built

- `candidate` table (migration `0006_candidate`, rollback row in `packages/db/migrations/README.md`),
  loaded by `fec-bulk@3`: every House and Senate row of the FEC candidate master whose
  election year is the cycle, as filed, `person_id` only for Bioguide matches.
- Capabilities `races.list@1` and `races.get@1` (registry, `/api/v1`, MCP `races_list`,
  `races_get`), the `formatFecName` display-name formatter, seat keys.
- Pages `/races` and `/races/<cycle>/<seat>` (`ga-senate`, `ga-10`, `ak-al`), a race line on
  member profiles, a Races nav link.
- Fictional seed races (ZV, ZW), tests, docs.

## Agent-native / human-usable gates (standard gates 1 to 4)

| Gate | Evidence |
|---|---|
| 1 Shared capability | The pages call `read('races.list' / 'races.get')`; `apps/web/test/parity.test.ts` proves dispatch, HTTP and MCP return deep-equal payloads and identical errors for 4 list and 5 get inputs plus 7 invalid inputs; `e2e/shared-values.spec.ts` (`checkRaces`) compares the rendered page with HTTP and MCP on a Postgres stack, before and after a process restart. |
| 2 Shared state | Same `candidate`, totals and IE tables for UI, API and MCP; `checkRaces` reruns after the restart. |
| 3 Scoped authority | Anonymous public reads only; MCP tool list test requires every tool read-only; `test-pg/readonly-credentials.pgtest.ts` calls `races.get` as the select-only role. No write path exists. |
| 4 Human usability | Playwright + axe (WCAG 2.2 AA), light and dark, on `/races`, `/races?state=ZV`, five race pages and phone 390 px; no-JS state filter and disclosure; overflow checks 320 to 1440 px. |

Gates 5 to 7 do not apply: the feature writes no user data and has no external effect.

## Commands and results

| Command | Result |
|---|---|
| `pnpm check` (lint, typecheck, test, build), run twice, last after the final code change | pass: 61 files, 562 tests, build ok |
| `E2E_PORT=3310 E2E_SCALE_PORT=3311 pnpm --filter @civic-ledger/web test:e2e` | first full run: 93 passed, 2 failed (`compare-browse.spec.ts:14` 60 s test timeout; `shared-values.spec.ts:480` afterAll hook timeout), 2 performance tests did not run because they depend on the desktop project. Both failures looked load-related (other agents were running suites). Rerun once each: `compare-browse` and all of `shared-values` pass (8 passed). `--project=performance --no-deps`: 2 passed (Explore LCP 1392 ms cold). An earlier full run failed once in `shared-values` on a bug in my new race check (it read text inside a closed `<details>`); fixed, not a skipped test. No test was weakened or skipped. |
| `pnpm test:pg` | 71 of 72 passed; the one failure was my omission (`readonly-credentials.pgtest.ts` calls every public capability and had no input for `races.get`). Fixed; that file then passes alone (3 passed). The whole suite was not rerun after the fix. A Windows `EBUSY` temp-dir error prints after the embedded server stops; exit status was 0 for the single file. |
| `pnpm exec vitest run packages/ingest` (before the seed and capability work) | 172 passed (candidate loader, sweep and shrink-guard tests added afterwards and pass in `pnpm check`) |
| `DATABASE_URL= pnpm ingest all --db .pglite/live --migrate` | all five sources `succeeded`; `fec-bulk` run 3 |

New tests: `packages/core/test/race-name.test.ts` (50 name cases), `races.test.ts` (17:
list, get, sort default, person filter, seat-up rules, provenance, errors),
`packages/ingest/test/candidate-load.test.ts` and two cases in `pipeline.test.ts`,
`apps/web/e2e/races.spec.ts` (10), additions to `a11y.spec.ts`, `design-system.spec.ts`,
`shared-values.spec.ts`, `parity.test.ts`, `test-pg/*`.

## Real data (data/raw of 2026-10-20, `.pglite/live`, built app on port 3312)

`fec-bulk` receipt counters: `candidates` 8,812 (cn26 rows), `candidate_rows` 4,379,
`candidate_rows_matched_to_person` 525, `candidates_other_election_year_skipped` 2,987,
`candidates_other_office_skipped` 1,446 (presidential),
`candidacies` 851 (unchanged behaviour), `independent_expenditures` 28,083 of which 10,976
matched a person (17,107 kept by FEC candidate id with no person), `ie_unattributed_dropped`
2,988 (blank candidate id in the FEC file; cannot be keyed). `races.list`: 522 seats, 4,379
registrations, 2,588 active (status C), 2,854 with a money report, 1,525 without.

Georgia Senate (`/races/2026/ga-senate`): 21 registrations, 8 active, 6 with money reports,
incumbent Jon Ossoff; Reagan Box shows cash on hand `−$200` with "as filed" (the file holds
-$200.01). Also checked: `/races/2026/ga-10`, `/races/2026/ak-al`, `/races/2026/oh-senate`
(appointed senator Jon Husted, term end 2026-11-03), `/races?state=GA`, Ossoff's profile
(shows "2026 race: Georgia Senate").

### Odd FEC records found

- Election year: the file keeps 1980 to 2999 (typos such as 2764, 2999); only year = cycle is stored.
- Appointed senators (Ohio, Florida) have `end: 2026-11-03` in congress-legislators, not Jan 3
  2027: the "seat up" rule had to include them (A74).
- 19 Senate seats (AZ, CA, CT, ..., plus DC, AS, PR) carry 2026-year registrations while no
  sitting senator's term ends in 2026; shown as "no sitting member's term ends".
- Seats that do not exist: Georgia has an at-large row (2 registrations) and a district 23.
- A candidate with a House and a Senate id appears under both seats (Buddy Carter in GA-1 and
  the Georgia Senate race); the same person is not de-duplicated across seats.
- Duplicate registrations of one name (Chelsae Pile, two FEC ids in the Georgia Senate race).
- Names: phone numbers inside CAND_NAME, honorifics, ranks, credentials, nicknames, and a name
  cut at the field length ("CLEMENT, CHRISTINA LOREN REV DR TRUSTE" reads "Rev. Dr. Christina
  Loren Truste Clement"; the as-filed line is printed beneath every candidate).
- 47 blank ICI codes, one blank status; party codes `W`, `N`, `TX`, `02`, `DE` are shown as
  filed.

## Screenshots

`C:\Users\user\Workspace\_worktrees\Civic_Ledger\_gate\races\` (30 files, real data): for
`races-index`, `races-index-ga`, `race-ga-senate`, `race-ga-10-house`, `race-ak-at-large`,
`race-oh-senate-special`, `profile-ossoff` at 1440 px (`desktop-1440`) and 390 px
(`phone-390`), light and dark, plus `race-ga-senate-disclosure-open-desktop-1440-*`.
Screenshots are not committed.

## Limitations

- Local proof on one machine under load. Not run: the Postgres 17 full suite after the last
  fix (single file only), production data, hosted behaviour, any deploy.
- The seed uses fictional party codes (HBR, PRA) that display as filed.
- Seat keys name a state's Senate seat, not an election: if a state had two Senate elections
  in a cycle the FEC file would not let us separate their candidates (none in 2026).
- Outside spending is per FEC candidate id, so a person with a House and a Senate id has
  separate figures on the two race pages (the profile's money view sums by person).
- Money reports exist only for candidates in the FEC all-candidates summary; "no report" does
  not mean zero.
- `/races` is 1.1 MB of HTML for all 522 seats (about 1.5 s cold on this machine).
- Name conversion is heuristic (A77); Mac surnames outside a short list stay as spelled.
- The member-finder `STATE_NAMES` table moved to `apps/web/src/lib/states.ts` (small edit in
  `member-finder.tsx`).
