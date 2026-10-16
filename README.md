# Civic Ledger

Working codename for a non-partisan site that combines public campaign money, votes,
independent scores, promises and platforms for U.S. officeholders and candidates in
one sortable table. Every number links to its primary source.

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Capability contract (human + agent): [docs/CAPABILITIES.md](docs/CAPABILITIES.md)
- Decisions (incl. open owner decisions): [docs/DECISIONS.md](docs/DECISIONS.md)
- Project state (vault): `40_Knowledge/Obsidian_Vault/01_PROJECTS/Civic_Ledger/`

Status: build phase, not deployed.

## Develop

Requires Node 24+ and pnpm 11 (`corepack enable`). No Docker: local and test databases
are embedded Postgres (PGlite) under `.pglite/` unless `DATABASE_URL` is set.

```sh
pnpm install          # workspace deps (lockfile committed)
pnpm db:migrate       # apply SQL migrations (PGlite at .pglite/dev, or DATABASE_URL)
pnpm db:seed          # load the FICTIONAL dev dataset (refuses DATABASE_URL without --allow-postgres)
pnpm check            # lint + typecheck + test + build; must pass before reporting work done
```

Other scripts: `pnpm db:generate` (Drizzle migration from schema changes),
`pnpm ingest <source>` (operator CLI, phase 2), `pnpm curate:validate` (check
`data/curated/**` YAML), `pnpm --filter @civic-ledger/web dev` (web app).
Copy `.env.example` to `.env` for API keys; never commit it.

| Path | Holds |
|---|---|
| `packages/db` | Drizzle schema, SQL migrations, `person_card` read model, client factory, dev seed |
| `packages/core` | Capability registry + `dispatch`, zod schemas, curated-file schemas, `ingest.run@1` contract |
| `packages/ingest` | `SourceAdapter` contract and CLI (adapters: phase 2) |
| `packages/mcp` | MCP adapter entry (phase 2) |
| `apps/web` | Next.js App Router UI and `/api/v1` (phase 2) |
| `data/curated` | Git-reviewed YAML; see its README for the `schema_version` contract |
