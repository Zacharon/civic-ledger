# District locator maps: evidence (2026-10-20)

Branch `claude/district-maps-20261020` (based on `fda8c59`), worktree
`_worktrees/Civic_Ledger/feature/district-maps-20261020`. Scope approved by the owner on
2026-10-20. Nothing here was pushed, merged or deployed; the live data is a local PGlite
(`.pglite/live`) loaded the same day. This is local proof, not production evidence.

## What was built

| Piece | Where |
|---|---|
| Ingest source `census-boundaries` (download, parse, project, simplify, store) | `packages/ingest/src/adapters/census-boundaries/` (`geometry.ts` pure functions, `read.ts`, `parse.ts`, `load.ts`, `index.ts`) |
| Table `district_map`, migration `0006_district_map`, rollback row | `packages/db/src/schema/geography.ts`, `packages/db/migrations/` |
| Capability `districts.shape@1` (UI, `/api/v1/districts.shape`, MCP `districts_shape`) | `packages/core/src/capabilities/districts.ts` |
| Component `DistrictLocator` + server wrapper `MemberDistrictMap` | `apps/web/src/components/district-locator.tsx`, `components/profile/member-district-map.tsx` |
| Placement | first item of the profile's **Source records** panel (`app/people/[slug]/page.tsx`: import + one element) |
| Fictional seed geometry (states ZV-ZZ, synthetic wedges labelled fictional) | `packages/db/src/seed/district-maps.ts` |

Decisions: DECISIONS A75-A79. Source details and the vintage notes: DATA_SOURCES section 8.

## Independent review fixes (2026-10-20, commit `ff2d536`)

Review verdict was "merge after fixes". All twelve items are done:

1. **Wrong district after 2027-01-03 (blocker).** `district_map.congress` (119) is stored and returned.
   `districts.shape` member mode (`{slug}`) draws a House district only when the member is current
   and their current term began in that Congress; a term starting 2027-01-03 is the 120th and gets
   no map. Senate and whole-state maps are unaffected. Tests: `congressOfDate` dates, and seeded
   members with terms starting 2027-01-03 (House: `not_found` naming the 120th and 119th; Senate:
   whole-state map; a term ending 2027-01-03: former), run with the clock set to 2027-02-01 (PGlite
   honours it), plus a mid-Congress special-election term that still draws.
2. **Eligibility in core.** The rule moved out of the web wrapper into the capability; UI, API and MCP
   call the same `{slug}` input. Documented in the capability summary, CAPABILITIES, API, DATA_SOURCES.
3. **Unknown district.** A House seat with a null district gets no map (core); `district` 0 is
   `not_found` for a state with numbered districts. The wrapper no longer defaults to 0.
4. **Fail-soft.** `loadMemberDistrictShape` logs (`web.district_map`, no driver text) and renders
   nothing for any failure except the silent `not_found`; unit-tested with a missing-table error.
   Migrations README rollback corrected (source/ingest_run rows stay; older `SourceIdSchema` in
   `ledger.ts` `toReceipt` does not know the source).
5. **Strict archives.** Exactly one `.shp` and one `.dbf` (and at most one `.shp.iso.xml`) at the root
   with the expected base name; `.shp` and `.dbf` record counts must match; truncated `.shp` fails.
6. **Memory.** 64 MiB per-entry cap (the smaller of it and the generic cap); no `ArrayBuffer` copy.
7. **Freshness.** `/api/health` and the operator monitor allow `census-boundaries` about 400 days;
   tests at day 400 and 401, and in the monitor at 399 and 401 days.
8. **Path validation** at load and in the output schema (`M L l Z`, digits, dots, minus, spaces; 60,000
   characters), tested with a hostile stored value and a hostile generated value.
9. **`stateProvenance`** returned next to `provenance`.
10. **Parser errors** for a district whose STATEFP has no state, a feature with no geometry (named by
    GEOID), and a duplicate district number.
11. **As-of reading** documented (DATA_SOURCES section 8): a data cutoff, not a validity promise.
12. **INGEST timing** for the sixth source corrected, with the loaded-machine caveat.

The real files still load through the stricter reader (run 9, `--force-replay`, same counts as before:
483 shapes, 54 states, 429 districts), which also confirms the no-copy `Uint8Array` read.
Migration `0006` was regenerated in place (unreleased, one file) to add `congress`; the local
`.pglite/live` table was dropped and re-created from it.

## Vintage, as-of date and redistricting (what the Census file says)

* Used `GENZ2025` 500k (`cb_2025_us_cd119_500k.zip`, `cb_2025_us_state_500k.zip`, published
  2026-04/05) instead of the `GENZ2024` named in the brief. Both hold the same 441
  `GEOID`s; land area per district differs by at most 0.21% (re-generalization). There is no
  120th Congress file (`cd120` 404) and no `GENZ2026`.
* Census metadata: the 119th Congress is seated January 2025 to December 2026; "States that
  had updates between the previous and current session include Alabama, Georgia, Louisiana,
  New York, and North Carolina"; boundaries "are based on information provided to the Census
  Bureau by the states by May 31, 2024". The adapter reads that date into `as_of`
  (**2024-05-31**) and fails the run if the sentence disappears.
