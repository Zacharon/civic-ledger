# Civic Ledger public understanding and reliability program

Independent H3 VERIFIED the bounded local candidate. Main integration requires
upstream CI; consult the checks for the exact revision being integrated.
No launch claim.

## Scope and before state

Owner authorized the ten recommendations and continued implementation with subagents
on 2026-10-18. Baseline is reviewed main `8ff5592`. Three previous workers stopped
on a provider rate limit, leaving partial core, UI parity and backup edits. Those
bytes were captured in a local recovery snapshot before new workers began. No
previous feature stream had a completed commit. The name shortlist already exists
as an owner-decision proposal in the private project records.

The product needs a plain-language profile overview, understandable definitions,
member finding, complete UI/API/MCP value comparisons, actual import/restart proof,
bounded request handling, correlated safe diagnostics, app rollback proof, and
prepared hosting/backup/monitor commands. Real promises, platforms and frameworks
remain human-reviewed proposals, never agent-approved publications.

## Ownership

The parent integrates and owns shared capability/API/evidence/operations decisions.
Product worker owns core glance/explainers, profile overview, Methodology and a new
member-finder component. Parity worker owns remaining UI business-value hooks and
browser import/restart tests. Operations worker owns hosting blueprint, backup,
restore and monitor tooling. Parent owns server/runtime hardening. Content work
follows in a separate bounded worker after a slot is available.

Workers preserve their recovered edits and commit exact reconciled paths. No
worker merges, pushes, sends alerts, provisions accounts or deploys. The parent
has standing owner authorization to integrate reviewed code; editorial data
approval and hosting/deployment remain human gates.

## Planned acceptance evidence

- Shared capabilities: deterministic core overview/definitions used through the
  website, HTTP and MCP; rendered business values independently compared.
- Shared state: actual fixture import, read-model publication, all three surfaces,
  then web/MCP/database restart with retained values and receipts.
- Scoped authority: public read boundaries preserved, operator commands explicit,
  curated proposals require owner approval, scheduled effects disabled initially.
- Human usability: member finder, profile drilldowns and glossary usable by
  keyboard and narrow screens; CLI errors/action previews remain readable.
- Visible supervision: import receipts, backup manifests and alert previews.
- Safe recovery: body/response deadlines, real local backup/restore, rollback
  compatibility, safe retries and guarded retention; hosted drills NOT RUN.
- Receipts: source provenance, run IDs, operation metadata and dated check results.

Required checks: targeted before/after reproductions for attributed defects;
`pnpm check`, `pnpm test:pg`, full desktop/performance browser suite, changed mobile
flows, and an independent read-only H3 of the exact combined candidate. Historical
review failures remain in their original reports; this is new scoped feature work.

## Implemented result

- Profile overview and Methodology definitions use `people.glance@1` and
  `explainers.list@1` through the shared core registry. Home offers an ordinary
  state/district member finder; no address, private belief or motive is inferred.
- Rendered parity now includes Scores, Promises, Platform, Career, industry,
  outside spending, Policy, Sources and Home. The actual operator CLI publishes
  fictional curated data, retries the same snapshot, and all surfaces retain the
  same values after web, MCP and PostgreSQL restart.
- Production HTTP and page reads have explicit deadlines and safe request-correlated
  diagnostics. The previous app and client schemas have an executable rollback
  compatibility check against the candidate schema.
- Disabled Render/operations preparation includes encrypted database and raw-file
  archives, authenticated manifests, empty-target restoration, reviewed retention
  and incident/digest drafts. No workflow creates issues or sends notifications.
- A separate review-only content branch contains six platform proposals, eight
  dated unrated commitments and three attributed vote-set frameworks. Eighteen
  position candidates are held. Nothing was copied into the active curated root.
  Optional collector assessment admits no crawler dependency and starts no crawl.

Details: [product](product-glance-20261018.md),
[rendered parity and import/restart](parity-complete-20261018.md),
[server supervision](server-hardening-20261018.md),
[operations](ops-launch-20261018.md), and
[operator walkthrough](../DEPLOY_RENDER.md).

## Actual checks and negative history

Environment: Windows, Node 24.16.0, pnpm 11.13.1, Next 16.4.1, Chromium;
fictional PGlite/PostgreSQL fixtures unless explicitly called a real-data visual.

| Check | Actual result |
|---|---|
| New core/URL/definition focused tests | 46 PASS |
| HTTP/MCP parity and handler cache tests | 65 PASS |
| Full desktop/performance browser suite | 58 PASS, zero retries, 5.7 minutes |
| Focused 390 x 844 mobile flows | 3 PASS, first attempt, zero retries, 45.6 s: overview/source/definition keyboard paths, API-equal visible cards, no-script finder and overflow |
| 600-member performance fixture | Cold LCP 1636 ms, warm 940 ms, CLS 0 |
| Actual operator import/restart | PASS: 2 promises, 1 rating, 2 positions; same receipt on duplicate retry; persistent DB and new web/MCP processes retain public answers including glance |
| Real local encrypted PG dump/restore | PASS: 43 fictional people, 30 tables, 2 materialized views, 13 sampled capability answers, zero mismatches |
| Restore negatives | PASS: source/populated target refusal, changed business row detection, corrupt archive refusal, unpopulated view repair |
| Raw archive negatives | PASS: empty/duplicate contents roundtrip; unsafe paths, symlinks and source mutation refuse |
| Combined `pnpm check`, initial run | FAIL: 460 passed, one stale expected 13-name catalog; repaired by adding the two new public reads to the exact allowlist |
| Combined `pnpm test:pg`, initial run | FAIL: 67 passed, one missing glance slug in read-only fixture, one migration statement timeout (57014) while checks ran concurrently |
| Final `pnpm check` | PASS: lint, types, 56 files / 463 tests and production build; unchanged budgets, tests 310.36 s |
| Final-tree lint/types after test additions | PASS: full repository lint and all workspace TypeScript checks |
| Final `pnpm test:pg` | PASS: 9 files / 69 tests, 178.80 s, unchanged budgets |
| Integrated previous-app rollback | PASS: previous app/old schemas on candidate database, 13 legacy reads and old profile/Explore/Sources, 59.4 s |
| Real-data desktop/mobile visual collection | PASS: 12 routes, 24 screenshots, zero horizontal overflow and response timings from an isolated public-data snapshot, 1.4 minutes; no retries |
| Independent H3 | VERIFIED on `34d689c`: H1/H2/H3 PASS within bounded local implementation and operations preparation; three findings resolved, seven gates PASS local |

