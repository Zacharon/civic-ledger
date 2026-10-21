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

Since 2026-10-20 the ledger is set in a **Swiss x Editorial** structure (approved concept
`combined-swiss-editorial-20261020`): one 1280px frame shared by masthead and content,
a 2px ink masthead rule, open sections divided by 2px ink and 1px hairline rules, square
corners, no shadows, the serif reserved for the wordmark and page / record titles, and
real source records near the top of each record. The concept's fictional records,
sample counts and inert controls (for example "Save bill") are not product behavior.

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
| Display: wordmark, page and record titles (`.wordmark`, `.page-title`), quoted statements | **Newsreader** variable (opsz 6–72, wght 200–800) | Designed for news reading; optical sizing keeps large headings refined. Never for numbers in tables. |
| UI, body, data | **Instrument Sans** variable (wght 400–700) | Crisp grotesque with proportional figures for prose and a `tnum` set whose comma and period stay narrow, so tabular money columns read as numbers, not code. |

- Self-hosted from `@fontsource-variable/*` through `next/font/local` (no CDN, no runtime
  fetch), `display: swap`, metric-adjusted fallbacks to avoid layout shift.
- Scale (ratio 1.25, base 16px): `xs 12` · `sm 14` · `base 16` · `lg 20` · `xl 25` ·
  `2xl 31` · `3xl 39` · `4xl 49`. Table cells are `sm` (14px); captions `xs` only for
  source marks and axis ticks.
- Roles: `.wordmark` 28/31px serif 500; `.page-title` 36px phone / 49px from 768px, serif
  500, 1.08; `.section-title` 22/24px **sans** 600 (section headings navigate the record,
  they are not display); `.subsection-title` 20px sans 600; `.lede` 19/20px, 1.55.
- Line height 1.5 body, 1.15 display. Measure 60–72ch for prose. `text-wrap: balance` on
  headings. Display weight 500, body 400, emphasis 600. No letterspacing on lowercase.
- `.num` = `font-variant-numeric: tabular-nums lining-nums` on every number that aligns
  (tables, axes, stat rows). Standalone hero figures use proportional figures.

## Color

Restrained: neutrals plus one accent. Warm greys only (no cool greys anywhere).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#F7F5EF` | `#121412` | Page background |
| `--surface` | `#FFFDF8` | `#1A1D1A` | Tables, panels, inputs |
| `--surface-sunk` | `#EEEDE6` | `#242823` | Header rows, neutral chips, tracks |
| `--ink` | `#20251F` (14.3:1) | `#E8EBE3` (15.4:1) | Primary text, 2px rules |
| `--ink-2` | `#4B5249` (7.4:1) | `#BAC0B5` (10.0:1) | Secondary text |
| `--ink-3` | `#5D645A` (5.6:1; 5.1:1 on sunk) | `#9CA397` (7.1:1) | Muted text, captions (still AA) |
| `--rule` | `#C6CBBF` | `#333832` | Hairlines (decorative separation only) |
| `--line-control` | `#80877C` (3.4:1) | `#747C71` (4.3:1) | Input borders, chart axes (non-text 3:1) |
| `--accent` | `#086F63` (5.6:1) | `#6CC2B1` (8.8:1) | Links, focus ring, selected state, primary button |
| `--accent-wash` | `#E5EDE4` | `#1B2F2A` | Selected row/chip background |
| `--bar` | `#80877C` | `#8A9086` | Neutral data bars (shares, rates, meters) |
| `--status-ink` / `-bg` / `-border` | `#234F42` on `#E9EEE5` (7.9:1) / `#B8C6B6` | `#A8D5C6` on `#1B2F2A` (8.7:1) / `#3B5A50` | Record status pill (`.record-status`): a record's state, never a vote outcome |

- The accent is **ledger teal**: not red, not blue, no party meaning. It marks
  interaction only, never "good". It shares its light value with `--vote-yea` (as the
  approved concept did), but the tokens are separate, and a selected Nay choice in the
  framework builder is filled ink, not accent, so selection never reads as Yea.