* So the maps do **not** show redistricting after 2024-05-31. Mid-decade plans for 2026
  (reported for Texas, California, Missouri and North Carolina, with more in litigation) are
  not in the file. The maps fit the members now sitting (elected under the 2024 lines) and are
  not the lines for the November 2026 ballot. Every map says so in its caption, the capability
  returns `congress`, `vintage`, `asOf` and `caveat`, and core draws maps for **current members
  only**, and a House district only when the member's term began in the Congress the lines are for
  (so from 2027-01-03 a member elected under a redrawn map gets no map until 120th-Congress lines
  are loaded). The product never claims a map
  is current and does not track which states redrew.
* Race pages (other branch) need a different source of 2026 lines: owner decision.

## Real-data results (2026-10-20)

`DATABASE_URL= pnpm ingest all --db .pglite/live --migrate` ran all six sources (census last);
`pnpm ingest census-boundaries --db .pglite/live` then returned the same run (deduplicated).
After the Hawaii fit fix, `--force-replay` reloaded the same snapshot as run 8 (`replayOf: 6`).

| Counter (run 8) | Value |
|---|---|
| `shapes` rows written | 483 |
| `states` (outlines) | 54 (56 in the file; AS and MP left unmapped) |
| `districts` (numbered) | 429 (435 voting districts minus 6 at-large) |
| `whole_state_districts` (`00`/`98`, no own shape) | 10 (AK, DE, ND, SD, VT, WY; DC, PR, GU, VI) |
| `vertices_in` -> `vertices_out` | 791,487 -> 55,018 (rings dropped: 1,910) |
| `stale_shapes_deleted` | 0 |
| Duration | 12.5 s with the files on disk; 66 s with the two downloads on a loaded machine |

### Payload (path data, characters = bytes; all 483 shapes read back through `/api/v1`)

| | Largest | Median |
|---|---|---|
| State outline | 5,275 (AK); then LA 4,818, MD 4,809 | 1,917 |
| One district | 3,142 (MI-1); then ME-2 3,066, LA-1 2,980 | 402 |
| Profile of a House member (outline + district) | 7,798 (LA-1) | 2,672 |
| Profile of a Senator or at-large seat (outline only) | 5,275 (AK) | 1,917 |
| `districts.shape` JSON response (district) | 8,403 | 3,277 |

Rendered pages carry each path twice (HTML plus the Next flight payload), measured on the
running server: LA-1 (Scalise) 15,596 bytes of path data in the HTML, GA-10 5,738, MD-3
10,732, AK (Begich and Murkowski) 10,630, HI-1 1,142. Worst case is about 17 KB with the
figure markup, under the 20 KB target; the median House profile adds about 5.3 KB. (Gzip
shrinks path text further; not measured.)

### Screenshots and contact sheet

