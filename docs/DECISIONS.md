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
| A5 | 2026-10-16 | Toolchain: TypeScript 7 (native), Biome 2, Vitest 5, Next 16, Drizzle 0.45 stable (not the 1.0 RC), zod 4 | Adopted (agent, reversible) | Current stable releases on the build date; Next 16.4 builds and type-checks with TS 7. |
| A6 | 2026-10-16 | Workspace packages ship TypeScript source (no per-package build); Next transpiles them, CLIs run via `tsx`; `pnpm build` builds `apps/web` | Adopted (agent, reversible) | Fewer moving parts; `pnpm typecheck` covers every package. |
| A7 | 2026-10-16 | `person_card` is one row per person (latest term, FEC cycle, DW-NOMINATE congress, voting congress); cleared scorecards live in a second view `person_card_scorecard` instead of one column each | Deviation from ARCHITECTURE §3 (agent) | A materialized view cannot grow a column per publisher without a migration; the side view is indexed on `(publisher_id, normalized)` and sorts via `scorecard:<id>`. Per-scope cards (e.g. past congresses) can be added as a scope column later. |
| A8 | 2026-10-16 | `committee_industry` holds one industry per committee | Narrowing of ARCHITECTURE §3 (agent) | Keeps coverage % an unambiguous dollar share; no double counting across industries. |
| A9 | 2026-10-16 | Frameworks: a bill rule scores the bill's `rollcall_bill.is_final_passage` rollcalls; each rollcall counts once (first rule wins, later ones report `duplicate_rollcall`); present/not voting are listed but excluded from X and Y | Adopted (agent) | Makes "aligned X of Y" exact and reproducible from the listed votes. |
| A10 | 2026-10-16 | `ingest.run@1` is defined in core (`contracts/ingest.ts`) but its handler lives in packages/ingest and is not in the public registry; `curated.validate@1` is registered with `audience: 'operator'`. Adapters expose only `publicCapabilities()` | Deviation from CAPABILITIES.md "every capability registered" (agent) | core cannot import ingest (dependency rule); operator capabilities must never reach `/api/v1` or MCP. |
| A11 | 2026-10-16 | Wire conventions: money in integer cents, shares/rates as fractions 0–1, `null` = no data; capability inputs are strict (unknown keys rejected) and typed (adapters coerce query strings) | Adopted (agent) | Neutral, lossless numbers; typos fail fast for agents. |
