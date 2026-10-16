# Curated data

Git-reviewed YAML that the `curated` ingest source loads. Anyone (human or agent) may
propose a change on a branch; **only the owner approves, by merging** (DECISIONS D3).

| Folder | One file per | Schema (packages/core `curated/schemas.ts`) |
|---|---|---|
| [`promises/`](promises/README.md) | person | `CuratedPromisesFileSchema` |
| [`platforms/`](platforms/README.md) | person and cycle | `CuratedPlatformsFileSchema` |
| [`frameworks/`](frameworks/README.md) | framework version | `CuratedFrameworkFileSchema` |
| [`industry_map/`](industry_map/README.md) | any grouping of committees | `CuratedIndustryMapFileSchema` |

Rules for every file:

- `schema_version: 1` is required. A breaking schema change bumps the version and
  ships a migration note in the same PR.
- Keys are `snake_case`. Unknown keys are errors, so typos fail fast.
- Every claim links to a public `https://` source.
- Only real, verifiable facts about real people. Examples in these READMEs use
  placeholder ids and `example.org` and must never be copied as data.
- Run `pnpm curate:validate` before opening a PR; it prints `file:line: field: message`
  using the same zod schemas the loader uses.
