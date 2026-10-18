# Agent parity CI: seeded and served PGlite differ (H3R2-04)

Branch `claude/agent-parity-ci-20261018` from `6b93135`. Review answered: vault
`01_PROJECTS/Civic_Ledger/audits/h3-readiness-round2-2026-10-18.md`, H3R2-04.

**Failing run (kept as negative history).** GitHub Agent parity run 39153921808 at
`6b93135`: the parity tests and build passed, then `/api/health` stayed 503 for 30 s with
`relation "source" does not exist`.

**Root cause.** Two rules for the default PGlite directory. `dbConfigFromEnv` (used by
`db:migrate`, `db:seed`) resolved `.pglite/dev` against the working directory; the web
server resolves it at the workspace root. The workflow runs migrate and seed from
`apps/web`, so they filled `apps/web/.pglite/dev` and the server opened an empty
root database.

**Red.**
- Workflow step, reproduced locally as written (`red.txt`): seed in `apps/web/.pglite/dev`,
  server root directory empty, `/api/health` 503, same `relation "source"` error.
- Unit (`red-unit.txt`): new test `defaults to the repo-root .pglite/dev from any package
  directory` in `packages/db/test/client.test.ts`, run on the unfixed code: expected the
  root directory, received `apps/web/.pglite/dev`.

**Fix.** `defaultPgliteDir()` in `packages/db/src/client.ts` (nearest
`pnpm-workspace.yaml`, else under the working directory) is the default of
`dbConfigFromEnv`, and the web server imports it through `@civic-ledger/core` instead of
its own copy. The workflow is unchanged: running the CLIs from a package directory is now
correct, not a trap. Health is not weakened; an unseeded database still returns 503.

**Green.**
- Same unit test plus `apps/web/test/db-config.test.ts`: 9 passed (`green-unit.txt`).
- Same workflow step, still from `apps/web` (`green.txt`): no `apps/web/.pglite`, seeded
  root database, `/api/health` 200 after 2 s, `health?strict=1` ok, `/explore` 200,
  `people.search` items, operator-only `curated.validate` 404.
- `pnpm check`: exit 0, 43 files, 383 tests, build. A first attempt hit four timeouts in
  process-spawning tests while an independent review ran suites on the same machine; both
  files then passed alone (14/14) and the full rerun passed.

**Not changed.** `packages/mcp` resolves its default `--pglite` directory from the
invocation directory; run from the repo root, as docs/API.md shows, it is the same
directory.