- **Three separate semantic families** that never borrow from each other: `--vote-*`
  (roll-call positions), `--party-*` (party chips) and `--status-*` (record status).
  Generic success/error is not mapped to Yea/Nay. `test/vote-semantics.test.ts` enforces
  the separation and the no-red/no-blue vote rule in both modes.
- **Party chips** are the only place party color appears, with one owner-approved
  exception (below, the chamber seat chart): small, muted tint with the
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

**Vote positions** (owner rule: red and blue are reserved for party identification and
never encode a vote; `src/lib/vote.ts` is the only mapping):

| Token | Light | Dark | Position | Shape |
|---|---|---|---|---|
| `--vote-yea` | `#086F63` (5.6:1 on paper) | `#3AA392` (6.0:1) | Yea | solid |
| `--vote-nay` | `#AF7718` (3.5:1) | `#C4902F` (6.5:1) | Nay | solid |
| `--vote-present` | `#A3A89C` with a `--vote-not-voting` hatch | `#5E645B` with hatch | Present | hatched |
| `--vote-not-voting` | `#777D74` (3.9:1) | `#8A9086` (5.7:1) | Not voting | solid |

- **How each party voted** (`PartyBreakdown`, per roll call on the policy page and in the
  member votes table): one row per party actually present, the party as plain text, its four
  counts (Yea, Nay, Present, Not voting; never merged), a small `vote-meter-xs` in the vote
  colors, and a total row proving the party rows add up to the roll call. Party color never
  fills a vote segment and no party chip is drawn there. Party = the member's party on the
  vote date (their term then); the UI says so, and a position with no party on file is its
  own labelled row. Open on wide screens, folded behind a 44px "How each party voted"
  disclosure on phones after hydration (native `<details>`, so it works without script); in
  the member votes table it is a compact counts-only version (one text line per party and an
  "All parties" line, no meter, no client component) folded per row at every width, to keep
  the profile light (20 rows per page); every number of the full table is in those lines.
- **Attendance by month** (`AttendanceStrip`, member profile): one cell per month of the
  Congress. A served month states its denominator ("Of N eligible votes"), draws the missed
  share as the `--vote-not-voting` grey on a sunk track, and prints Not voting and Present
  (hatched key) counts. "No votes held" is a dashed outline, "Not yet serving" / "No longer
  serving" a sunk fill, "No record on file" a dotted outline; none of them is drawn as a zero.
  Greys only: no red, no party color, no Yea or Nay color. Cell state is visible text (no
  colour-only cue), and the same numbers, plus roll calls held, sit in a table behind a
  keyboard-reachable disclosure.
- Known overlap: the money palette's slot 1 green and slot 2 amber sit near Yea and Nay.
  They are separate, labeled charts in different sections (Money vs Votes) and neither is
  red or blue; retuning the validated money palette is a separate decision.
- Fills only. Amber and grey are below 4.5:1, so vote labels and counts are always ink
  text beside a key (`.vote-key`), never colored text.
- Present and Not voting are distinct official positions: separate counts, columns,
  keys and labels everywhere (the policy party table no longer folds them into "Other").
  "No record" (no position on file) and "Not a member at the time" also stay separate.
- `TallyBar` and its legend come from one `summarizeTally()`: every category's count is
  printed, the denominator is stated ("Of N recorded positions"), zero totals render a
  sentence instead of a meter, and tiny categories are never inflated.
Dark: worst adjacent CVD ΔE 8.9, normal-vision 16.5, all ≥ 3:1 on dark `--surface`.