`C:\Users\user\Workspace\_worktrees\Civic_Ledger\_gate\district-maps\`:

* `contact-sheet-light.png`, `contact-sheet-dark.png`: 20 varied real shapes (GA-10, TX-23,
  CA-11, NY-12, MI-1, LA-6, MD-3, FL-27, WV-1, AK, HI-1, HI-2, VT, DC, PR, GU, VI, NV-4,
  IL-4, NC-1) drawn with the site's own CSS.
* `<member>-1440-light|dark.png`, `<member>-390-light|dark.png` (viewport) and
  `<member>-panel-light|dark.png` (Source records panel, 1440), `<member>-panel-390-*.png`
  (panel on a phone), for: `ga10-collins`, `ak-atlarge-begich`, `senator-murkowski`,
  `hi1-case`, `hi2-tokuda`, `delegate-pr`, `delegate-dc`, `delegate-gu`, `delegate-vi`,
  `la1-scalise`; and `delegate-as-nomap`, `delegate-mp-nomap` (no map, by design).
* Accessible names seen on the live pages: "Map of Georgia with congressional district 10
  highlighted"; "Map of Alaska with the whole state highlighted" (Begich, Murkowski); "Map of
  Hawaii with congressional district 1 / 2 highlighted"; "Map of Puerto Rico with the whole
  area highlighted" (also DC, Guam, U.S. Virgin Islands).
* Page width at 390 px equals the viewport (no sideways scroll) for GA-10, AK and HI-1 in
  both colour schemes.

## Verification (commands and results)

| Command | Result |
|---|---|
| `pnpm lint` (biome) | pass |
| `pnpm typecheck` | pass |
| `pnpm vitest run packages/ingest/test/census-boundaries.test.ts` | 28 tests pass |
| `pnpm test` (all workspaces, PGlite, no network) | 61 files, 543 tests pass (inside `pnpm check`) |
| `pnpm check` (lint, typecheck, test, build) | pass (exit 0) on the review-fix commit `ff2d536`: biome 343 files clean, typecheck, 543 tests, `next build` |
| `E2E_PORT=3340 E2E_SCALE_PORT=3341 pnpm --filter web test:e2e` | review-fix commit: 84 passed (82 desktop incl. `district-locator.spec.ts`, `design-system.spec.ts`, `a11y.spec.ts`, `shared-values.spec.ts`; 2 performance), 0 failed, no retries. (The earlier run on `65446ce` had one load-related Postgres fixture startup timeout in `shared-values.spec.ts`, which passed on a rerun of that spec.) |

Unit tests added: geometry and path formatting (round trip, collapsed rings), shapefile reading
from committed fixture zips, as-of parsing (and loud failure), vintage labels, viewBox and
finite-number sanity for every fixture state, simplification (4,001 vertices to under 120; within
1 px of the unsimplified outline), speck and hole handling, shared borders staying shared,
antimeridian state in one piece, high latitude, clockwise-ring repair, no sizing to far specks
(Hawaii case), at-large (`00`) and delegate (`98`) handling, unmapped territories, truncation
and wrong-Congress rejection, `ingest.run` end to end on PGlite (receipt, provenance,
dedupe, shrink guard refusal and `--allow-shrink`, decompression cap, missing metadata,
download via fake HTTP with retry-free 304 reuse and the sha256 manifest), and
`districts.shape@1` on PGlite (district, whole state, not found, bad input, every seeded path
inside its viewBox). Fixtures are synthetic (`packages/ingest/test/support/census-fixture.ts`
writes them; a test fails if the committed zips drift).

API/MCP parity: `apps/web/test/parity.test.ts` now covers `districts.shape` (direct dispatch,
HTTP and MCP deep-equal; error cases `invalid_input` and `not_found`);
`dispatch.test.ts` lists it among the public reads; `test-pg/capabilities.pgtest.ts` has cases for
real Postgres (not run here: see limitations). The e2e spec `district-locator.spec.ts` also
compares the page's `aria-label`, `viewBox`, `width`, `height` and both `d` attributes with the
`/api/v1/districts.shape` response.

e2e (`apps/web/e2e/district-locator.spec.ts`, fictional seed): House member map name; Senator
whole-state map; former member has none; neutral token colours (state `--surface-sunk` /
`--line-control`, highlight `--ink-2`, none equal to a party or vote token); reduced motion and no
layout shift (box identical at `domcontentloaded` and `networkidle`, no running animations,
`animation-name: none`); axe WCAG 2.2 AA in light and dark for a House and a Senate profile;
390 px width, aspect ratio and order (identity, map, section nav). `design-system.spec.ts` and
`a11y.spec.ts` (which load `/people/avery-ashvale`, now with a map) pass.

## Standard gates (AGENT_NATIVE_HUMAN_USABLE_STANDARD)

| Gate | Result | Evidence |
|---|---|---|
| 1 Shared capabilities | PASS (local) | The profile calls `districts.shape@1` through `read()` (registry dispatch); `/api/v1` and MCP use the same registry. `parity.test.ts` and the e2e comparison above. |
| 2 Shared state | PASS (local) | One `district_map` table; UI, API and MCP read it. The live profile pages and `/api/v1/districts.shape` agree (descriptions and paths compared in e2e on the seed; descriptions checked on the real data above). |
| 3 Scoped authority | PASS (local) | Anonymous public read only, strict input, no write path; `ingest.run` stays operator-only and not exposed (existing registry test lists `districts.shape` as the only addition). |
| 4 Human usability | PASS (local) | Map has `role="img"` with an exact name, a text caption with publisher, vintage and as-of date, works without JavaScript, no hover or animation, axe clean in both schemes, 390 px checked. |
| 5-7 Supervision, recovery, receipts | NOT APPLICABLE for the read feature; the ingest write path uses the existing run ledger (receipt, lock, atomic transaction, shrink guard), exercised above. | |

## Limitations and open items

* Vintage: see above; not current for states that redrew after 2024-05-31. The product does not
  know which; the caption says so for every map.
* AS and MP delegates show no map (specks at 240 px); DC, PR, GU and VI are drawn.
  VI and Guam outlines are small and plain at this size.
* The far northwestern Hawaiian islands specks are not drawn (they would shrink the main islands);
  Alaska keeps its Aleutian islands that are visible at map size (the chain crosses the antimeridian and draws in one piece), and drops the sub-pixel ones.
* HI-1 (Honolulu) is a small highlight on Oahu at map size, true to the geography.
* The Postgres 17 suite (`pnpm test:pg`) was not run in this task (embedded Postgres under the
  shared load already timed out once in e2e); the `districts.shape` cases were added to it.
* `shapefile` and `topojson-*` have had no release since 2022; `text-encoding` (a `shapefile`
  dependency, Unlicense) is deprecated upstream. All are ingest-only. Replacing the DBF reader
  is a small follow-up if the deprecation matters.
* Migration `0006` collides in number with another branch's `0006`; the integrator renumbers one
  (both are expand-only). DECISIONS IDs A75-A79 may collide the same way.
* Owner decisions: source of 2026 district lines for race pages; whether to track redrawn
  states explicitly; whether delegates for AS/MP should get a different treatment (an inset or a
  labelled text-only state).
