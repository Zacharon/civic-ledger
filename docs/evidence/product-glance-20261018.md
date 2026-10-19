# Profile overview, explainers and member finder

Status: **ready_for_review**. Local implementation evidence only; integration checks,
browser review and independent H3 remain required. No publication or deployment.

The profile's **At a glance** section reads `people.glance@1`: fixed sentences over
the existing core identity, money, votes, scores, promises and platform records. Each
value part names its path in the returned `facts`; the human text is exactly the same
joined sentence that API/MCP readers receive. Terms link to `explainers.list@1`, whose
same content is rendered on Methodology. Both capabilities are public reads registered
in the existing registry, so existing API/MCP adapter discovery exposes them.

The member finder is an ordinary GET form to Explore, with required state and optional
House district. `explore.table` applies the same filter for all adapters: a district
selects the House seat plus state senators, subject to any explicit chamber filter.
Zero is an at-large seat; an empty district means every loaded current state member.
Facets enumerate loaded House seats. Explore shows the active district, supports
removing it, and clears it when changing/removing the state or clearing all filters.

## Important interpretation choices

- Campaign financing is explicitly distinguished from personal pay and explanations
  of voting motives. No ideological verdict or generated stance is produced.
- PAC shares use the all-candidates totals; individual shares use the separate FEC
  candidate summary, with their own end date. The text warns against adding these
  shares across different reporting periods. Itemized individual contributions are
  not mislabeled as necessarily large gifts.
- Industry ranking excludes nonpositive net totals. Coverage uses positive dollars
  before refunds, matching `money.summary`; a coding gap stays explicit.
- No loaded outside records is a coverage statement, not proof of no spending.
- Participation comes from actual positions in their latest Congress independently
  of the latest DW-NOMINATE estimate. An estimate's Congress remains visible. No
  reasons for absences or missing estimates are invented.
- Platform counts cover all loaded campaigns, with the latest cycle stated separately.
  Up to three newest reviewed entries preserve their wording, cycle, policy area,
  source URL and provenance. These are reviewed entries, not inferred beliefs.
- Aggregate counts/industry totals link to the complete profile records. The vote
  source note is explicitly labeled an example underlying position, not an exhaustive
  list of provenance for the aggregate. Original source metadata remains in the
  existing detailed capability responses.

## Verification

- `pnpm exec vitest run packages/core/test/glance.test.ts packages/core/test/glance-text.test.ts apps/web/test/url-state.test.ts apps/web/test/query.test.ts --maxWorkers=2`: **46 passed**, four files.
- `pnpm --filter @civic-ledger/core typecheck`: **passed**.
- `pnpm --filter @civic-ledger/web typecheck`: **passed**.
- Scoped Biome check: **passed**, 20 changed source/test paths; `git diff --check`: **passed**.
- Added `apps/web/e2e/product-glance.spec.ts`: API/human sentence and value parity,
  Methodology definition parity, state/district/Senate selection, zero/at-large URL,
  state-change clearing, and scripts-disabled empty-district submission. **NOT_RUN
  in this worker**; Home must first render `MemberFinder` during parent integration.
- Full `pnpm check`, production browser tests, viewport/theme screenshots and fresh
  H3: **NOT_RUN in this worker**; parent owns those checks after integration.

Initial legacy draft tests failed while their expectations still described discarded
peer comparisons and misleading money labels. Updated tests explicitly check the
corrected semantics. The first at-large regression fixture assumed a seed at-large
seat; the seed has none. The final test temporarily converts an isolated fictional
test seat to zero, refreshes its read model and restores it in `finally`; it passes.

## Seven gates

| Gate | Evidence and limit |
|---|---|
| Shared capabilities | Both new reads are in the registry. Unit tests compare overview facts to existing core capabilities. New browser/API parity spec awaits parent execution; MCP parity awaits parent integration suite. |
| Shared state | Overview reads the existing durable records; the test adds a later vote Congress and an older platform cycle and verifies both appear correctly without blending their clocks. Test fixtures are restored. No duplicate product store. |
| Scoped authority | Anonymous read capabilities only; no new writes, privileges, accounts or submissions. Curated entries still require human review. |
| Human usability | Profile links, inline term definitions, labeled form/select controls, explicit empty states and a normal GET submission. Responsive layout uses existing DESIGN tokens. Runtime/keyboard/visual evidence remains pending parent verification. |
| Visible supervision | Inapplicable to effects: these actions read records or change URL filters only. The visible active filters and source links show the selected view. |
| Safe recovery | No data effects. Filter changes use browser history and removable URL state. Existing empty/error routes and section fallbacks remain in use. |
| Receipts | No mutation receipt is applicable. Source record keys, ingest run IDs, retrieval dates, source URLs and source-specific clocks remain available through notes and detailed records. |

## Parent integration

Import `MemberFinder` from `@/components/home/member-finder` into Home and render
`<MemberFinder />` after the hero/search and before the table preview. The component
owns its container and vertical spacing. This worker did not edit Home or the parent
capability/evidence/decision documents. Existing HTTP/MCP parity fixture maps must
include `{ slug: 'avery-ashvale' }` for `people.glance` and `{}` for `explainers.list`.

## Definition sources checked

The plain-language content was checked against primary FEC and Voteview materials;
local definitions of framework/industry coding/missing data cite this project's own
Methodology. The previous independent-expenditure link contained an incorrect
`other-filers/` path; the corrected official link is used.

- [FEC: PAC registration](https://www.fec.gov/help-candidates-and-committees/registering-pac/)
- [FEC: Individual contributions](https://www.fec.gov/updates/individual-contributions-federal-candidates-and-committees/)
- [FEC: Candidate summary fields](https://www.fec.gov/campaign-finance-data/candidate-summary-file-description/)
- [FEC: Independent expenditures](https://www.fec.gov/help-candidates-and-committees/making-independent-expenditures/)
- [Voteview: Method and context](https://voteview.com/about)
- [House: Find your representative](https://www.house.gov/representatives/find-your-representative)

The Congress.gov roll-call landing page could not be retrieved by this worker's web
tool; its established route remains a citation target. No network calls occur in
the tests or in sentence construction.
