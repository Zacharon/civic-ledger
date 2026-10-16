# Policy areas

The Congress.gov policy-area vocabulary: one term, assigned by the Congressional
Research Service, describes the main subject of every bill and resolution. It is the
neutral topic base for votes, frameworks and platforms. `congress-gov.yaml` holds the
32 current terms; change it only when Congress.gov changes its list.

- `id`: kebab-case form of the name (`Arts, Culture, Religion` → `arts-culture-religion`).
  Bills, platforms and promises refer to areas by this id.
- `name`: the exact Congress.gov term, matched against BILLSTATUS `policyArea/name`.
- Legacy terms that appear only on older bills are added by the `govinfo-billstatus`
  loader from the source data, so a bill is never dropped for an unlisted term.

```yaml
schema_version: 1
source_url: https://example.org/placeholder/policy-areas
areas:
  - id: example-area
    name: Example Area
```