The first real-data visual used a copied public ingest database whose migrations
had not actually been applied: the CLI ignores `PGLITE_DATA_DIR`, while the web
adapter accepts it. Explicitly migrating the isolated copy fixed its missing
`ingest_run.note` column. The original source database was not edited. No application
fallback was added to conceal the setup error.

The next visual attempt failed with `ECONNRESET`. Independent socket instrumentation
reproduced the same error on database-free `/api/live`: a Playwright API client reused
a socket at the approximately six-second idle close boundary; fresh connections
returned 200. This supports, but does not prove, attribution of the earlier uninstrumented
failure. The collector now uses `Connection: close` for its API timing reads without
retries; browser navigation stays unchanged. Both earlier failures remain retained.

Original body-deadline/log-leak/sink-failure red tests and the visible-value negative
control remain retained. The SQLSTATE 57014 migration failure did not recur in two
sequential runs at unchanged limits. The first sequential run instead found five
upgrade-comparison failures after adding glance: all 120 changed property lines
were its top-level `asOf`, the read-model rebuild time. The comparator now excludes
exactly that clock, preserving source filing/retrieval dates and every business/
provenance field. The full next run passed 69/69. The original timeout remains
evidence; contention is the supported explanation, not a proven root cause.
No deadline or business assertion has been relaxed.

Local raw receipts live under ignored `.pglite/evidence/` and `apps/web/test-results/`;
the parent verification logs are named `civic-*20261018.txt` in the operator's
temporary directory. These local files are not transferred by a source merge.

## Seven-gate assessment of the bounded local candidate

Independent H3 verified this bounded local assessment on `34d689c`. It covers the
public product reads and the stated trusted-machine operator commands, not a
hosted service, editorial activation or verified operator identity.

| Gate | Local evidence and remaining scope |
|---|---|
| Shared capabilities | PASS local: 15 public reads share dispatch/validation; rendered comparisons cover all business sections. Human and agent operator invocations use the same guarded CLI handlers. |
| Shared state | PASS local: real CLI import, source receipts, read-model publication and web/MCP/Postgres restart retain equal answers. Backup comparison covers every public table/two views and 13 sampled capabilities; it does not separately sample the two new reads. |
| Scoped authority | PASS at local application boundary: anonymous reads only; operator tools remain private CLI commands, curated approval remains human-only. Credential possession is the operator boundary; a writable login mislabeled read-only is not detected. Hosted roles/IAM NOT RUN. |
| Human usability | PASS local automated core and 390px mobile flows; keyboard, scripts-disabled finder, visible cards/missing states, ordinary source/drilldown links and no horizontal overflow. Real-data desktop/mobile captures produced; changed Home/Glance views inspected. Real users and spoken screen-reader acceptance NOT RUN. |
| Visible supervision | PASS local: source ledger, backup manifests, explicit restore/retention previews and incident drafts. Monitor checks DB object sizes and first/last raw blob sizes only; it is not a full raw integrity or delivery check. |
| Safe recovery | PASS for tested local contracts: atomic ingest, duplicate receipt retrieval, controlled process restart, encrypted restore and negative guards. Restore is not blindly retryable: after uncertain success inspect the target or use a new empty DB. Hosted recovery/RPO/RTO and arbitrary Undo NOT RUN. |
| Receipts | PASS local: transactional ingest receipts, provenance run IDs, signed archive records, integrity reports and draft outcomes. Trace IDs are not mutation receipts or authenticated human identity. |

## Remaining gates

Render account/provisioning, actual plan sizing/costs, protected runner/environment,
off-provider transfer, hosted restore, proxy spoof/privilege checks, log retention,
independent uptime monitoring and actual owner notification receipt remain NOT RUN.
Production schedules remain disabled. The public name, source terms clearance and
exact curated approval list remain human decisions. Local tests do not close P4 or
the App Pre-Launch Gate.

The public-data preview uses an isolated copy of the October 16 ingest snapshot;
it is not a fresh nationwide ingest or a deployed service. The prepared Render pin
is Node 24.21.0, verified to exist in the official release index; local application
checks used Node 24.16.0. Runtime compatibility on the hosted pin remains NOT RUN.
The pre-existing dynamic-filesystem tracing build warning remains.

## Independent review

The read-only verifier inspected source, actual logs, import/restart and restore
receipts, final screenshots and canonical factual writeback. It independently
reproduced deadline/recovery, district-validation, public-read authority and pool
diagnostic negatives. Verdict: **VERIFIED for bounded local implementation and
operations preparation**. This does not certify P4, deployment or editorial activation.

Resolved review findings: H3NEW-01 additive catalog/role/upgrade fixture coverage
(including exact Glance rebuild-clock normalization); H3NEW-02 stable operator
capability names; H3NEW-03 raw background pool diagnostics, with committed red/green
tests and an independent canary recheck. The reviewer found no remaining implementation
objection in this scope. A documentation-only successor records the verdict and
clarifies hosted configuration and draft-only alerts; upstream CI remains required.
