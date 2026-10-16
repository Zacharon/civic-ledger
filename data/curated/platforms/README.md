# Platforms

**Status (2026-10-16): no entries yet.** Real entries are added only through a reviewed
PR that the owner merges (DECISIONS D3); agents may propose, never approve.

One file per person and cycle: `platforms/<bioguide>-<cycle>.yaml`. A position is the
person's own stated stance in one Congress.gov policy area, quoted or closely
summarized from their campaign material, with a link.

- `cycle`: the election year the platform belongs to.
- `positions[].policy_area`: Congress.gov policy-area id, unique within the file.

```yaml
schema_version: 1
person:
  bioguide: X000000
cycle: 2026
positions:
  - policy_area: energy
    stance: Invest in grid upgrades and storage.
    source_url: https://example.org/placeholder/platform
```
