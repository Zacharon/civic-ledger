# Evidence: 2026 races, every registered candidate, outside money per race

Branch `claude/races-20261020` (base `fda8c59`), 2026-10-20, review fixes 2026-10-21. Local
proof only: nothing was pushed, deployed or run against a production database. Decisions:
DECISIONS A21 (amended), A72 to A81.

## What was built

- `candidate` table (one migration, `0006_candidate`, regenerated once after review; rollback
  row in `packages/db/migrations/README.md`), loaded by `fec-bulk@3`: every House and Senate
  row of the FEC candidate master whose election year is the cycle, as filed, `person_id`
  only for Bioguide matches.
- Capabilities `races.list@1` and `races.get@1` (registry, `/api/v1`, MCP `races_list`,
  `races_get`), the `formatFecName` formatter, seat keys and seat placement.
- Pages `/races` and `/races/<cycle>/<seat>` (`ga-senate`, `ga-10`, `ak-al`), a race line on
  member profiles, a Races nav link. Fictional seed races (ZV, ZW, ZZ), tests, docs.

## Review findings (independent reviewer, "merge after fixes")

| Item | Status | What changed |
|---|---|---|
| B1 adapter version | fixed | `fec-bulk@3` in `index.ts` (the earlier edit had silently not applied). Tests: a rerun of a snapshot at the same version is deduplicated; a changed version reloads the same snapshot into an emptied `candidate`; the shipped version is asserted. |
| B2 seats that exist | fixed | Blank district stored as null (not 0). `placeRow`: single-seat places (AK, DE, ND, SD, VT, WY, DC, AS, GU, MP, PR, VI) put every House row at large (MP's `01` too); a blank or `00` district in a state with several, a district that does not exist and a Senate row where nobody sits are `unplaced` (listed as filed under the state, no seat page, 404). Existence = a member's term at the seat overlaps the Congress ending in the cycle. **Seats: 522 before, 490 after** (441 House, 49 Senate); 4,343 registrations at seats, 36 unplaced in 31 groups. |
| S1 duplicate registrations | fixed | `alsoRegisteredFor`, `sharedCommitteeWith`, `sameNameAsFiledAs` in `races.get`; the page says "Also registered for Georgia Senate (...); same committee, so its figures are shown under both", shared-committee rows are left out of the bar scale (and show no bar), same-name rows are noted. |
| S2 empty name | fixed | `name_as_filed` nullable (0006 regenerated, still one file), shown as "Name not filed"; sorted last. |
| S3 name formatter | fixed | Rewritten: only leading and trailing runs of special words in the given names are taken apart; nothing is stripped from the surname; no period added in the surname; a special word between ordinary words leaves the filed order (case only); REP, SEN dropped; LT, PFC, CMR, OD, ED.D. and more known; duplicates removed; apostrophe capitals only after O, D, L, N, De, Di, La, Le, Da; two-letter and vowel-less nicknames stay as filed. 65 unit cases. |
| S4 neutrality | fixed | One table in name order; a registration with no report is a row reading "No report on file". No `<details>`. |
| S5 `/races` size | fixed | Default page: form, Senate table and one line per state for the House. `?state=XX` shows that state's full tables and its unplaced registrations; `?chamber=house` the House-by-state list (no seat table); `?chamber=senate` the Senate. One `races.list` read per view; the state select comes from the state table. Works without JS. **Default page 149,487 B raw (about 146 KB), 18,965 B gzip, on real data** (was about 1.1 MB). |
| S6 notice | fixed | `notice` in both outputs, in both tool summaries, a note beside the profile race line ("FEC registration is not a ballot listing"). |
| N1 bad cycles | fixed | `.refine(even)` plus range on the input; the page answers 404 for 1900, 2101, odd years, malformed keys (e2e). |
| N2 provenance per candidate | done (cheap) | Each candidate carries `registration` (its `cn` provenance); the run-level `sources` stay. |
| N3 `current_date` | documented | A81 and the `loadIncumbents` comment: an appointed senator leaves the list after the November date. No code change. |
| N4 | fixed | Shrink test matches `rows in candidate for cycle:2026`; the no-state counter is split (`candidates_without_state_skipped`); the profile race lookup logs `races.list unavailable on a profile` (pino, safe error fields) and fails soft. |
| N5 header names only the incumbent | skipped (acceptable as is) | |

## Agent-native / human-usable gates (standard gates 1 to 4)

| Gate | Evidence |
|---|---|
| 1 Shared capability | Pages call `read('races.list' / 'races.get')`; `parity.test.ts` proves dispatch, HTTP and MCP return deep-equal payloads and identical errors; `shared-values.spec.ts` (`checkRaces`) compares the rendered pages with HTTP and MCP on a Postgres stack, before and after a restart. |
| 2 Shared state | One `candidate`, totals and IE table for UI, API and MCP. |
| 3 Scoped authority | Anonymous public reads only; every MCP tool is read-only (test); `readonly-credentials.pgtest.ts` calls `races.get` as the select-only role. |
| 4 Human usability | axe (WCAG 2.2 AA) light and dark and phone 390 px on the race routes; no-JS state and chamber filters; overflow checks 320 to 1440 px. |

Gates 5 to 7 do not apply (no user data written, no external effect).

## Commands and results (after the last code change)

| Command | Result |
|---|---|
| `pnpm check` (lint, typecheck, test, build) | pass: 63 files, 590 tests |
| `E2E_PORT=3310 E2E_SCALE_PORT=3311 pnpm --filter @civic-ledger/web test:e2e` | pass: 99 passed (desktop and performance projects), on the commit before the one-line import change below |
| `playwright test e2e/races.spec.ts e2e/a11y.spec.ts e2e/design-system.spec.ts --project=desktop` | pass: 70 passed, after the import change |
| `pnpm test:pg` | pass: 9 files, 72 tests |
| `pnpm exec vitest run packages/ingest/test/candidate-load.test.ts` (version reload, blank district/name, sweep, shrink) | pass (inside `pnpm check`) |

The only change after the full e2e and `test:pg` runs was `apps/web/src/lib/races.ts`
importing `./format` and `./states` relatively (a new unit test could not resolve the `@/`
alias under vitest); `pnpm check` and the three specs above were rerun after it. A Windows
`EBUSY` temp-dir message can print after `test:pg` stops its embedded server.

## Real data (data/raw of 2026-10-20, fresh `.pglite/live`, built app on port 3312)

Receipt counters for `fec-bulk` (run 3 of a fresh database, `--migrate`): `candidates` 8,812,
`candidate_rows` 4,379, `candidate_rows_matched_to_person` 525,
`candidates_other_election_year_skipped` 2,987, `candidates_without_state_skipped` 0,
`candidates_other_office_skipped` 1,446.

`races.list` (default cycle 2026): 490 seats (439 House seats up, 2 House seats with nobody
up, 35 Senate seats up, 14 Senate seats with registrations and nobody up), 4,343
registrations at seats, 2,584 active, 2,849 with a money report, 1,494 without, 36 unplaced
registrations. Unplaced include AZ, FL, IL, MD, MO, OR blanks; GA, MN, NV, NY, TX `00`;
UT-71, UT-9, GA-23, MT-22, SC-89, SC-86, OK-82, NM-66, OH-65, PA-36, WA-38 and others; and
Senate rows for AS, DC, PR. `/races/2026/fl-al`, `ut-71`, `az-al` are 404.

Sizes (identity encoding, one cold and one warm request): `/races` 149,487 B; `?state=GA`
72 KB; `?chamber=senate` 118 KB; `?chamber=house` 74 KB; `/races/2026/ga-senate` 103 KB.

Checked pages: `/races`, `/races?state=GA`, `?state=UT` (unplaced), Georgia Senate (21
registrations, 6 with reports, incumbent Jon Ossoff, Reagan Box -$200 as filed), Georgia 1st
district (Buddy Carter's House registration carries "Also registered for Georgia Senate; same
committee" and no bar), Alaska at-large, Ohio Senate (appointed senator Husted, term end
2026-11-03), Ossoff's profile.

### formatFecName over all 4,379 real names

Run again after the rewrite over 4,379 rows (one has no name). All but 6 are reordered; those 6 stay in filed order with only the
case fixed (a title or honorific sits between ordinary words): `KAPTUR, MARCY HON. M.C.`,
`ARMINIO, JOSEPH DR. JOE PH.D.`, `WASHINGTON, MAURICE G MR I`, `MARKERT, GEORGE WASHINGTON MR V`,
`CLEMENT, CHRISTINA LOREN REV DR TRUSTE`, `WHITSON, CATHERINE BARCEL MS BARCY`. Spot-checked
(all as intended): `CARL, JERRY LEE, JR` -> Jerry Lee Carl Jr.; `WENDELIN, STEVEN COMMANDER
USN, (RET)` -> Commander Steven Wendelin USN (Ret.); `PIERCE, MICHAEL DAVID LTC (RET.)` ->
LTC Michael David Pierce (Ret.); `RAZACK, MD JD, NIZAM` -> Nizam Razack MD JD; `MONTANEZ
BERRIOS (DMB), DELIRIS` -> Deliris Montanez Berrios (DMB); `MCDONALD RIVET, KRISTEN` -> Kristen
McDonald Rivet; `ZYLBERFINK, ANDREW 'AJ'` -> Andrew 'AJ' Zylberfink; `GARY, GE'NELL` ->
Ge'nell Gary; `O SALVESEN, JOHN` -> John O Salvesen; `K, NEZARUS H` -> Nezarus H. K.
Limits: intercaps (DeLauro, DesJarlais) are not recoverable from upper case; `PH.D.` in a fallback
name becomes `Ph.d.`; a 6-digit number inside a name is kept (only 7 or more digits are removed).

### Odd FEC records found

- Election years from 1980 to 2999 (typos such as 2764); only year = cycle is stored.
- Appointed senators (Ohio, Florida) end 2026-11-03 in congress-legislators, so "seat up"
  includes November terms (A74).
- Districts that do not exist, blank and `00` districts, an MP delegate filed as `01`, and an
  empty name (`H6AZ08210`): handled by A79 and S2.
- A candidate's House and Senate ids repeat one committee's totals (A80).
- Duplicate registrations of one name (Chelsae Pile, two ids in the Georgia Senate race).
- Names with phone numbers, ranks, credentials, nicknames, or cut at the field length.
- 47 blank ICI codes, one blank status; party codes `W`, `N`, `TX`, `02` shown as filed.

## Screenshots

`C:\Users\user\Workspace\_worktrees\Civic_Ledger\_gate\races\` (32 files, real data,
regenerated after the fixes): `races-index`, `races-index-ga`, `races-index-ut-unplaced`,
`race-ga-senate`, `race-ga-1-house-shared-committee`, `race-ak-at-large`,
`race-oh-senate-special`, `profile-ossoff`, each at 1440 px (`desktop-1440`) and 390 px
(`phone-390`), light and dark. Not committed.

## Limitations

- Local proof on one machine under load; no production data, hosted behaviour or deploy.
- `?chamber=house` lists the House by state; a state's districts are at `?state=XX` (my
  reading of "split ?chamber=house per state"); the default page is 149,487 B, about 0.5%
  under the 150 KB target.
- Seat existence comes from congress-legislators terms; a vacancy filled late or a seat created
  by redistricting after the file's date would read as "no such district" until the data catches up.
- Seed uses fictional party codes (HBR, PRA), shown as filed, and has no at-large seat: the
  at-large and single-seat paths are covered by unit tests that insert an Alaska seat, and by
  real data.
- "Seat up" for 35 Senate seats includes the two appointed senators; 14 Senate seats with
  registrations have no senator up and say so.
- Money reports exist only for candidates in the FEC all-candidates summary; "no report" does
  not mean zero. Outside spending is per FEC id.
- Name conversion is heuristic (A77).
- `STATE_NAMES` moved to `apps/web/src/lib/states.ts` (small edit in `member-finder.tsx`).
