# Curated-content proposal evidence

Verdict: **ready_for_review, proposal only**. No owner content approval, active curated
write, rating, database load, dependency installation, publication or deployment occurred.

Owner index: [Curated proposals](../proposals/curated-20261018/README.md).

## Deliverables and exact coverage

- 24 source-backed stated-position candidates; 12 D / 12 R and 12 House / 12 Senate.
  Official identity/Bioguide references were obtained from current Senate/House XML.
  Eight members first entered recorded federal service in 2023 or later; six in 2013
  or earlier. First-service dates are separately attributed to congress-legislators.
- **6** campaign-platform YAML proposals have defensible federal election-cycle
  attribution and successful direct HTTP receipts. **18** position candidates remain
  held for absent cycle evidence, official-office/campaign-source mismatch or direct
  HTTP failure. This does not claim 24 loadable campaign platforms.
- **8** specific, dated promise YAML proposals, balanced 4 D / 4 R (5 Senate / 3 House).
  All use empty ratings, which the current capability reports as `not_yet_rated`.
  Conditions and exact promised actions are retained; no agent verdict was assigned.
- **3** attributed framework proposals, comprising six distinct 119th-Congress roll
  calls with unit weights and explicit positions. They concern S.5, S.146 and H.R.1.
  Per-person denominators count recorded yea/nay votes only. Chamber maxima are
  respectively House 1 / Senate 1, House 1 / Senate 0, and House 2 / Senate 1.
- Four link-only publisher proposals: ACLU, Heritage Action, NTU and Lugar/Georgetown.
  Terms remain pending and permission to ingest remains unverified. No scores copied.
- A collector fit assessment links actual current LICENSE files for Crawlee, Crawl4AI
  and Scrapling; it proposes a bounded three-source pilot. Admission remains PENDING;
  installation, dependency security/compatibility checks and tool trials are NOT_RUN.

All candidates and review receipts live outside `data/curated`. Schema-valid proposal
files are named and hashed in the [manifest](../proposals/curated-20261018/proposal-manifest.json).
Committing proposal documentation does not approve those files for ingestion.

## Checks performed

| Check | Actual outcome |
|---|---|
| `pnpm curate:validate docs/proposals/curated-20261018` | PASS: 17 YAML files, zero errors, using the existing loader schemas and explicit proposal root. |
| `python docs/proposals/curated-20261018/prepare_proposals.py` | PASS: 24 identities, 32 source-backed records, cohort counts, canonical policy vocabulary, empty ratings, and exact candidate manifest generation. Refuses to overwrite a differing existing YAML candidate. |
| `python docs/proposals/curated-20261018/verify_references.py` | PASS: 24 official identity references, 32 record identity joins, 17 proposal hashes, six official vote XML references (bill, Congress, session, clerk roll, vote date and yea/nay totals) matched GovInfo/Voteview mapping. |
| Bounded normal public HTTP audit | 52 retained receipts: 49 response hashes, three direct 403 failures. Publication dates and campaign cycles remain separate from retrieval clocks. Raw pages were not committed. |
| Scoped format/content checks | PASS: Biome checked 11 JSON files; three Python scripts parsed; local Markdown links and all 17 YAML hashes verified. LF output keeps the exact manifest portable across Git checkouts. |
| Active curated diff | No edits. No loader invocation or member evaluation. |
| Runtime/full `pnpm check`, browser feature checks, production database target resolution | NOT_RUN in this documentation/proposal worker. No runtime code changed. Parent owns integrated product checks; these data records remain inactive. |
| Independent editorial/H3 review and human content approval | PENDING. |

The six official vote references deliberately distinguish Voteview sequence numbers
from clerk roll numbers: S.5 House 22 vs clerk 23; S.146 House 103 vs clerk 104; H.R.1
House 144/189 vs clerk 145/190. The Senate examples use sequences 7 and 372. Exact
links and checks are in [reference-checks.json](../proposals/curated-20261018/reference-checks.json).
H.R.1's Senate member tally is 50–50; the vice president's deciding vote accounts for
GovInfo's 51–50 summary and is not another senator's vote.

## Source findings and retained limits

- Source retrieval occurred October 19 UTC, still October 18 locally. A page's retrieval
  date does not date its statements or assign a campaign year.
- Some issue pages retain pandemic/older-election language. Current campaign domains
  for Blackburn and Klobuchar now concern governor races. Those observations prevent
  the corresponding material from being silently treated as current federal platforms.
- The direct audit received 403 for the selected Khanna, Rosen and Baldwin campaign
  pages despite readable versions in the web reader. Those failures remain recorded;
  no challenge bypass was attempted. Baldwin's dated campaign proposal is held.
- Python reported a certificate-chain expiry for Voteview. A normal Node fetch using
  its verified trust store succeeded, as the project source notes anticipated. The
  original error and fallback are recorded; certificate verification was never disabled.
- The ACLU scorecard landing page exposed little methodological text. Its orientation
  is kept UNKNOWN here. A publisher link is not a terms clearance or data license.
- Eight dated promise candidates were selected for specificity. More ambiguous or
  undated material was retained in [rejected-and-held.md](../proposals/curated-20261018/rejected-and-held.md).
- The worker's final wording review rechecked all six proposed campaign scopes and
  eight commitments. Warren's platform remains historical presidential material;
  McBride's campaign cycle uses separate dated evidence. Khanna promises bill
  introduction, Gallego promises cloture, and Johnson announces that week's floor
  consideration. Scott's leadership and Lawler's bill-version conditions remain
  essential. This is a source/wording check, not independent editorial approval.
- The existing platform contract requires campaign material and a cycle; it cannot
  honestly represent every useful official issue statement. Held records preserve
  that gap for later owner review rather than inventing a cycle or changing the schema.

## Seven-gate applicability

| Gate | Evidence / applicability |
|---|---|
| Shared capabilities | Proposal YAML uses the same existing validator/loader schemas. No new feature or adapter was introduced, and no active data changed. Human/API/MCP state verification requires a separately approved load. |
| Shared state | No new product store. These inactive files cannot affect web/API/MCP responses. Actual target-database reference resolution remains NOT_RUN. |
| Scoped authority | Proposal only; owner approval and curated merge remain human-only. Empty ratings preserve unrated state. No publisher terms were cleared. |
| Human usability | Owner index names every candidate, source, hold reason, conditional promise and framework denominator. No new runtime control is in scope. |
| Visible supervision | Exact YAML manifest, review status and source receipts expose the proposed changes. No unattended collection or recurring task was started. |
| Safe recovery | Active data is untouched. Candidate generation refuses changed YAML; reference verification refuses changed proposal/official XML hashes. Fresh review is required before replacing human wording. |
| Receipts | Source URL/final URL, retrieval time, status and response hash are retained alongside publication/cycle context and selected official identity/vote references. No mutation or load receipt is claimed. |

Next action: owner review of the named candidate wording and held evidence. After a
specific approval list, a separately scoped integration may copy only selected YAML
files, recheck exact bytes and intended database references, and follow the existing
human curated-merge gate. No part of that activation is performed here.