**Chamber seat chart** (home, "Who serves now"; `SeatChart`): the one chart where party color
fills a mark, approved by the owner on 2026-10-20 for this chart only. A waffle, not a
hemicycle: a Swiss grid of squares (House 29 x 15 = 435, Senate 10 x 10 = 100), one square per
voting member, filled left to right and row by row. Democrat and Republican squares use the
chip inks (`--party-dem-ink`, `--party-rep-ink`) at 70% over the surface so large areas stay
muted (3:1 or better on the surface in both modes, tested). Independent is neutral `--bar`
grey; every other party is a neutral pattern (hatch, counter-hatch, dots), so parties are
told apart by pattern and by the printed legend, never by hue. Vacancies are hollow squares
and are drawn only when the roster on file is near complete (the capability returns `null`
otherwise, and the UI says vacancies are not shown). Non-voting delegates and Puerto Rico's
Resident Commissioner are drawn and counted apart from the 435. **Order rule:** Democrat,
Independent, Republican (alphabetical among themselves), then every other party
alphabetically by name; the order is never by size or ideology and the page says it is not a
ranking. Labels and counts are always printed in a legend and in the grid's accessible name;
the grid itself is `role="img"`. Vote tokens are never used here, and the seat colors are
never used for votes.

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
- Frame: `.page-frame` on every route and the masthead, 1360px outer (1280 usable),
  gutters 20px on phones, 28px from 768px, 40px from 1050px. Reading pages narrow their
  children with `max-w-5xl`; wide tables scroll inside their own labeled region rather
  than widening the frame. Record pages use a 12-column grid: 8 main / 4 evidence.
- Rules: `.rule-strong` (2px ink) opens each section and the masthead; 1px `--rule`
  hairlines separate rows. Rules are never the only cue for a control.
- **Shape lock:** controls, chips and buttons `2px` radius; panels square; tables and
  charts square. Elevation is a hairline border; the only shadow is a soft ink-tinted
  one on popovers (the column picker), plus edge shadows that appear on wide tables
  only when more columns are scrolled out of view (`.scroll-cue`).
- Breakpoints: Tailwind defaults. Every multi-column layout collapses below `md` (768px);
  Explore swaps its table for cards below `md`.
