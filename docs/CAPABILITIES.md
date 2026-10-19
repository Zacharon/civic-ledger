# Capability contract

Applies the owner's human-usable / agent-native feature standard
(vault `00_SYSTEM/AGENT_NATIVE_HUMAN_USABLE_STANDARD.md`). Every capability is one
handler in `packages/core`, registered in `packages/core/src/capabilities/registry.ts`
with a stable name, version, zod input/output schema and read/write class. The web
UI, `/api/v1` and the MCP server all dispatch through that registry.

## Principal model (v1)

- **Public reader** (anonymous human or agent): all `read` capabilities. Rate
  limited per IP (API) / per MCP session. No elevated rights from any input.
- **Operator** (owner, CLI on a trusted machine with DB credentials): ingest runs.
- **Curator** (anyone, human or agent): proposes curated data by editing
  `data/curated/**` on a branch. **Approval is human-only**: the owner merges.
  `pnpm curate:validate` runs the same zod schemas the loader uses.

There are no user accounts in v1. The system does not claim to verify identity
for public reads; it does not need to.

## Capabilities

| Name@version | Class | Human control | Agent invocation |
|---|---|---|---|
| `people.search@1` | read | Search box, Explore filters | `GET /api/v1/people.search`, MCP `people_search` |
| `people.get@1` | read | Profile page | `GET /api/v1/people.get`, MCP `people_get` |
| `people.glance@1` | read | Profile overview and its evidence links | `GET /api/v1/people.glance`, MCP `people_glance` |
| `explainers.list@1` | read | Methodology definitions and profile explanations | `GET /api/v1/explainers.list`, MCP `explainers_list` |
| `people.compare@1` | read | Compare page | `GET /api/v1/people.compare`, MCP `people_compare` |
| `explore.table@1` | read | Explore table (sort/filter/paginate; scope current by default, or all incl. former members) | `GET /api/v1/explore.table`, MCP `explore_table` |
| `explore.facets@1` | read | Explore filter options (states, parties, chambers, scope counts, per-field data coverage) | `GET /api/v1/explore.facets`, MCP `explore_facets` |
| `money.summary@1` | read | Profile → Money | `GET /api/v1/money.summary`, MCP `money_summary` |
| `votes.list@1` | read | Profile → Votes, Policy page | `GET /api/v1/votes.list`, MCP `votes_list` |
| `scores.list@1` | read | Profile → Scores | `GET /api/v1/scores.list`, MCP `scores_list` |
| `promises.list@1` | read | Profile → Promises | `GET /api/v1/promises.list`, MCP `promises_list` |
| `policy.areas@1` | read | Policy nav | `GET /api/v1/policy.areas`, MCP `policy_areas` |
| `frameworks.list@1` | read | Frameworks page | `GET /api/v1/frameworks.list`, MCP `frameworks_list` |
| `frameworks.evaluate@1` | read (pure compute) | Frameworks builder | `POST /api/v1/frameworks.evaluate`, MCP `frameworks_evaluate` |
| `sources.status@1` | read | Sources page, footer freshness | `GET /api/v1/sources.status`, MCP `sources_status` |
| `ingest.run@1` | write (operator) | `pnpm ingest <source>` | Same CLI; not exposed on public API/MCP |
| `curated.validate@1` | read | `pnpm curate:validate` | Same CLI |
| `ops.backup@1` | write (operator) | `pnpm exec tsx scripts/backup/cli.ts backup` | Same trusted-machine CLI |
| `ops.restore@1` | write (operator; preview default) | Backup CLI `restore --manifest <key> --target-database <name>`, then reviewed `--execute` | Same CLI, never public |
| `ops.retention@1` | write (operator; preview default) | Backup CLI `retention`, then reviewed `--execute` | Same CLI, authenticated archive keys only |
| `ops.raw.archive@1` | write (operator) | `pnpm exec tsx scripts/backup/raw.ts backup` | Same CLI, explicit persistent root |
| `ops.raw.restore@1` | write (operator; preview default) | Raw archive CLI `restore` into a new directory | Same CLI, never overwrite an existing target |
| `ops.monitor@1` | local draft | `pnpm exec tsx scripts/monitor/cli.ts` | Same CLI; incident JSON/digest, no issue send |

