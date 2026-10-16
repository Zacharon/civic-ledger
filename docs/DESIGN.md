# Design system: Civic Ledger

Read this before any visual or UI decision in `apps/web`. Deviations need an entry in
the decisions log at the bottom. Tokens live in `apps/web/app/globals.css`; components
use tokens, never literal values.

## Product context

- **What:** a non-partisan public record of U.S. officeholders: campaign money, roll-call
  votes, independent scores, promises and platforms in one sortable table. Every number
  links to its source.
- **For:** curious voters, reporters on deadline, researchers, and agents using the same
  capabilities through `/api/v1` and MCP.
- **Peers:** newspaper data desks (graphics and elections teams), Voteview, FEC.gov,
  GovTrack. We want the clarity of the first and the rigor of the rest.
- **Type:** editorial data product. Dense where it pays (Explore, Compare), calm and
  readable everywhere else.

## Aesthetic direction: "the public ledger"

A bookkeeper's ledger set by a newspaper's data desk. Warm paper, near-black ink,
hairline rules, tabular figures, one ink-green accent taken from ledger paper. The
interface should feel like a printed record that happens to be interactive: it states
facts, cites them, and does not editorialize.

- **Decoration:** minimal. Rules and footnotes are the only ornaments, and both carry
  meaning.
- **Signature element: the double rule and the source mark.** Totals sit on an
  accountant's double rule (`.rule-total`), the one convention every ledger shares.
  Sourced numbers carry a small superscript source mark (`¹`, `²`) linking to the
  section's numbered **Sources** list. Nothing else on the page is allowed to be loud.
- **Risk taken:** a serif display face on a data product, and no party color in the
  page chrome at all. The serif signals "record of fact", not "dashboard"; withholding
  color keeps the page from reading as red-vs-blue.

## Typography

| Role | Face | Notes |
|---|---|---|
| Display (h1, h2, profile names) | **Newsreader** variable (opsz 6–72, wght 200–800) | Designed for news reading; optical sizing keeps large headings refined. Never for numbers in tables. |
| UI, body, data | **Instrument Sans** variable (wght 400–700) | Crisp grotesque with proportional figures for prose and a `tnum` set whose comma and period stay narrow, so tabular money columns read as numbers, not code. |

- Self-hosted from `@fontsource-variable/*` through `next/font/local` (no CDN, no runtime
  fetch), `display: swap`, metric-adjusted fallbacks to avoid layout shift.
- Scale (ratio 1.25, base 16px): `xs 12` · `sm 14` · `base 16` · `lg 20` · `xl 25` ·
  `2xl 31` · `3xl 39` · `4xl 49`. Table cells are `sm` (14px); captions `xs` only for
  source marks and axis ticks.
- Line height 1.5 body, 1.15 display. Measure 60–72ch for prose. `text-wrap: balance` on
  headings. Display weight 500, body 400, emphasis 600. No letterspacing on lowercase.
- `.num` = `font-variant-numeric: tabular-nums lining-nums` on every number that aligns
  (tables, axes, stat rows). Standalone hero figures use proportional figures.

## Color

Restrained: neutrals plus one accent. Warm greys only (no cool greys anywhere).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#F5F3EE` | `#141311` | Page background |
| `--surface` | `#FCFBF8` | `#1C1B18` | Tables, panels, inputs |
| `--surface-sunk` | `#EEEBE4` | `#24221F` | Header rows, neutral chips, tracks |
| `--ink` | `#1C1B18` (15.5:1) | `#EDE9E0` (15.3:1) | Primary text |
| `--ink-2` | `#4D4A43` (8.0:1) | `#BDB7AA` (9.3:1) | Secondary text |
| `--ink-3` | `#6B675D` (5.1:1) | `#9A9487` (6.2:1) | Muted text, captions (still AA) |
| `--rule` | `#D9D4C8` | `#34312C` | Hairlines (decorative separation only) |
| `--line-control` | `#8A8478` (3.4:1) | `#787266` (3.6:1) | Input borders, chart axes (non-text 3:1) |
| `--accent` | `#1D6B50` (5.8:1) | `#74C2A0` (8.8:1) | Links, focus ring, selected state, primary button |
| `--accent-wash` | `#E2EDE6` | `#1F3229` | Selected row/chip background |
| `--bar` | `#8B8577` | `#8E887B` | Neutral data bars (shares, rates, meters) |

