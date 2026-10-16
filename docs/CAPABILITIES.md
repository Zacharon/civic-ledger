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
| `people.compare@1` | read | Compare page | `GET /api/v1/people.compare`, MCP `people_compare` |
| `explore.table@1` | read | Explore table (sort/filter/paginate) | `GET /api/v1/explore.table`, MCP `explore_table` |
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

`frameworks.evaluate` is stateless: the framework spec travels in the request
(or URL for the UI), so no stored user data exists.

## Write semantics (`ingest.run@1`)

- Input: `{ source, scope (cycle|congress), snapshotPath? }`; idempotency =
  `(source, adapterVersion, snapshotChecksum)`.
- Same key → returns the original `ingest_run` (no second load). Same source
  running → refused with `conflict: run_in_progress` (advisory lock).
- Receipt = the `ingest_run` row: actor (`operator`), operation, target source and
  scope, counts, checksum, before/after read-model refresh time, outcome, error.
- Partial failure: run marked `failed`, batches already committed are valid
  upserts; rerun converges. Read model refreshes only after success.

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
