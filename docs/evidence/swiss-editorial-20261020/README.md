# Swiss × Editorial restyle: local verification (2026-10-20)

Branch `claude/swiss-editorial-20261020`, based on `main` 8f4a092. Local evidence only:
nothing was pushed, merged, deployed or run against production data. All runs use the
fictional seed in throwaway PGlite databases.

## Scope

Behavior-preserving restyle of every existing route to the approved concept
(`combined-swiss-editorial-20261020`). Routes present and restyled: `/`, `/explore`,
`/people/[slug]`, `/compare`, `/policy`, `/policy/[area]`, `/frameworks`, `/sources`,
`/methodology`, not-found, error. No bill page, saved items, accounts or summaries
exist in the product, and none were added. The concept's fictional records, counts and
"Save bill" control were not copied.

Data meaning changes (both presentational, both required by the owner rule):

- `TallyBar` no longer colors Yea amber and Nay purple (money palette). It now uses
  `--vote-*` tokens: teal Yea, amber Nay, hatched grey Present, grey Not voting. Every
  count and the denominator are printed.
- The policy page party table no longer sums Present and Not voting into "Other"; they
  are two columns. The parity test (`e2e/support/supplemental-values.ts`) now compares
  each against the HTTP/MCP value instead of their sum.

Agent parity (feature standard gates 1–4): no capability, endpoint, schema or URL
changed. The new masthead search is an ordinary `GET /explore?q=` form, the same
`explore.table` name filter as the Home search box, `/api/v1/explore.table?q=` and MCP
`explore_table`. Gates 5–7 do not apply: no user data is written and there are no
external effects.

## Commands and results

| Command | Tree | Result |
|---|---|---|
| `pnpm check` | baseline `main` | lint and typecheck passed; `pnpm test` 465/466, 1 failure: `packages/ingest/test/publication.test.ts` process-loss test timed out at 120 s while a parallel install was running; build not reached (`&&` chain) |
| `pnpm build` | baseline `main` | passed |
| `pnpm test` | restyle | 58 files, 482/482 passed (includes the baseline timeout test) |
| `pnpm check` | restyle, final | passed: Biome 327 files clean, typecheck, 482/482 tests, build |
| `pnpm --filter @civic-ledger/web test:e2e` | restyle, first run | 66 passed, 1 failed (the merged-"Other" parity assertion above), 6 performance tests not run (they depend on desktop) |
| `pnpm --filter @civic-ledger/web test:e2e` | restyle, final | **73/73 passed** (desktop functional, axe WCAG 2.2 AA light and dark and 390px, keyboard, performance budget) |
| `playwright test --project=screenshots` | restyle, final | 24/24; committed set under `apps/web/screenshots/` regenerated |
| Mutation check: `--vote-yea` set to blue `#2e5fa8`, `--vote-nay` to red `#b0302c` | restyle | `test/vote-semantics.test.ts` failed as intended; values restored |

New regression coverage:

- `apps/web/test/vote-semantics.test.ts` (16 tests): vote tokens are not red or blue in
  either mode, Yea is teal and Nay is amber, Present and Not voting stay neutral, no vote
  token equals a party token, `.vote-*` classes paint only from `--vote-*`, vote
  components never reference party or money-palette classes, and `summarizeTally`
  covers the denominator, tiny categories (never inflated), zero totals, unanimous votes,
  malformed counts and distinct labels.
- `apps/web/e2e/design-system.spec.ts` (15 tests): no page-level horizontal overflow
  on 9 routes at 320, 390, 720 (a 1440 window at 200% zoom), 768, 1024 and 1440 px; the
  masthead search works on a phone; profile reading order is identity, then source
  records, then sections; source records link to real identifiers and hold the header
  footnotes; meter segments, legend counts and the stated denominator agree; vote fills
  resolve to the vote tokens and never to party colors.

## Screenshots

- Committed (repo convention): `apps/web/screenshots/*-{desktop,mobile}-{light,dark}.png`,
  1440 and 390 px.
- Full before/after sets (not committed, about 140 PNGs):
  `Workspace/_worktrees/Civic_Ledger/_gate/swiss/{before,after}/<route>-<width>-<scheme>.png`
  for 10 routes at 320/390/768/1024/1440 light plus 390/1440 dark, each with
  `overflow.json`. Side-by-side sheets: `_gate/swiss/compare-*.png`.
- Document overflow: baseline 1 of 70 captures (Home at 320 px, preview table); restyle
  0 of 70.

## Accessibility, responsive and data-integrity findings

- axe WCAG 2.2 AA tags: no violations on 13 routes/states in light and dark, plus three
  routes at 390 px. Automated scans do not establish full WCAG conformance; screen reader
  passes were not run.
- Contrast was measured on the shipped tokens (DESIGN.md tables). The lowest text pairs
  are `--ink-3` on sunk at 5.2:1 and the accent on accent-wash at 5.1:1. Vote fills are
  at least 3.27:1 on paper, surface and sunk; amber and grey are never used for text.
  Present (2.4:1) is told apart by its hatch and printed label, not by contrast.
- An independent read-only review found: the stale parity assertion (fixed); focus
  outlines clipped in the scrolling section nav, with the last link inside the fade on
  phones (fixed with inset focus outlines and end padding on both scrolling navs);
  `aside` nested in `main` (now a named `section` region); the old ink value in the
  scroll-cue shadow (updated). Documented, not changed: the money palette's green and
  amber sit near the Yea and Nay colors in a separate, labeled chart.
- Keyboard: the existing keyboard specs pass. The masthead is no longer sticky, so no
  sticky element can cover focus.

## Limitations

- Concept fidelity was judged against the local PNGs and `concept.css`. The private
  ChatGPT page was not opened.
- The concept's bill record page has no product equivalent. The record treatment (8/4
  grid, evidence panel, vote meter) is applied to the member profile and policy-area
  roll-call pages. The in-progress `claude/bill-pages-20261019` branch will need the same
  primitives when it ships UI.
- Other open branches touch `apps/web` (Sources page, policy matrix). Expect textual
  merge conflicts in class names and headings there; the tokens and primitives are
  additive.
