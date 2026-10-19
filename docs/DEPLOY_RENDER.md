# Render launch and recovery walkthrough

Prepared 2026-10-18. **No service has been provisioned by this work.** The Blueprint,
operator commands and disabled workflow definitions are a reviewable deployment
package. P4, hosted recovery, live notification delivery and owner acceptance remain
**NOT RUN**. Local synthetic evidence is in
[ops-launch-20261018.md](evidence/ops-launch-20261018.md).

## Decisions embodied in the package

- One paid native Node 24 web process and paid managed PostgreSQL 17 in Virginia.
  `render.yaml` proposes web `1c-2g`, database `0.5c-1g`, 20 GB storage. These are
  initial sizing candidates; review current prices and measure a complete import
  before committing to a production budget. No price or capacity guarantee is implied.
- Automatic deploys and preview environments are disabled. The web receives only
  `civic_web` select-only credentials. Migrations and ingest use distinct operator
  credentials. There is no owner-credential fallback in this Blueprint.
- Direct database sessions (`connectionPool: none`) preserve session advisory locks
  and exported snapshots. Ingest and backup must never use a transaction pooler.
- The database external endpoint starts closed. A fixed-egress trusted runner is
  required for the prepared ingest/backup workflows; GitHub's changing hosted-runner
  IP ranges are not a reason to open the database to the entire internet.
- Recovery objectives: **RPO 24 hours, RTO 4 hours**. They are operating targets until
  measured on full-size hosted data. The archive schedule is every 12 hours to leave
  retry margin. Retention selects the newest archive on each of 14 UTC dates, plus
  the newest on each of eight weekly periods. Weekly copies are independent.

