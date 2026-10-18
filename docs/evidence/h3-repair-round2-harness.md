# H3 repair round 2: test harness, secret scan and current-state documents

Branch `claude/h3r2-harness-docs-20261018` (from integration head `33ef2d5`). Review being
answered: vault `01_PROJECTS/Civic_Ledger/audits/h3-readiness-round2-2026-10-18.md`,
finding H3R2-05, the VC-067 row and "Required repairs" items 4 to 6 (harness and documents
only). The ingest runtime findings H3R2-01..03 are repaired on another branch and are not
touched here.

Raw logs: [h3-repair-round2-harness/](h3-repair-round2-harness/). All local runs: Windows 10,
Node 24.16.0, pnpm 11.13.1, Vitest 5.0.4, embedded-postgres 17.10.0-beta.17
(async-exit-hook 2.0.1). User names in paths are replaced by `user`.

## H3R2-05 LOW: embedded-Postgres shutdown throws after the test summary

**Reproduction.** `pnpm test:pg` (no `PG_TEST_URL`, so the embedded server is used), and a
negative control: a throwaway `test-pg/zz-negative-control.pgtest.ts` whose single test
asserts `expect(1).toBe(2)`, run as `pnpm test:pg test-pg/zz-negative-control.pgtest.ts`.
The throwaway file was deleted after the runs and is not committed.

**Red** (code at `33ef2d5`):

| Run | Result | Log |
|---|---|---|
| full suite | 8 files, 47 tests passed, then `TypeError: done is not a function` at `embedded-postgres/dist/index.js:393`; exit 0 | `red-test-pg-pass.txt` |
| negative control | 1 test failed, then the same `TypeError`; exit 1 | `red-test-pg-negative-control.txt` |

**Cause.** `embedded-postgres` calls `AsyncExitHook(gracefulShutdown)` at import. async-exit-hook
listens to `beforeExit`, `exit`, SIGHUP, SIGINT, SIGTERM, SIGBREAK and `message`. Only the
`beforeExit` and signal events call a hook with a completion callback; on `exit` the hook
is called synchronously with no arguments. Fix A56 (commit `1a996b2`) removed the
`beforeExit` listener (whose `process.exit(0)` hid failing tests), so the first event to
reach the hook became `exit`, and `gracefulShutdown(undefined)` then called `done()`. The
exit status was already decided, so this was noise, not a wrong result, but it also meant
the package's process-wide hooks still ran inside the vitest process.

**Fix.** The vitest process no longer imports `embedded-postgres`.
`test-pg/global-setup.ts` forks `test-pg/embedded-server.ts` (plain Node 24 type stripping,
`execArgv: []`, IPC channel). The child creates and starts the one server, reports
`{ type: 'ready' }` or `{ type: 'error' }`, and on `{ type: 'stop' }` or on IPC
`disconnect` calls `server.stop()`, closes the channel and lets its event loop drain, so
the package's own `beforeExit` hook runs with its callback (the supported path) and only
ever sees that one server. Teardown sends `stop`, waits for the child to exit and removes
the data directory. Vitest's exit status is no longer exposed to any third-party exit
hook, which keeps A56's guarantee without removing listeners. `PG_TEST_URL` (CI) still
starts nothing. DECISIONS A56 is amended.

**Green** (this branch, same commands):

| Run | Result | Log |
|---|---|---|
| full suite | 8 files, 47 tests passed, 246.9 s, no `TypeError`; exit 0 | `green-test-pg-pass.txt` |
| negative control | 1 test failed, no `TypeError`; exit 1 (pnpm `ELIFECYCLE ... exit code 1`) | `green-test-pg-negative-control.txt` |

After each green run no `postgres.exe` process and no `civic-embedded-pg-*` temp directory
remained (checked with `Get-Process postgres` and a listing of `%TEMP%`).

Both the red and green full runs print one
`{"level":"error","msg":"database pool error","err":"terminating connection due to administrator command"}`
line. It comes from a test that terminates backends on purpose (`pool.pgtest.ts` or
`ingest.pgtest.ts`, both call `pg_terminate_backend`) and is unchanged
by this repair.

**Limits.**

- Abrupt death of the vitest process on Windows (`parent-killed-windows.txt`: a throwaway
  90 s test, the vitest process killed with `Stop-Process -Force`): the Postgres processes
  and the child are gone 15 s later, but the temp data directory stays. libuv places a
  forked child in a kill-on-close job object, so the child is terminated before its
  `disconnect` handler can clean up. A `detached` child did clean up in a separate probe,
  but it was not adopted because a detached child has no console on Windows and the
  Postgres binaries it starts could open console windows. The in-process design also had
  no cleanup on an abrupt kill. On Linux/macOS the `disconnect` path is expected to stop
  the server; it was not exercised here.
- Ctrl+C during a local run was not exercised.
- CI uses `PG_TEST_URL` and never starts the child, so CI behavior is unchanged.

## VC-067: secret scan covers the full history

**Red** (from the round-2 review, GitHub evidence): with `gitleaks/gitleaks-action@v3`, the
first CI run scanned 8 commits (`--no-merges --first-parent a695e8b^..337d729`) and the
run at `6b93135` scanned 0 (`... e8f122f^..6b93135`).

