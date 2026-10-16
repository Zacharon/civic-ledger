# Civic Ledger agent instructions

`AGENTS.md` and `CLAUDE.md` are identical copies. Edit both together.

- Read `docs/ARCHITECTURE.md` and `docs/CAPABILITIES.md` before changing code. They are the contract.
- Read `docs/DESIGN.md` before any visual or UI change in `apps/web`; it is the design system of record.
- Dependency direction: `apps/web`, `packages/mcp` -> `packages/core` -> `packages/db`; `packages/ingest` -> `packages/db` (+ core schemas). Adapters never query the database directly.
- Business rules live in `packages/core` capabilities. The UI, `/api/v1` and MCP are thin adapters over the same registry.
- Neutrality rules in ARCHITECTURE section 1 and 6 are acceptance criteria: no default ideological sort, every score attributed, every fact has provenance, coverage shown.
- Tests never touch the network or a production database. Use PGlite and committed fixtures.
- Never commit `.env*`, API keys or raw source dumps (`data/raw/` is gitignored).
- Run `pnpm check` (lint, typecheck, test, build) before reporting work done.
- Branch naming: `<owner>/<slug>-<YYYYMMDD>`; worktrees under `Workspace/_worktrees/Civic_Ledger/<category>/<slug>-<YYYYMMDD>`.
- No deploy, push, publish or merge to `main` without owner approval.
