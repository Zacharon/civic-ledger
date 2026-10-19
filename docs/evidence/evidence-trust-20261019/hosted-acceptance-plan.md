# Hosted acceptance plan (T-O O4), prepared 2026-10-19

**Status: every check below is NOT RUN and owner-gated.** This file is a plan only. No
Render service, database, bucket, log drain, GitHub issue, notification or branch ruleset was
created or changed while writing it. Each section says who has to authorize it. It follows
[DEPLOY_RENDER.md](../../DEPLOY_RENDER.md) (provisioning order) and
[OPERATIONS.md](../../OPERATIONS.md), and it covers the remaining gates listed in
[amalgamation-20261018.md](../amalgamation-20261018.md) "Remaining gates".

Use one row per check in the hosted evidence record. Each row records the commit, UTC time,
operator, exact command, observed result and PASS / FAIL / BLOCKED / NOT RUN. Never paste
credentials, connection strings, `Authorization` headers or raw provider error bodies.

## 0. Preconditions (owner)

| # | Precondition | Authorization |
|---|---|---|
| P0.1 | The owner approves the reviewed commit, Render plans, budget and public name (D1, render.yaml header) | Owner |
| P0.2 | A **staging** web service from the same Blueprint (not publicly announced), so the rate-limit and credential negatives below never hit the public service | Owner (paid resource) |
| P0.3 | `civic_web` (in `civic_readonly`, `default_transaction_read_only=on`) and `civic_loader` (in `civic_ingest`) exist; `roles.sql` was applied after `db:migrate` | Owner/operator |
| P0.4 | Two client vantage points with **different public egress IPs** (A: owner workstation, B: a phone hotspot or a separate cloud shell). Record each egress IP from a neutral echo service before you start | Operator |
| P0.5 | Off-provider bucket, scoped credentials and `BACKUP_ENCRYPTION_KEY` exist outside Render (DEPLOY_RENDER step 7) | Owner |

## 1. Runtime compatibility on the hosted pin (Node 24.21.0)

Local checks ran on Node 24.16.0. The hosted pin has never run this code.

1. Deploy the reviewed commit manually to staging.
2. In the build log, record the `node -v` / `NODE_VERSION` line and the pnpm version, and
   confirm the install used `--frozen-lockfile`.
3. In the runtime log, confirm the startup lines:
   - `{"event":"web.listening",...}` from `server.mjs`.
   - `{"event":"db.readonly_attestation","outcome":"accept",...}` (this branch; see section 5).
4. Smoke test from vantage A (`curl -sS -D - -o /dev/null`):
   - `GET /api/live` gives 200 with `no-store`.
   - `GET /api/health` gives 200, with `checks.database.status` = `ok`.
   - `/`, one profile page, `GET /api/v1/people.search?limit=3` and `POST
     /api/v1/frameworks.evaluate` with a minimal valid framework all answer 2xx.
   - Every response carries `x-request-id`.
5. Boundary deadlines: open a raw TCP connection, send only a partial request line and wait.
   The socket must close at about `HTTP_HEADERS_TIMEOUT_MS` (10 s) or the inactivity limit.
   Then `POST` to `frameworks.evaluate` with a body that stops halfway. The answer must be an
   uncached `408` by `API_BODY_TIMEOUT_MS`.

**Pass:** the build ran on 24.21.0. All smoke requests return the expected status codes.
Both deadline probes close or answer within budget plus 2 s. No log line contains
`postgres://`, a password or a stack trace (search the log viewer for `postgres://` and
`at ` frames).

## 2. Proxy client identity and header spoofing (`TRUSTED_PROXY_HEADER` on Render)

The blueprint starts with `RATE_LIMIT_SINGLE_BUCKET=1` (A43): everyone shares one bucket.
Per-client mode must not be enabled until a header has been shown to be overwritten by
Render's edge and impossible for clients to spoof. This is a black-box test: the limiter's
`RateLimit-Remaining` header shows which bucket a request landed in, so no debug endpoint
is needed.

Staging configuration for the test (owner sets the env vars; each change redeploys):
`API_RATE_LIMIT_PER_MINUTE=5`, `RATE_LIMIT_SINGLE_BUCKET` unset, and one candidate at a
time:

| Candidate | `TRUSTED_PROXY_HEADER` | `TRUSTED_PROXY_HOPS` |
|---|---|---|
| C1 | `x-forwarded-for` | 1 |
| C2 | `x-forwarded-for` | 2 |
| C3 | `true-client-ip` (only if Render documents setting it) | n/a |
| C4 | `cf-connecting-ip` (only if Render's edge is documented to overwrite it) | n/a |

For each candidate, using `GET /api/v1/sources.status` (default bucket):

1. **Baseline:** from A, make 5 requests. `RateLimit-Remaining` must go 4, 3, 2, 1, 0. The
   6th request must get `429` with `Retry-After`.
2. **Spoof, same client:** still inside the minute, from A, send 10 requests that each set
   a different forged header: `X-Forwarded-For: 203.0.113.<n>`, `X-Forwarded-For:
   203.0.113.<n>, 198.51.100.<n>`, `True-Client-IP: 203.0.113.<n>`, `CF-Connecting-IP:
   203.0.113.<n>`, `X-Real-IP: 203.0.113.<n>`, `Forwarded: for=203.0.113.<n>`. **Every one
   must be 429.** If any returns 200, the candidate is spoofable: reject it.
3. **Independent client:** from B, inside the same minute, make 5 requests. All must be
   200, with `RateLimit-Remaining` counting down from 4. This shows that B has its own
   bucket.
4. **Independent rules:** from A (API bucket still exhausted), `GET /` must still be 200
   (page bucket, 300/min), `GET /api/live` must be 200 and unthrottled, and `GET
   /api/health` must be 200 (health bucket).
5. **IPv6:** if B can reach the service over IPv6, repeat step 3 over IPv6. Record whether
   the keyed address is the full IPv6 address (expected; see OPERATIONS "Limits of the
   in-memory limiter").

**Pass:** exactly one candidate meets steps 1 to 4. Record it in OPERATIONS "Trusted proxy
handling" (Render row), then restore the production limits.
**Fail/blocked:** no candidate passes. Keep `RATE_LIMIT_SINGLE_BUCKET=1` and put an edge
WAF rate limit in front (owner decision).

## 3. Independent per-client quotas in production configuration

After section 2 passes, set the chosen header on the **public** service, with
`RATE_LIMIT_SINGLE_BUCKET` removed and the default limits. Then:

1. Confirm `/api/health` reports `checks.rateLimit = {"status":"ok","mode":"per_client"}`.
2. From A, exhaust the `evaluate` bucket (10 POSTs). The 11th must be 429. A concurrent
   `evaluate` POST from B must be 200.
3. Confirm one instance (`numInstances: 1`). With more instances the in-memory limit
   multiplies; record the instance count with the result.

**Pass:** both conditions hold and the health report says `per_client`.

## 4. Off-provider DB backup and raw restore drill (D1: RPO 24 h, RTO 4 h)

Authorization: the owner starts the backup workflow and creates the separate recovery
database, which is a paid resource. Follow DEPLOY_RENDER steps 7 to 11. Timing rules:

| Measure | Definition | Target |
|---|---|---|
| RPO | `incident_at` minus `snapshot_at` of the newest **off-provider** archive that the recovery actually used | at most 24 h (schedule is every 12 h) |
| RTO | From `incident_at` (the operator declares the drill incident) to the moment the recovery web process answers `/api/health` 200 with `database: ok` on the restored DB, and the comparison report shows zero mismatches | at most 4 h |

Steps:

1. Record `incident_at` (UTC) in the drill log. Do not touch production data.
2. List the off-provider bucket **from a machine outside Render**. This proves the archive
   left the provider. Pick the newest `daily/<archive>.manifest.json` and record its
   `snapshot_at`.
3. Provision an empty recovery Postgres 17. Use a different instance from production, and
   preferably a different provider or account for the off-provider claim.
4. Restore preview, then `--execute --report <private-report.json>` (step 9 commands).
   Apply `roles.sql`, then create fresh `civic_web` and `civic_loader` logins on the
   recovery DB.
5. Run the record comparison with `--web-base-url` against a recovery web process that uses
   the recovery `civic_web` login. Confirm the attestation line `outcome:"accept"`.
6. Raw evidence: run `pnpm exec tsx scripts/backup/raw.ts restore --manifest
   raw/<archive>/manifest.json --target <new-dir>`, then `--execute` it. Then
   spot-check that 3 `ingest_run.snapshot_locator` values (0006) resolve to restored
   files whose checksums match the run's `snapshot_checksum`.
7. Record the data size, backup duration, restore duration, comparison duration, total RTO
   and RPO.

**Pass:** zero mismatches, all three snapshot locators verified, RPO at most 24 h, RTO at
most 4 h, and every step was done from written instructions without improvising.
**Fail:** any mismatch, an unverifiable locator, or a breached target. File an incident
using OPERATIONS severity.

## 5. Read-only credential attestation on the hosted database (this branch)

1. On staging, with the correct `civic_web` URL, the startup log shows
   `db.readonly_attestation` with `outcome:"accept"`, `problems:[]` and `warnings:[]`.
2. Negative, staging only, owner present: set `DATABASE_URL_READONLY` to the `civic_loader`
   URL. Do **not** use the owner URL; the loader already has DML. Deploy. Render must report
   the deploy as failed: the process exits 1 with
   `refusing to start: database configuration` and `writable_relations`. The previous
   deploy must keep serving. Then restore the `civic_web` URL.
3. Search the logs for the loader's user name and password. There must be 0 hits (the
   attestation logs codes only).

**Pass:** steps 1 and 3 hold, and the failed deploy never served a request.

## 6. Alert receipt with deduplication and a recovery event (A69)

Authorization: **human-only**. The owner authorizes delivery, and the owner submits the
issue.

1. Point a monitor run at the staging URL while staging is stopped (or suspended): run
   `pnpm exec tsx scripts/monitor/cli.ts --out <drafts>` with `CIVIC_SITE_URL=<staging>`.
   The draft list must include one downtime finding with `action:create` and a stable
   fingerprint.
2. The owner reviews the draft. Refresh the open `civic-ops` issues, then submit it with
   `gh api --method POST 'repos/{owner}/{repo}/issues' --input <reviewed-issue.json>`.
3. **Receipt:** the owner shows the GitHub notification (email or mobile) and records its
   timestamp. Receipt latency is the notification time minus the submit time.
4. **Dedup:** while staging is still down, rerun the monitor. The same fingerprint must now
   be `action:already_open`, and no second issue may be created.
5. **Recovery:** resume staging. Rerun the monitor. The downtime finding must be gone and
   `digest.md` must show the passing liveness and readiness probes (the recovery event). The
   owner comments on and closes the issue (recovery does not auto-close, by design).

**Pass:** one issue, receipt confirmed by the owner within 15 min, no duplicate, recovery
digest recorded, and the issue closed with a recovery comment. The draft JSON contains no
provider error text.

## 7. Log retention and access

Target (OPERATIONS "Logs"): seven days of ordinary logs, and 30 days of selected incident
metadata.

1. Record the Render plan's documented log retention for the chosen workspace plan, from
   Render's documentation or dashboard on the day of the check (do not assume a value).
2. If it is under 7 days, the owner configures a log stream (syslog/HTTP drain) to a
   store with 7-day retention and access limited to the owner. That store is a new
   account and needs owner authorization.
3. Make 3 identifiable requests with `X-Request-Id: acceptance-<date>-<n>`.
4. After at least 7 days, find all 3 by request id in the retained store. Confirm that
   the lines carry `requestId`, `capability`, `status` and `durationMs`, with no headers,
   client addresses or query strings.
5. Incident metadata: copy the request ids, timestamps and SQLSTATE codes of one drill
   incident into the incident issue (section 6). That issue is the 30-day record.

**Pass:** all 3 request ids are retrievable at 7 days or later. Searches for `postgres://`,
`password` and `authorization` return 0 hits. Only the owner has access.

## 8. Proposed branch ruleset for `main` (owner applies)

Read-only check on 2026-10-19: `main` is `protected: false` with 0 rulesets. Required
check contexts are the job ids of `.github/workflows/ci.yml` (`secret-scan`, `check`,
`audit`, `postgres`, `e2e`, `rollback`) and `agent-parity.yml` (`parity`). `integration_id`
15368 is GitHub Actions, so a status posted by another app cannot satisfy a check.

```json
{
  "name": "main: CI, parity, PR, no force-push",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request" }
  ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "secret-scan", "integration_id": 15368 },
          { "context": "check", "integration_id": 15368 },
          { "context": "audit", "integration_id": 15368 },
          { "context": "postgres", "integration_id": 15368 },
          { "context": "e2e", "integration_id": 15368 },
          { "context": "rollback", "integration_id": 15368 },
          { "context": "parity", "integration_id": 15368 }
        ]
      }
    }
  ]
}
```

How to apply it (owner only):
`gh api --method POST repos/Zacharon/civic-ledger/rulesets --input main-ruleset.json`.
Afterwards, verify with `gh api repos/Zacharon/civic-ledger/rulesets` and with a test PR
whose checks are pending: the merge button must stay blocked.

Design notes for the owner to decide:

- **Single maintainer.** With one approval required, the owner cannot approve their own
  PR. The bypass actor (`RepositoryRole` 5 = admin, `bypass_mode: "pull_request"`) lets an
  admin merge their own PR. It does not allow pushing directly or force-pushing. To require
  a second human instead, remove `bypass_actors`. To keep PRs without reviews, set
  `required_approving_review_count` to 0.
- **Job names.** If a workflow's job ids are renamed, the rule blocks every merge until it
  is updated. Re-check the contexts against a recent PR's checks list before applying.
- **Strict policy.** Branches must be up to date with `main` before merging, which means
  more CI reruns. That is acceptable at the current PR volume.
