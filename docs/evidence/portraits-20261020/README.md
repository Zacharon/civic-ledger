# Official portraits on member records

Branch `claude/portraits-20261020` (based on `fda8c59`). Local implementation and verification
evidence only: nothing is pushed, merged or deployed. Decisions: DECISIONS A81-A85.

## What it does

* **Self-hosted images.** New ingest source `member-photos` downloads the public-domain official photos
  (mainly the GPO Member Guide, republished by `unitedstates/images`) into table `person_portrait`
  (migration `0006_person_portraits`, one file), with embedded metadata removed and every download
  verified against its git blob SHA-1. Readers' browsers only ever request our own origin
  (CSP `img-src 'self' data: blob:` is unchanged).
* **One capability, three adapters.** `people.get` gains `portrait` (`url`, `width`, `height`, `credit`,
  `sourceUrl`, `asOf`, `variants[]`, `provenance`, or `null`). New public binary read `people.portrait@1`
  (`Capability.transport = 'binary'`): `/api/v1/people.portrait` sends `image/jpeg` with `ETag` = sha256,
  `304`, `nosniff`; MCP tool `people_portrait` returns an image block plus metadata;
  `/people/<slug>/portrait?size=225|450&v=<key>` forwards to the same handler.
* **Display.** `MemberPortrait` in the member profile header: 4:5 frame (168 px, 104 px on phones), credit
  line "Official portrait · public domain · via unitedstates/images" with a source mark, alt text
  "Official portrait of {name}", 1x/2x `srcset`, explicit `width`/`height`. Without a portrait: a same-size
  tile reading "No official portrait on file". Never on race pages (DESIGN.md "Portraits").
* **Seed.** The fictional seed gets flat grey synthetic JPEGs (no face, no real photo) for most members and
  none for every fourth (`dana-dunmere` is the e2e member without one).

## Real-data result (2026-10-20, `.pglite/live`)

Command: `DATABASE_URL= pnpm ingest all --db .pglite/live --migrate`, then `pnpm ingest member-photos --db .pglite/live`
(rerun after two rule changes, see below).

| Measure | Value |
|---|---|
| People in scope (Bioguide id, term ending after 2025-01-03) | 555 |
| People with a portrait | **539** (1,078 files, 225x275 + 450x550) |
| Bytes stored | **105,855,819** (100.9 MiB), from 117,303,947 downloaded |
| Metadata removed | 11,448,128 bytes (9.8%): 508 files had EXIF/XMP, 484 Photoshop (APP13), 4 comments, **386 an embedded thumbnail, 0 GPS**. Decoded pixels identical for all 1,078 (PIL comparison), no `Exif` / XMP / `Photoshop` text left |
| Verification | all 1,078 files hashed to the git blob SHA-1 in the listing; tree `aec3e4a88af843b282c0576f420b930f6a9a46ad` is in the run receipt |
| Current members with a portrait | **524 of 539** (checked through `/people/<slug>/portrait` for every current member; the 15 without are exactly the 15 newest members; 523 before the CMYK file was accepted) |
| Files rejected on the final run | 0 |
| In scope without a portrait | 16 (the 15 newest current members B001323 G000606 G000607 W000832 B001328 F000485 B001321 B001324 M001246 H001104 A000383 G000608 V000139 M001245 W000831, plus one former member) |
| Duration | first load ~12 min (10 min download, 2 min store); rerun with all 304s 4 min 12 s. Measured while three other agents were building and ingesting on the same PC, so upper bounds |

Findings that changed the code (the first live run rejected 74 files):

1. **Upstream fits photos to the box, it does not force the size.** 73 pairs failed an exact 225x275 / 450x550
   check: files are 220x275, 183x275, 205x275, 225x150, 225x225 ..., and 15 files in `450x550/` are the 225x275
   original (not enlarged). The rule is now "complete JPEG inside the variant's box, at least 20% of its area",
   and the frame uses `object-fit: contain` so no official photo is cropped.
2. **One file pair is a progressive CMYK JPEG** (`L000585`). Chromium renders it correctly (checked), so
   4-component files are accepted. This is the 524th current-member portrait the brief expected.
3. **Windows rename race.** Six parallel downloads hit `EPERM` renaming the validator cache; the rename now
   retries (test: 48 parallel downloads).

Pages checked on the live DB, served as a production build on port 3322:

| Page | Result |
|---|---|
| `/people/jon-ossoff-o000174` | portrait present (220x275 file), no foreign requests |
| `/people/lisa-murkowski-m001153` | portrait present (225x275 file), no foreign requests |
| `/people/nicholas-j-begich-iii-b001323` (no photo) | neutral tile, same 168x210 frame |
| `/people/<slug>/portrait` | `200 image/jpeg`, `etag` = sha256, `nosniff`, `immutable` with the page's `v`, `304` on `If-None-Match`, `404` for an unknown slug and for a member without a portrait |

