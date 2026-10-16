# Promises

**Status (2026-10-16): no entries yet.** Real entries are added only through a reviewed
PR that the owner merges (DECISIONS D3); agents may propose, never approve.

One file per person: `promises/<bioguide>.yaml`. A promise is a specific, checkable
public commitment with a dated source. Ratings are dated verdicts with evidence; the
most recent rating is the promise's current status.

- `person.bioguide`: the person's Bioguide id.
- `promises[].id`: kebab-case, unique within the file and stable forever.
- `policy_area`: optional Congress.gov policy-area id (see `policy.areas`).
- `ratings[].status`: `kept | compromise | broken | in_progress | stalled | not_yet_rated`.
  The kept rate counts only `kept`, `compromise` and `broken`.
- `ratings[].evidence`: at least one `https://` link.

```yaml
schema_version: 1
person:
  bioguide: X000000
promises:
  - id: example-clinic-hours
    statement: Keep rural clinics open five days a week.
    made_on: 2024-03-12
    policy_area: health
    source_url: https://example.org/placeholder/speech
    ratings:
      - rater: Example Rater
        status: in_progress
        rated_on: 2026-06-30
        summary: Bill introduced, not yet passed.
        evidence:
          - url: https://example.org/placeholder/bill
            title: Placeholder bill page
```
