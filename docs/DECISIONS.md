# Decisions

| ID | Date | Decision | Status | Notes |
|---|---|---|---|---|
| A1 | 2026-10-15 | TypeScript monorepo (pnpm), Next.js web, Drizzle + Postgres, PGlite for local/test | Adopted (agent, reversible) | No Docker on the dev PC; PGlite runs real Postgres in-process. |
| A2 | 2026-10-15 | Readiness profile W | Owner-directed | Owner asked for the build to be checked against VC-001–VC-111 at profile W. |
| A3 | 2026-10-15 | OpenSecrets = link target + later enrichment; industry coding in-house with coverage % | Adopted | OpenSecrets bulk access is application-gated and unresponsive (Jul 2026). |
| A4 | 2026-10-15 | ProPublica Congress API not used; votes + ideology from Voteview, bills from GovInfo BILLSTATUS, identity from congress-legislators | Adopted | ProPublica API shut down in 2024. |
| D1 | — | Production Postgres host: self-hosted vs Supabase vs other | **Open (owner)** | Schema is host-neutral (no vendor extensions). Blocks deploy only. |
| D2 | — | Which scorecard publishers to approach after a terms-of-use read | **Open (owner)** | Until cleared: publishers listed with links only; no score ingest. |
| D3 | — | Public promise submissions? | **Open (owner)**; default = no | v1: curated YAML via git PR, owner merge = approval. |
| D4 | — | Product name | **Open (owner)** | "Civic Ledger" is a working codename. |