Official references checked 2026-10-18: [Blueprint fields and validation](https://render.com/docs/blueprint-spec),
[native Next.js deployment](https://render.com/docs/deploy-nextjs-app),
[Node version selection](https://render.com/docs/node-version),
[Postgres endpoints, TLS and network access](https://render.com/docs/postgresql-creating-connecting),
[pooling restrictions](https://render.com/docs/postgresql-connection-pooling),
[managed recovery](https://render.com/docs/postgresql-backups).

## Before the setup sitting

Have the reviewed integration commit and its required checks/H3 result, approved
public name/domain and paid service budget, and owner-controlled Render/GitHub and
off-provider object-store access ready. Creating a Blueprint is the paid provisioning
boundary; repository preparation does not perform or approve that action.

Prepare an isolated trusted runner with labels `self-hosted,civic-ledger-ops`, Node24,
pnpm11.13.1, admitted PostgreSQL17 `psql`/`pg_dump`/`pg_restore`, and AWS CLI v2. Use an
ephemeral runner or trusted private-repository workflow policy; never expose its
production secrets to pull requests. `scripts/backup/Dockerfile` is an optional
operator image providing those tools; it is not part of the web deployment. Its
build and container execution are **NOT RUN** in the local Windows evidence.

Create an absolute runner-owned persistent raw directory **outside the checkout**
(for example `/srv/civic-ledger/raw` on a Linux runner), with owner-only write access.
Inside it create `.civic-ledger-raw-root.json` containing
`{"version":1,"purpose":"civic-ledger-raw-snapshots"}` and configure its absolute path
as `CIVIC_RAW_ROOT`. Both jobs require the same real directory and scope marker;
relative paths, the checkout/its ancestors and symlink roots are refused. Checkout
cleanup can safely clean ignored build files without deleting provenance. The
marker scopes the filesystem boundary; possession of it is not authentication.

Create an off-provider bucket with a dedicated `civic-ledger/` prefix. Block public
access. Give the backup identity only prefix-scoped list/get/put; retain delete
rights separately if possible. Give monitoring a read/head identity. Enable bucket
versioning/object retention when available, and retain the encryption key in an
owner-controlled secret store separate from the bucket. A lost encryption key
cannot be recovered by the application.

## One sitting: database, web, import and first recovery

1. Review `render.yaml` in Render's Blueprint editor or with its official validation
   command. Confirm the exact repository, reviewed commit/branch, plan, region and
   public service name before creating resources. `autoDeployTrigger: off` stops
   later commit-triggered deployment; the initial creation still provisions/deploys.
   Keep this first web deployment unavailable until the read-only login exists;
   never temporarily substitute the owner connection to make it green.
2. Allow the owner's fixed IP on the external DB endpoint for setup. Connect with
   PostgreSQL17 using the full hostname. Keep credentials in environment variables
   or the secret manager, never pasted into logs, shell history, screenshots or git.
   Use the internal endpoint from same-region Render services. Render documents
   self-signed TLS internally: `sslmode=require` encrypts there; `verify-full` is
   suitable for externally trusted certificates after checking the client's trust.
3. From the reviewed checkout, set `DATABASE_URL` privately to the schema-owner login
   and run `pnpm db:migrate`. Apply `scripts/db/roles.sql` as that same schema owner.
   Create `civic_web` in `civic_readonly` and `civic_loader` in `civic_ingest` with
   passwords supplied through the secret manager (see OPERATIONS). Set the web
   login's `default_transaction_read_only=on`. Do not use `db:seed` on hosted data.
4. Supply **only** the internal `civic_web` URL as Render's
   `DATABASE_URL_READONLY`. Keep `DATABASE_URL` and `DB_ALLOW_OWNER_CREDENTIALS`
   absent from web. The native build installs the pinned package-manager version,
   frozen workspace dependencies including build tools, and runs ordinary
   `next build`. Start is `pnpm --filter @civic-ledger/web start`, the project's
   bounded custom Next HTTP server. `HOSTNAME=0.0.0.0` and Render's `PORT` bind it.
5. Deploy the exact checked commit manually. Verify `/api/live` returns 200 without
   a DB query and `/api/health` returns 200 with a real DB read. An empty/stale source
   ledger can be degraded with 200; `/api/health?strict=1` must flag it. Initial rate
   limiting uses acknowledged `RATE_LIMIT_SINGLE_BUCKET=1`. Per-client proxy trust
   stays pending until spoofed/forwarded requests prove Render's actual header chain.
6. Add only the trusted runner's fixed egress to the DB allow list. Privately set
   `DATABASE_URL` on that runner to the external **civic_loader** direct endpoint.
   Run the ordinary operator command, explicit cycle/congress, in source order:
   legislators, Voteview, FEC, BILLSTATUS, curated. Example scope for the present
   dataset: `pnpm ingest all --congress 119 --cycle 2026 --deadline-minutes 45
   --raw-dir "$CIVIC_RAW_ROOT"` (PowerShell: use `$env:CIVIC_RAW_ROOT`).
   Inspect each `ingest_run` receipt, source count, fiscal units, primary-source
   links, coverage gaps and read-model refresh. A shrink refusal requires reviewed
   investigation, not an automatic `--allow-shrink` or replay.
7. Configure backup credentials independently. The backup login must read every
   application table and sequence and export a snapshot; an owner/admin login may
   be used on the trusted backup runner only. The schema-owner credential never
   reaches web. Set `BACKUP_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY` (at least 32
   cryptographically random bytes), `BACKUP_S3_BUCKET`, optional `BACKUP_S3_PREFIX`,
   AWS region/endpoint and scoped AWS credentials. Use admitted PostgreSQL17 tools
   on PATH, or explicit `PG_DUMP`/`PG_RESTORE` executable paths.
8. Quiesce manual ingest and run `pnpm exec tsx scripts/backup/raw.ts backup` to
   preserve the configured persistent source tree. It streams encrypted blobs plus
   a signed path/checksum index, preserves source manifest bytes, rejects symlinks
   and changed files, and publishes `latest-raw.json` last. The scheduled backup
   and ingest jobs share one concurrency group. Then run
   `pnpm exec tsx scripts/backup/cli.ts backup`. It exports a repeatable-read
   snapshot; `pg_dump --snapshot` and the table/view/capability record describe the
   same database state. It encrypts dump and record separately with AES-256-GCM and
   per-file scrypt salt/IV, then uploads both and a signed manifest. `latest.json`
   changes only after required uploads succeed. A local-directory backend exercises
   the same code but is not off-provider proof.
9. Provision a **separate empty recovery database**, using a separate instance for
   the hosted disaster-recovery test. Privately set `RESTORE_DATABASE_URL` to its
   owner login; never point it at production. Choose the exact manifest object key
   from the successful backup receipt, then preview:

   ```sh
   pnpm exec tsx scripts/backup/cli.ts restore --manifest daily/<archive>.manifest.json --target-database <empty-recovery-db>
   ```

   The preview authenticates the manifest and checks the declared separate target.
   No target connection or database effects occur. Re-run with `--execute --report
   <private-report.json>` only for that intended empty DB. Restore verifies encrypted
   checksums, GCM tags, record version and plaintext dump checksum before connecting.
   It refuses source identity or existing target objects, then uses one transaction
   with `pg_restore --single-transaction --exit-on-error --no-owner --no-privileges`.
   It never drops a database or uses `--clean`; a partial archive error rolls back.
   Do not pre-migrate the recovery DB: the full dump contains the original schema.
10. Compare all public tables, both materialized views, latest ingest receipts and
    recorded core capability answers. The JSON report lists the only exclusions:
    regenerated refresh timestamps, plus computed tenure/current fields when DB
    dates differ. Null coverage and integer-cent values remain exact comparisons.
    Restart a recovery web process with its select-only login and pass its URL using
    `--web-base-url` on a record comparison, or run a separate HTTP smoke check.
    Show ordinary search, profile, money, votes, comparison and API/MCP reads on the
    restored DB. Hosted HTTP/MCP proof is distinct from core restore integrity.
11. Record actual data size, backup time, restore time and business checks. A tiny
    local fictional seed cannot prove full-size RTO. Only after hosted restore and
    a rollback drill meet the applicable gates can the owner consider P4/launch.

## Scheduled work: disabled until deployment setup

All three workflows require repository variable `CIVIC_DEPLOYMENT_ENABLED=true`
**and** their individual `CIVIC_BACKUPS_ENABLED`, `CIVIC_INGEST_ENABLED`, or
`CIVIC_MONITOR_ENABLED=true`. Unset/false means skipped, including manual dispatch.
Create protected environment `civic-ledger-operations` with the intended branch and
review policy before enabling. Merging these files alone creates no production
connection, issue, scheduled ingest or backup.

Set environment secrets:

| Secret | Consumer |
|---|---|
| `INGEST_DATABASE_URL` | Ingest only; external direct civic_loader URL |
| `BACKUP_DATABASE_URL` | Backup only; all-table/sequence snapshot reader |
| `BACKUP_ENCRYPTION_KEY` | Backup/recovery and manifest verification |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Archive writer |
| `BACKUP_MONITOR_ACCESS_KEY_ID`, `BACKUP_MONITOR_SECRET_ACCESS_KEY` | Read/head monitor |

Set environment/repository variables: `CIVIC_CONGRESS`, `CIVIC_CYCLE`, `CIVIC_RAW_ROOT`,
`CIVIC_SITE_URL` (HTTPS origin), `CIVIC_ALERT_ASSIGNEE` (owner's exact GitHub login),
`BACKUP_S3_BUCKET`, optional AWS endpoint, AWS region and optional `PG_DUMP` path.
Create the `civic-ops` repository label before any approved issue delivery.

- Ingest: daily 00:41 UTC legislators/BILLSTATUS; Saturday 01:41 UTC Voteview/FEC.
  CLI receipts, finite run deadlines and per-source database locks remain the
  authority. The wrapper never migrates, seeds, overrides shrink protection or
  force-replays. Curated entries keep the existing human review route.
- Backup: 03:23 and 15:23 UTC. Sunday morning also archives an independent weekly
  copy. Backup failure leaves `latest.json` unchanged. This is visible as either
  the latest failed workflow or archive age beyond 24 hours.
- Monitor: four times hourly. GitHub cron is best-effort and may be delayed; this
  is not a 24/7 paging service or five-minute uptime guarantee. An independent
  uptime monitor remains an owner setup/receipt gate.

## Monitoring, supervision and human-only delivery

`pnpm exec tsx scripts/monitor/cli.ts --out <draft-directory>` reads the public
liveness/readiness and `sources.status` surfaces, the signed latest DB/raw archives,
DB object sizes and a first/last raw-blob presence sample. Full raw recovery checks
every blob; monitoring does not claim that full integrity check. It drafts findings for downtime, missing sources,
48-hour daily/14-day weekly staleness, missed attempts (30 hours/eight days),
failed/partial/cancelled runs, running jobs beyond two hours, invalid/old backups
and latest backup-workflow failure. Failure text from DB/providers is never copied
into draft bodies. Successful probes stay in `digest.md`/Actions step summary.

The prepared workflow downloads all open `civic-ops` issues, computes stable
fingerprint markers and emits `action:create` or `action:already_open`. Draft issue
JSON already includes the configured owner assignee and label. The workflow has
**issues:read**, so it cannot publish, comment on or close issues. It never sends
email or push notifications. Recovery does not automatically close a human-owned
incident. Review a proposed issue alongside current status before delivery.

After explicit owner authorization for delivery, a human can submit the reviewed
JSON using GitHub's structured `--input` path (for example `gh api --method POST
'repos/{owner}/{repo}/issues' --input <reviewed-issue.json>`). Refresh the open-issue
list immediately before sending and use the same fingerprint to avoid duplicates.
The owner must verify their notification subscription and demonstrate receipt of
one approved test alert. That is **HUMAN-ONLY / NOT RUN** in this package. Draft
generation does not prove that the owner was notified.

## Retention and incident recovery

Retention is separate and **preview-only by default**:

```sh
pnpm exec tsx scripts/backup/cli.ts retention > retention-preview.json
pnpm exec tsx scripts/backup/cli.ts retention --execute --plan retention-preview.json
```

Execution rejects a stale key list. Only authenticated manifest triplets under
the exact `daily/` or `weekly/` archive format can be removed; there is no recursive
bucket deletion. Keep IAM deletion permissions unavailable until the owner chooses
to perform that maintenance. With deletion disabled, retention is a reviewed
policy/plan and storage can grow beyond the target. Bucket version history requires
its own provider lifecycle policy; the CLI does not erase historical versions.

For an incident, stop the affected ingest schedule, preserve its receipt and the
last good publication, and follow OPERATIONS severity/rollback steps. Restore to a
fresh DB and compare before switching credentials. Apply role grants and create
the new read-only/loader logins on the recovered DB: `--no-privileges` intentionally
does not copy source login secrets or grants. Promotion, DNS changes and account
operations stay owner-controlled.

These archives cover PostgreSQL facts, schema, materialized views and run manifests.
Code and curated files remain in git. The trusted runner's persistent raw tree is
archived separately by `raw.ts backup`. Preview recovery with
`pnpm exec tsx scripts/backup/raw.ts restore --manifest raw/<archive>/manifest.json
--target <new-directory>`, then use `--execute` for that exact new directory. Its
parent must exist. Paths, authentication, encrypted/plaintext hashes and sizes are
checked; an existing target is refused. Failed recovery preserves partial files
without a verified receipt; inspect it and use a new directory. Raw archives are
retained indefinitely by default: DB retention never deletes them. Apply a separate
reviewed object lifecycle only after proving published provenance no longer needs
those snapshots. Actual off-provider raw transfer/recovery is **NOT RUN** here. A
DB dump must not be described as containing the raw files.

## Operator capability contract and seven gates

Stable commands: `ops.backup@1` (write encrypted archive), `ops.restore@1` (preview
or write one declared empty recovery DB), `ops.retention@1` (preview or delete only
reviewed archive objects), `ops.raw.archive@1` / `ops.raw.restore@1` (quiesced source
files to encrypted archive / verified new directory), and `ops.monitor@1` (read;
write local draft artifacts).
Human CLI and automation invoke these same handlers. Authority is possession of
scoped environment credentials on a trusted operator machine, not a public API,
copied actor label or agent-authenticated identity. Public readers gain no writes.

Inputs are environment connection/secret values plus explicit typed CLI options;
durable outputs are signed archive manifests, integrity reports and draft/digest
artifacts. Archive IDs are unique; retry creates an additional archive, and
retention preserves the latest per period. Restore is not blindly retryable after
a successful write: a populated target is refused. On an uncertain connection loss,
inspect that target; compare or use a new empty DB. Cancelled restore is transactional;
provider deletion after retention has provider-versioning recovery limits.

| Gate | Local evidence / boundary |
|---|---|
| Shared capabilities | Human wrappers and workflows call the same CLI handlers; local tests exercise those handlers |
| Shared state | Archive/restore comparison reads saved Postgres state after reconnect; hosted scheduling/HTTP remains NOT RUN |
| Scoped authority | Separate target name/source identity, empty target, object key and signed-manifest checks; actual hosted IAM/roles NOT RUN |
| Human usability | CLI help, preview outputs and this ordinary operator walkthrough; hosted owner completion NOT RUN |
| Visible supervision | Proposed retention keys, draft incident JSON, existing-issue receipts, Actions logs/digest; no autonomous delivery |
| Safe recovery | Authenticated corruption refusal, transactional restore, populated-target refusal, stale-retention refusal; hosted disaster recovery NOT RUN |
| Receipts | Signed snapshot/dump manifest, comparison report and draft fingerprints; hosted backup/notification receipt NOT RUN |

This is bounded local operations preparation, not an assertion that all seven
deployment gates pass. Carry the explicit NOT RUN boundaries into P4 evidence.
