# Industry map

In-house coding of FEC committees (PACs) to industries (DECISIONS A3). Coverage is
always reported: dollars from committees not listed here show as "not coded", never as
zero or as a guessed industry.

- `industries[]`: the taxonomy (`id`, `name`, `sector`); ids are unique across files.
- `committees[]`: one industry per committee (`fec_committee_id` unique across files).
- `method`: `curated` (reviewed by hand), `connected_org` (FEC connected organization),
  or `name_rule` (name pattern). `confidence` is 0–1.

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
```