- The masthead is not sticky (no glass, no blur); in-page anchors use `scroll-mt-6`.
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
| Site header / footer | `src/components/site-header.tsx`, `site-footer.tsx` | Serif wordmark with a teal dot, nav and member search on a 2px ink rule. Nav is one line ≥ 1024px, a scroll row below; search is always visible (its own full-width row on phones) and submits `GET /explore?q=` (the `explore.table` name filter). Footer carries data freshness. |
| Record header + evidence | `app/people/[slug]/page.tsx` | Identity, status pill, party chip, seat, actions and summary facts in 8 columns; **Source records** aside in 4 (external identifiers + header footnotes); stacks identity, sources, section nav on phones. |
| District locator | `components/district-locator.tsx` (+ `components/profile/member-district-map.tsx`) | Inline-SVG map of a state with one district or the whole state highlighted (`districts.shape@1`). State `--surface-sunk` + `--line-control` outline, highlight `--ink-2` + `--ink` outline: never party or vote colour. `role="img"` named "Map of Georgia with congressional district 10 highlighted"; caption states publisher, vintage and as-of date; intrinsic `width`/`height` (no layout shift), scales down with `max-width: 100%`, outline stays 1 px (`vector-effect`); no animation. First item of the Source records panel; reusable by other pages. Which seats get a map is decided in core (`districts.shape` member mode, A80); the wrapper renders nothing for a seat without one and for any failure. |
| Section nav | `.section-nav` | Horizontal anchor links under a record header (all widths; fades while scrolled). Anchors, not tabs. |
| Record status | `.record-status` | Current (tint) / Former (`.record-status-plain`). Text always present. |
| Vote key / meter | `.vote-key`, `.vote-meter`, `src/lib/vote.ts` | Only consumers of `--vote-*`. |
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
| Tally bar | `components/charts/tally-bar.tsx` | Yea / Nay / Present / Not voting meter from `summarizeTally`, every count and the denominator printed. |
| Party breakdown | `components/charts/party-breakdown.tsx`, `party-disclosure.tsx` (client, only the phone fold), `lib/party-breakdown.ts` | "How each party voted": per-party counts and vote meters from `votes.list` `byParty`, total row, basis note. |
| Attendance strip | `components/charts/attendance-strip.tsx`, `lib/attendance.ts` | Month cells plus table twin from `votes.attendance`; greys only. |
| Seat chart | `components/charts/seat-chart.tsx`, `lib/seat-grid.ts` | House and Senate waffle from `chamber.composition`; the only party-colored fill. |
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
| 2026-10-16 | Long official titles cut at ~160 characters with a "Full official title" disclosure | House rules run to 300+ words; the full text stays one click away, unedited. |
| 2026-10-16 | Ranked lists fold: 10 industries, 12 outside spenders, then a muted summary row and a disclosure | Real members have 45 industries and 30+ spenders; the fold keeps the figure readable without hiding totals. |
| 2026-10-16 | "Former member" chip (neutral, outlined) plus service years; Explore's "Members" control (Current / Include former) with counts | Scope is a fact, not a judgment: no color, counts on both options. |
| 2026-10-16 | Scroll containers are `position: relative`; pagination compacts below `sm` | Visually hidden text inside a scroller must not widen the page. |
| 2026-10-20 | Swiss x Editorial restyle: concept palette (paper `#F7F5EF`, ink `#20251F`, teal accent `#086F63`), shared 1280px frame, 2px ink rules, square panels, non-sticky masthead with member search, sans section titles | Owner-approved concept; a calmer research tool. Same two fonts, so no new dependency. Muted text keeps a separately tested `--ink-3` (5.6:1) instead of the concept's single muted grey. |
| 2026-10-20 | Vote colors: Yea teal, Nay amber, Not voting grey, Present hatched grey; never red or blue; `--vote-*` separate from `--party-*` and `--status-*` | Owner rule. The previous tally borrowed the money palette (amber Yea, purple Nay). |
| 2026-10-20 | Concept weaknesses not copied: 11-12px table text, search hidden below 900px, one color name for both absent and not voting | Readability (data stays 14px+), usable mobile search, and Present is not Not voting. |
| 2026-10-20 | Explore and Compare share the 1280px frame (was 1440px) | Masthead and content align; their tables already scroll in labeled regions. |
| 2026-10-20 | Owner approved party colour in the chamber seat chart | The seat chart is the one place party color fills a mark: Democrat and Republican squares use the muted chip inks, Independent and other parties are neutral. Everywhere else party stays a chip, and party color never encodes a vote. The test suite pins this. |
| 2026-10-20 | Seat chart order: Democrat, Independent, Republican, then other parties alphabetically | A neutral, documented rule (alphabetical, not size or ideology); one function (`compareSeatParties` in core) so the UI, API and MCP agree. Printed on the page. |
| 2026-10-20 | Seat chart is a waffle (29 x 15 and 10 x 10), not a hemicycle | A hemicycle implies a left-to-right political spectrum; a grid with a stated order does not. |
| 2026-10-20 | Vacancies are drawn only when at least 90% of voting seats have a member on file | A near-complete roster makes "seats minus members" a vacancy count; a partial load would invent hundreds of empty seats. Otherwise the page says vacancies are not shown. |
| 2026-10-20 | Party breakdown rows use party text, vote-colored meters and a reconciling total; party color never fills a vote segment | Owner rule: red and blue never encode a vote. The total row makes the sum-equals-roll-call check visible. |
| 2026-10-20 | Party in a roll call = the member's party on the vote date | The term data carries the party per term, so a member who switched party is counted with the party they held then. A position with no term in force takes the latest earlier term (end dates can precede a member's last recorded vote). |
| 2026-10-20 | Attendance uses the Explore definitions: eligible = recorded positions in the Congress, missed = Not voting, Present separate | One number everywhere; the month strip totals equal the profile's missed-vote rate (tested for every seeded member). |
| 2026-10-20 | District locator map in the Source records panel, neutral ink and surface tokens only, captioned with publisher, vintage and as-of date | A seat's geography is a sourced fact, not a judgment; no party or vote colour, no hover or animation, and the caption says what the vintage does not show (A75-A79). |