- The accent is **ledger green**: not red, not blue, no party meaning. It marks
  interaction only, never "good".
- **Party chips** are the only place party color appears: small, muted tint with the
  party name or abbreviation always in text. Known U.S. parties map to a muted tone
  (`democratic` blue-grey, `republican` brick-grey); every other party, including
  Independent, uses the neutral chip. All chip pairs are ≥ 7.8:1.
- No red/green good-bad coding anywhere. Promise statuses use icon + label in ink.
- Dark mode is designed, not inverted: surfaces step lighter with elevation, the accent is
  lightened for contrast, data colors use their own validated dark steps. The theme
  follows `prefers-color-scheme`; there is no toggle (both modes keep the identity).

## Data visualization

Hand-rolled SVG and HTML, server-rendered, no chart library (each chart is a few dozen
lines; a library would add client JS for no capability we need). Every chart:

1. Has a title that states what it shows, plus subtitle with **source and as-of date**.
2. Has a table twin or labels carrying every value (no tooltip-only values).
3. Uses `role="img"` + `aria-label` stating the key fact, or is a labeled HTML list.
4. Starts bars at zero; uses 1px solid axes in `--line-control`; thin marks (≤ 12px
   inline, ≤ 20px in charts) with 2px surface gaps between stacked segments.

Palettes (validated with the dataviz validator, OKLab ΔE, both modes):

| Slot | Light | Dark | Used for |
|---|---|---|---|
| 1 | `#0E7F5A` | `#2F9470` | Small-dollar individual gifts |
| 2 | `#B07F12` | `#B5841A` | Larger individual gifts |
| 3 | `#8A4A93` | `#A06CB2` | PACs and other committees |
| 4 | `#B5651D` | `#C9773A` | Party and the candidate's own money |
| other | `#A39E92` | `#5E5A52` | Unattributed / not coded (neutral by design) |

Light: worst adjacent CVD ΔE 9.0, normal-vision 18.6, all ≥ 3:1 on `--surface`.
Dark: worst adjacent CVD ΔE 8.9, normal-vision 16.5, all ≥ 3:1 on dark `--surface`.

**Neutrality rules for charts** (acceptance criteria, ARCHITECTURE §1, §6):

- Ideology is shown by **position, never color**: an ink dot on a hairline axis with
  labeled poles exactly as the method defines them, e.g. DW-NOMINATE: "← more liberal ·
  more conservative →", with the method named ("DW-NOMINATE, academic, roll-call based").
- Scatter plots of members use one neutral ink for everyone; the person of interest gets
  a ring and a label, never a party color.
- Scorecards are drawn on the publisher's own scale with the publisher's name,
  self-described orientation, year and methodology link beside the number. No color.
- Shares (PAC share, small-dollar share, missed votes, kept rate) use the neutral `--bar`
  on a `--surface-sunk` track.
- Missing data is never zero: tables print **No data**; industry coding prints **Not
  coded** with its dollar share; unrated promises print **Not yet rated**.

## Spacing, layout, shape

- Base unit 4px. Scale: `1 4` · `2 8` · `3 12` · `4 16` · `6 24` · `8 32` · `12 48` ·
  `16 64` (Tailwind defaults on a 4px grid; no arbitrary values).
- Containers: reading pages `max-w-5xl` (1024px); Explore and Compare go to `max-w-[1440px]`
  with 24px gutters (16px under 640px).
- **Shape lock:** controls, chips and buttons `4px` radius; panels `6px`; tables and
  charts square. Elevation is a hairline border; the only shadow is a soft ink-tinted
  one on popovers (the column picker), plus edge shadows that appear on wide tables
  only when more columns are scrolled out of view (`.scroll-cue`).
- Breakpoints: Tailwind defaults. Every multi-column layout collapses below `md` (768px);
  Explore swaps its table for cards below `md`.
- Z-index scale (only these): `sticky cells 1`, `sticky header 2`, `site header 10`,
  `popover 20`, `skip link 30`.

## Motion

Minimal-functional. Two motions exist: 120–150ms color/opacity transitions on
interactive elements, and a 150ms opacity dim on the Explore results while a server
update is pending (the previous table stays readable; no skeleton flash).
`prefers-reduced-motion: reduce` removes both. Nothing animates on load.

