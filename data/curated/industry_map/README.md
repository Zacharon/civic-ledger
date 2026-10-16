# Industry map

In-house coding of FEC committees (PACs) to industries (DECISIONS A3). Coverage is
always reported: dollars from committees not listed here show as "not coded", never as
zero or as a guessed industry.

- `industries[]`: the taxonomy (`id`, `name`, `sector`); ids are unique across files.
- `committees[]`: one industry per committee (`fec_committee_id` unique across files).
- `method`: `curated` (reviewed by hand), `connected_org` (FEC connected organization),
  or `name_rule` (name pattern). `confidence` is 0–1.
- `rules[]`: keyword or FEC-code rules applied to every committee in the database at load
  time. `field` is `connected_org`, `committee_name` or `any_name` (whole-word,
  case-insensitive; `&` reads as `AND`, other punctuation as a space), or `org_type`
  (FEC ORG_TP), `designation` (CMTE_DSGN) or `committee_type` (CMTE_TP) (exact code).
  The resulting method is `connected_org`, `name_rule` or `fec_code`.
- Precedence: an explicit `committees[]` entry wins; otherwise the first matching rule,
  in file-name order and then rule order. That is why files are numbered:
  `10-taxonomy`, `20-fec-code-rules`, `30-organization-rules`, `40-keyword-rules`.
- Every `curated` ingest run reports coverage on its receipt: `contribution_cents_total`,
  `contribution_cents_coded` and `industry_coverage_bps` (basis points of committee →
  candidate dollars in the latest loaded cycle that carry a code).

```yaml
schema_version: 1
industries:
  - id: example-industry
    name: Example Industry
    sector: Example Sector
committees:
  - fec_committee_id: C99000001
    industry: example-industry
    method: curated
    confidence: 0.9
    note: Placeholder committee id.
rules:
  - id: example-keyword
    industry: example-industry
    field: any_name
    any_of: [EXAMPLE TRADE ASSOCIATION]
    confidence: 0.7
```