`frameworks.evaluate` is stateless: the framework spec travels in the request
(or URL for the UI), so no stored user data exists.

The Home member finder submits ordinary GET filters to Explore. State, district
and chamber use `explore.table` and `explore.facets`; there is no location lookup,
address collection or new private state. District zero means an at-large House
seat. A state-and-district result includes that state's senators.

`people.glance` accepts a person slug and returns deterministic sentences, typed
facts, source provenance and drilldown links from the existing core capabilities.
Each section retains its own FEC cycle, filing date or Congress. It describes
campaign receipts rather than personal income, and never infers beliefs or motives
from donations or votes. Missing coverage remains explicit. `explainers.list`
returns the same definitions rendered on Methodology; these are editorial
definitions, not stored claims about a person. Both are anonymous public reads,
with strict schemas, no writes, no approval step and no idempotency key required.

Operator backup, restore, retention and monitor commands are documented in
[DEPLOY_RENDER.md](DEPLOY_RENDER.md). They are trusted-machine CLI capabilities;
they are never registered as public HTTP or MCP tools. Their previews and receipts
do not authenticate an operator or grant permission to send an alert or provision
a service. Curated proposals outside `data/curated` are not loaded.

## Write semantics (`ingest.run@1`)

- Input: `{ source, scope (cycle|congress|all), snapshotPath?, forceReplay? }`;
  idempotency = `(source, adapterVersion, snapshotChecksum)`.
- Same key as the current generation (the latest successful run of that scope, a forced
  replay included) → returns that `ingest_run` (`deduplicated: true`, no second load), so
  a retry after a lost response is safe. Same key but superseded by a later run → refused
  (`failed`, `snapshot_superseded: ...`) unless `forceReplay`, which always loads it as a
  new run whose `replayOf` names the key's earliest run (DECISIONS A54). Same source running → refused with
  `conflict: run_in_progress` (advisory lock).
- Receipt = the `ingest_run` row: actor (`operator`), operation, target source and
  scope, counts, checksum, before/after read-model refresh time, outcome
  (`succeeded` / `failed` / `cancelled`), error, `note` (e.g. an overridden shrink guard),
  `replayOf`.
- Atomicity (DECISIONS A50): load, shrink guard, refresh of both read models and the
  `succeeded` receipt are one transaction. Any failure, cancellation (SIGINT or the run
  deadline, A52) or process loss before its commit rolls back every fact, both read models
  and the counts; the receipt says `failed` or `cancelled` (a dead process leaves `running`,
  later marked failed as abandoned). There are no partially committed batches; a rerun
  starts from the previous state. Written before the transaction: the source metadata row
  and the `running` receipt with its checksum.
- `sources.status@1` keeps its v1 status values: a `cancelled` run is reported as `failed`
  with an error starting `cancelled:`.

## Seven-gate evidence plan

| Gate | Read capabilities | `ingest.run` | Curated data |
|---|---|---|---|
| Shared capabilities | Test: UI loader, API route and MCP tool return equal payloads for the same input | CLI is the single entry | Loader and validator share schemas |
| Shared state | API and UI read the same `person_card`; test after re-ingest | Run visible in `sources.status` from UI, API, MCP | Merged YAML visible in all adapters after load |
| Scoped authority | Public reads only; MCP/API expose no write tool (test) | Requires DB credentials (operator only) | Human-only merge; agents cannot approve |
| Human usability | Keyboard nav, AI-free, readable errors (Playwright + axe) | CLI help + clear errors | Validator messages name file:line |
| Visible supervision | N/A — no delegated actions on reads | Run ledger shows running/failed/succeeded | PR diff is the proposal |
| Safe recovery | N/A — no effects | Idempotency + lock tests | Git revert |
| Receipts | N/A — no effects | `ingest_run` row tests | Git history |