## Data-dense primitives

Explore renders up to 100 rows × ~15 cells twice (table and mobile cards) plus the RSC
payload, so repeated cells use short CSS classes (`.xt-cell`, `.chip`, `.share`, `.pos`,
`.nodata` in `globals.css`) and meters are drawn with CSS from one custom property
(`style="--v:27%"`) instead of inline SVG. This halved the page weight and keeps LCP
under 2 s with 600 members.

## Components

| Component | File | Notes |
|---|---|---|
| Site header / footer | `src/components/site-header.tsx`, `site-footer.tsx` | Wordmark on a double rule; one-line nav ≥ 1024px, wraps to a scroll row below. Footer carries data freshness. |
| Skip link | `apps/web/app/layout.tsx` | First focusable element; jumps to `#main`. |
| Party chip | `components/party-chip.tsx` | Tint + text, title shows full party name. |
| No data | `components/no-data.tsx` | Explicit "No data" / "Not coded" text in `--ink-3`. |
| Source mark + Sources list | `components/sources.tsx` | Numbered marks and the per-section footnote list (source, record key, retrieved date, run id). |
| Share bar | `components/charts/share-bar.tsx` | Inline 0–100% meter + tabular label (`.share`). |
| Position strip | `components/charts/position-strip.tsx` | Neutral ideology axis (`.pos`); poles labeled by the caller. |
| Receipts stack | `components/charts/receipts-stack.tsx` | Stacked part-to-whole bar + legend table. |
| Bar list | `components/charts/bar-list.tsx` | Ranked horizontal bars (industries, outside spending). |
| Member scatter | `components/charts/member-scatter.tsx` | DW-NOMINATE dim1 × dim2, neutral dots, focus ring. |
| Career timeline | `components/charts/career-timeline.tsx` | Terms as bars, campaigns as marks on a year axis. |
| Explore table / cards | `components/explore/*` | Sticky header + first column, `aria-sort`, URL state. |
| Filters, column picker, sort select | `components/explore/*` (client) | nuqs URL state, server re-render on change. |
| Framework builder | `components/frameworks/*` (client) | Spec lives in the URL. |
| Tally bar | `components/charts/tally-bar.tsx` | Yea / nay / present / not voting, counts printed. |
| Scroll region | `components/scroll-region.tsx` | Named, focusable wrapper for wide tables. |
| Pagination | `components/pagination.tsx` | Links, work without JavaScript. |

Component paths are relative to `apps/web/src/`.

States: every data component renders loading (route `loading.tsx`), empty (explains what
is missing and offers the next action), error (`error.tsx`, says what failed, offers
retry) and populated.

## Voice and microcopy

- **Plain, exact, neutral.** Say what the number is and where it came from. Never
  characterize a person ("top fundraiser", "extreme"). Describe methods, not motives.
- Sentence case everywhere. Numbers with units: `$1.2M`, `34%`, `12 of 15`.
- Name controls by what they do: "Show columns", "Clear filters", "Compare", "Evaluate".
- Errors state what happened and what to do: "That page of results does not exist. Go
  to page 1."
- Empty states invite the next step: "No members match these filters. Clear filters".
- Terminology: **member** (not politician) for officeholders; **roll call** (two words)
  in prose, `rollcall` only in code; **outside spending** (not "dark money"); **PACs and
  other committees** (FEC's own grouping); **framework** for user or curated alignment
  rule sets, always paired with "one framework's view, not a neutral score".

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-10-16 | Newsreader + Instrument Sans, self-hosted via next/font/local | Libre Franklin's build has no `tnum`; Schibsted Grotesk's `tnum` widens commas and periods to figure width (`$1 ,154 ,000`), seen in the first screenshots. Instrument Sans keeps punctuation narrow. |
| 2026-10-16 | Ledger green accent `#1D6B50` | Not red or blue; ties to ledger paper; AA on paper in both modes. |
| 2026-10-16 | No theme toggle; follow the OS | Both modes keep the identity; avoids client JS and a flash of wrong theme. |
| 2026-10-16 | Hand-rolled SVG charts, no chart library | Server-rendered, zero client JS, full control over neutrality rules. |
| 2026-10-16 | Server-rendered table, TanStack Table removed | Sort and paging are server-side (`explore.table`); column visibility is URL state; a client table model would add JS without capability. |