Screenshots (1440 and 390 px, light and dark, the three members above):
`C:\Users\zacha\Workspace\_worktrees\Civic_Ledger\_gate\portraits\`.

## Gates (AGENT_NATIVE_HUMAN_USABLE_STANDARD, 1-4; 5-7 do not apply: the reads write no user data and have no external effect)

| Gate | Evidence |
|---|---|
| 1 Shared capability | The profile, `/api/v1/people.portrait` and MCP `people_portrait` all dispatch `people.portrait@1`; the web route forwards to the API handler. `apps/web/test/parity.test.ts` "binary capabilities": bytes equal through dispatch, HTTP and MCP at 225 and 450; `people.get` facts equal in all three, including `portrait: null`. |
| 2 Shared state | The header image address comes from `people.get`; `e2e/support/supplemental-values.ts` `checkPortrait` (run by `shared-values.spec.ts` on Postgres) compares the page with HTTP and MCP values. |
| 3 Scoped authority | Public read only; no write tool. `people.portrait` input is strict; the cache key `v` cannot select a file and only earns `immutable` when it prefixes the served sha256 (`portrait-http.test.ts`). |
| 4 Human usability | Alt text, visible credit and placeholder text, axe in light and dark on a member with and one without a portrait, 390 px reflow and no sideways scroll (`e2e/portraits.spec.ts`, `a11y.spec.ts`, `design-system.spec.ts`). |

## Tests added or changed

* `packages/db/test/seed.test.ts`: seed portraits (flat grey, with and without).
* `packages/core/test/portraits.test.ts`: capability on PGlite (facts, credit, provenance, null, bytes + sha256,
  not_found, invalid input).
* `packages/ingest/test/member-photos.test.ts` (18 tests): JPEG validation, non-JPEG / truncated / empty
  rejected, box rule, listing parsing and truncation, missing file (404) fails the run, per-file and total caps,
  sha256 and bytes stored equal to the file, provenance, idempotent rerun, 304 reuse, keep-previous on a corrupt
  download, shrink guard refusal and `--allow-shrink`. Committed synthetic fixtures under
  `packages/ingest/test/fixtures/member-photos/` (regenerate with `make-fixtures.ts`).
* `packages/ingest/test/http.test.ts`: 48 parallel downloads share one cache file.
* `apps/web/test/portrait-http.test.ts`, `parity.test.ts`, `handler.test.ts`, `openapi.test.ts`.
* `apps/web/e2e/portraits.spec.ts` plus portrait checks in `a11y.spec.ts`, `design-system.spec.ts` and
  `shared-values.spec.ts`.

## Verification runs

| Command | Result |
|---|---|
| `pnpm check` (lint, typecheck, test, build) | pass: 61 test files, 525 tests, build ok (run at `f5ba88d`, before the small Postgres-test and byte-view fix below) |
| `pnpm test:pg` (embedded Postgres 17) | pass: 9 files, 71 tests, after adding `people.portrait` to `capabilities.pgtest.ts` (bytes equal on Postgres, PGlite and over HTTP) and `readonly-credentials.pgtest.ts`; the first run failed on exactly those two tests |
| `E2E_PORT=3320 E2E_SCALE_PORT=3321 pnpm --filter @civic-ledger/web test:e2e` | pass: 87 tests including `portraits.spec.ts`, `a11y.spec.ts`, `design-system.spec.ts`, `shared-values.spec.ts` and the performance project. An earlier run had one timeout in `shared-values.spec.ts:357` under machine load (other agents building); that test alone passed on rerun and the later full run passed clean |
| `pnpm lint`, `pnpm typecheck` after the last edit | pass |
| `packages/core/test/portraits.test.ts`, `apps/web/test/{parity,portrait-http}.test.ts`, `packages/mcp` after the last edit | pass (82 tests) |

## Limits and open points

* Credit wording was changed after review: upstream credits some files to other official sources (for
  example O000172 to the House Office of Photography), so the line now names the collection ("via
  unitedstates/images"), and DATA_SOURCES names the GPO Member Guide as its main origin.
* Embedded metadata is removed on load (no re-encoding); the downloaded file's sha256 and size stay in
  `origin_sha256` / `origin_byte_length`. The ICC profile and the Adobe segment (needed by the CMYK file)
  are kept.
* ~117 MB of image bytes now live in the database and in every backup. Widening to all former members
  would add ~250 MB.
* Not built: portraits on Compare headers (optional in the brief).
* Migration number 0006 may collide with another branch; the integrator renumbers (one file here).
* Hosted behaviour (CDN caching of the immutable files, Render Postgres size and backup time) is not tested.
