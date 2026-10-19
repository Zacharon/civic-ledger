# Operations launch preparation — 2026-10-18

Candidate started at `8ff5592` on `claude/ops-launch-20261018`. No hosted account,
service, production database, GitHub issue, notification or scheduled external
action was created by this work. P4 remains **NOT RUN**.

## Implemented local preparation

- Native Node24 Render web + PostgreSQL17 Blueprint: manual deployment, disabled
  previews, select-only web secret, explicit bind interface, direct DB sessions,
  initially closed external DB network, reviewed sizing candidates.
- Gated daily/weekly operator ingest, 12-hour backup, and quarter-hour monitor
  workflow definitions. Missing activation variables skip jobs. No write token or
  issue delivery exists in the monitor workflow.
- Snapshot-consistent dump and record; streaming deterministic SHA-256 comparisons
  for public tables/views, latest ingest receipts, samples of core capability
  answers with integer cents and explicit null coverage preserved.
- AES-256-GCM encryption, manifest HMAC, encrypted-size/hash checks and plaintext
  dump hash. Signed independent weekly copies. Preview retention (14 daily dates,
  eight weekly periods) and separate explicit execution bound to reviewed keys.
- Restore defaults to preview, rejects source/mismatched/populated targets and
  restores one complete archive with a single transaction; never uses `--clean`.
- Monitor drafts for downtime, failed/missed/stale ingest, stuck receipts, missing
  backup objects or stale/invalid manifests and latest backup workflow failure.
  Stable fingerprints reuse existing open incidents; configured owner assignee is
  in each proposed issue. Routine successes are a digest.

## Verification record

Targeted tests: `pnpm exec vitest run packages/core/test/ops-backup.test.ts
packages/core/test/ops-monitor.test.ts --maxWorkers=1`: **15 tests passed** on the
final targeted run. Core typecheck and a strict temporary script tsconfig over all
`scripts/backup/**/*.ts` and `scripts/monitor/**/*.ts` passed. Biome and Bash wrapper
syntax checks passed. The parent's full integration checks/H3 remain separate.

Raw archive tests roundtrip source manifests, duplicate contents and empty files;
reject symbolic links, path traversal, changed source files, corruption and existing
recovery targets. Scheduled ingest and backup both require `CIVIC_RAW_ROOT`, an
absolute marked runner-owned directory outside checkout; shared concurrency prevents
scheduled writes while archiving. Regression checks reject relative/checkout roots
and verify both workflows use the same root configuration.

Negative coverage includes encrypted-byte corruption, wrong key, missing/modified
manifest, invalid object paths, changed financial values, count mismatch, retention
authentication, target mismatch, invalid/future freshness, missing sources, missed
attempts, failed/stuck ingest, backup workflow failure, incident dedup and disabled
workflow guards. No network or production DB is used by default unit tests.

## Tool admission for the optional Windows drill

Installed `embedded-postgres` already supplies the local server, but not dump and
restore clients. Owner scope permits a portable PostgreSQL17 client archive into
ignored task-local storage, with no installer or system PATH change. Candidate:
`postgresql-17.11-5-windows-x64-binaries.zip` from EDB's official HTTPS distribution.

- [PostgreSQL Windows distribution route](https://www.postgresql.org/download/windows/)
  links the EDB portable binaries.
- [Vendor archive page](https://www.enterprisedb.com/download-postgresql-binaries).
- [Vendor-repository checksum confirmation](https://github.com/EnterpriseDB/edb-installers/issues/731):
  expected SHA-256 `80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f`.
- [PostgreSQL License](https://www.postgresql.org/about/licence/): permissive
  PostgreSQL License. The archive also contains bundled third-party notices; retain
  them with the portable tools. No archive is committed or redistributed here.
- Exact downloaded size: 381,531,864 bytes. SHA-256 matched the vendor value above.
- Actual Windows Defender custom scan of extracted executables/DLLs: `Scan finished`,
  `found no threats`, exit 0. A broader ZIP scan did not complete; its task-owned CLI
  waiter was stopped after the runtime-directory scan passed. No Defender service
  or shared runtime was stopped. No broad-bundle security certification is asserted.
- `pg_dump` and `pg_restore` report 17.11. Authenticode is `NotSigned`; provenance is
  the vendor checksum, not an executable-signature claim. The current
  [PostgreSQL security table](https://www.postgresql.org/support/security/) identifies
  17.11 as fixing the listed current client issues; this does not guarantee that
  all bundled third-party components have no vulnerabilities.
- PostgreSQL and command-line third-party notices are retained locally. The latter
  identifies gettext/libiconv/pthreads under LGPL 2.1. Only unmodified task-local
  operator tools were executed against synthetic data within the authorized scope.
  No installer, PATH change, app dependency, shipped linkage or redistribution was
  performed. Commercial/runtime distribution review remains **PENDING**; no human
  approval or general dependency-admission status was manufactured.

## Real PostgreSQL dump / separate restore drill

**PASS**, local fictional data, on 2026-10-18 America/New_York (database UTC record
date 2026-10-19). Command: `pnpm exec tsx scripts/backup/drill.ts` with admitted
task-local `PG_DUMP` and `PG_RESTORE` paths. The script ignores `DATABASE_URL`, starts
its own isolated embedded PostgreSQL17 server and creates separate `ops_source`
and `ops_restore` databases. Local archives are not an off-provider test.

Final receipt: `.pglite/ops-launch-drill/bd28d6e3/evidence.json` in this worktree.

| Check | Observed result |
|---|---|
| Fictional people | 43 |
| Public tables compared by count/checksum | 30, all equal |
| Materialized views | 2, normalized checksums equal |
| Core business capability samples | 13, all equal |
| Snapshot record and dump | Same exported repeatable-read snapshot |
| Mismatches | 0 |
| Backup | 2,794 ms |
| Restore and comparison | 5,992 ms |
| Entire drill including negative checks | 11,681 ms |
| Unpopulated view recovery | PASS: repopulated from restored facts, then compared |

Actual negatives: source-target refusal; populated-target refusal; changed business
row detected after reconnect; corrupt encrypted dump refused before DB effects. The
report lists only refresh timestamps as exclusions in this same-date drill. Money
values, units, coverage nulls and ingest receipts remain compared. This small seed
does **not** establish hosted/full-size RTO or RPO.

### Failure history retained

Early strict typecheck failures in fixture index access were corrected. A raw
empty-file test rejected the correct 52-byte envelope because the initial minimum
was 53; corrected. An intermediate file-handle stream change caused a test timeout;
corrected to close normally while preserving pre-existing output files. Subsequent
targeted suites passed.

Initial Postgres restore attempts failed because pg_restore needs an explicit
database-name flag in addition to environment connection details. This was corrected
with a nonsecret name; credentials remain environment-only. The next attempt restored
data but the pre-comparison cursor ran outside a transaction. That catalog/count
check was corrected. A successful drill then motivated an explicit unpopulated-view
test: ops recovery now uses a normal refresh for unpopulated views, because a
concurrent refresh cannot populate them. The fresh final drill above passed.

## Remaining hosted / human gates

Full-size import/plan sizing, actual Render Blueprint validation, hosted read-only
privilege/proxy spoof tests, off-provider transfer, hosted restore under the RTO,
raw-snapshot off-provider transfer/recovery, protected-environment/runner/IAM setup,
independent uptime monitoring and owner notification receipt are **NOT RUN**.
Independent H3 and the parent's full integration checks remain separate.