**Cause.** The action's source (`src/gitleaks.js`, `Scan`) adds
`--log-opts=--no-merges --first-parent <base>^..<head>` (or `--log-opts=-1`) on `push` and
`pull_request` events; only `workflow_dispatch` and `schedule` scan without a range. Its
README documents only environment variables (`GITLEAKS_LICENSE`, `GITLEAKS_CONFIG`,
`GITLEAKS_VERSION`, `GITLEAKS_ENABLE_*`, `GITLEAKS_NOTIFY_USER_LIST`); none changes the
range.

**Fix** (`.github/workflows/ci.yml`, job `secret-scan`). The job now runs the gitleaks CLI
itself:

1. `actions/checkout@v7` with `fetch-depth: 0` (all branches and tags).
2. Download `gitleaks_8.30.1_linux_x64.tar.gz` from the gitleaks GitHub release `v8.30.1`
   and check it against the SHA-256 pinned in the workflow
   (`551f6fc8...f2470eb`, copied from the release's published `gitleaks_8.30.1_checksums.txt`);
   `sha256sum --check --strict` fails the job on any mismatch. Print `gitleaks version`.
3. Print `git rev-list --all --count`, then run
   `gitleaks git --redact --verbose --exit-code 1 --log-level info .`. With no `--log-opts`,
   gitleaks 8 runs `git log -p -U0 --full-history --all --diff-filter=tuxdb` (from
   `sources/git.go`), i.e. every commit on every fetched ref. Findings are printed redacted
   and fail the job; the info log reports the number of commits scanned.

The gitleaks CLI is MIT-licensed; no license key, no repository secret and no
`pull-requests` permission are needed (job permissions: `contents: read`). The action's PR
comments and SARIF artifact upload are gone.

**Verification.** The workflow parses as YAML (Python `yaml.safe_load`; jobs
`secret-scan, check, audit, postgres, e2e`) and the release asset name and checksum were
read from the GitHub release API. Not run: the job itself (GitHub Actions cannot be run
from here) and any local gitleaks binary (none downloaded).

**Limits.** Plain `git log -p` shows no diff for merge commits, so content introduced only
by a merge conflict resolution is not scanned. The version and checksum are pinned by hand
(Dependabot does not update them). Built bundles, logs and screenshots are still not
scanned. The first green full-history run is pending on GitHub.

## Current-state documents

| File | Was | Now |
|---|---|---|
| `docs/ARCHITECTURE.md` section 4 | read model "refreshes only after the commit" | load, shrink guard, refresh of both views and the `succeeded` receipt commit in one transaction (A50); matches `runtime/run.ts` (`refreshReadModel` called inside `db.transaction`) and `read-model.ts` |
| `docs/AGENT_NATIVE_EVIDENCE.md` | ingest gates "repair in progress", "no remote", nothing run on GitHub | public remote; CI green at `6b93135` for check/postgres/e2e/audit/secret-scan; Agent parity failed at `6b93135`, fix merged at `33ef2d5`, green pending confirmation; gates exactly as the round-2 review: Shared capabilities PARTIAL, Shared state PARTIAL, Scoped authority PASS (local), Human usability PASS (local, automated), Visible supervision PARTIAL, Safe recovery FAIL (pending H3R2-01), Receipts PASS (tested local publication boundary) |
| `docs/OPERATIONS.md` restore drill | "`pnpm test` parity passes against a seeded copy" | a pre-backup record (row counts and checksums per table and view, `ingest_run` rows, `sources.status`, a fixed capability sample) compared with the exact restored target before any ingest; states that the drill has never been run |
| `packages/ingest/src/runtime/limits.ts` comment | defaults "far below what would exhaust a small host's disk or memory" | an unmeasured agent proposal pending owner/host sizing (A53, D1); no code changed |
| `docs/DECISIONS.md` A64 | "Not yet run on GitHub (no remote)" | first green on GitHub at `6b93135`, with the retry caveat |

Historical evidence files under `docs/evidence/` were not edited.

## Verification

- `pnpm check` (lint, typecheck, `pnpm test`, build) on this branch: exit 0; default suite
  43 files, 383 tests passed.
- `pnpm test:pg` on this branch: exit 0; 8 files, 47 tests passed (`green-test-pg-pass.txt`).
`pnpm lint` (Biome) covers the TypeScript changes; Biome does not process Markdown or
YAML in this repository (`files.ignoreUnknown`), so the documents were checked by reading
and by a relative-link check over the changed files.

## Follow-up: first full-history scan on GitHub (orchestrator, 2026-10-18)

CI run 39159281652 at `51f6695`: the new job scanned **42 commits** (49 on all fetched
refs) and failed with **2 findings**, both rule `generic-api-key` at
`apps/web/src/lib/explore-columns.ts:168,179` in `dab15bf`: the two DW-NOMINATE
dimension sort identifiers of the Explore columns, matched because the property name ends
in "Key". Not credentials. They are suppressed by exact fingerprint in `.gitleaksignore`
(read by default from the scanned directory); the rule itself stays on.

CI run 39159671521 at `bcc8701` (43 commits): the two originals were suppressed, but the
first `.gitleaksignore` comment and this note had quoted the identifiers in the same
`property: 'value'` form, so commit `a5f2462` produced two new findings of the same rule.
Those two fingerprints are added too, and neither text quotes the identifiers any more.
