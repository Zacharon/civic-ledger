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
| `votes.list@1` | read | Profile → Votes, Policy page (roll calls with "How each party voted") | `GET /api/v1/votes.list`, MCP `votes_list` |
| `votes.attendance@1` | read | Profile → Votes → Attendance by month (strip and table) | `GET /api/v1/votes.attendance`, MCP `votes_attendance` |
| `chamber.composition@1` | read | Home → Who serves now (House and Senate seat chart) | `GET /api/v1/chamber.composition`, MCP `chamber_composition` |
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

### Vote visuals (2026-10-20)

All three visuals read existing data only (no schema change); their numbers come from
these capabilities, so the page, `/api/v1` and MCP return the same values.

- **`votes.list@1` `byParty`** (extended, not a new capability). One row per party actually
  present in the roll call, each with yea / nay / present / not voting. Party = the member's
  party on their term at the vote date: the term in force on that date (inclusive end date,
  latest start wins on overlap); a position with no term in force takes the member's latest
  earlier term (a recorded last day can precede the member's last recorded vote); only a
  member with no earlier term is `Unknown`, listed last and labelled "Party not on file at the
  vote date". Rows are alphabetical by party name (no ideological or size order) and always
  sum to `tally` (tested, including overlapping terms). There is no `rollcalls.get` and no
  roll-call page here; another stream owns those.
- **`votes.attendance@1`** `{slug, congress?}` -> `months[]` of `{month, status, rollcallsHeld,
  eligible, missed, present, voted}`, `totals`, `chambers`, `throughMonth`, `definition`,
  `provenance`. `congress` defaults to the member's latest Congress with votes, the same one
  behind `person_card`. **Eligible** = the member's recorded positions in the Congress (yea,
  nay, present, not voting); **missed** = `not_voting`; **present** is separate and not missed.
  Totals equal `votesEligible` and `missedVoteRate` on `people.get` / `explore.table` (tested
  for every seeded member). Month status: `served` (any position on file), `no_votes_held`
  (serving, none held in the member's chamber), `not_yet_serving`, `no_longer_serving`,
  `not_serving` (gap), `no_record` (votes held while serving, none on file). Months run from
  January of the Congress's first year to the last month with a roll call on file.
- **`chamber.composition@1`** `{}` -> per chamber `seats` (435 / 100, fixed by law),
  `members` (voting, currently serving), `voting[]` and `nonVoting` (`total`, `parties[]`,
  `jurisdictions[]`), `vacancies` (seats minus voting members; `null` when fewer than 90% of
  the seats have a member on file, because that is a partial load and not vacancies), `asOf`,
  `provenance` (most recently loaded current term) and `definition`. Current means the
  member's latest term covers `asOf` (the same rule as the Explore `current` scope); the
  party is the party on that term. Delegates (AS, DC, GU, MP, VI) and Puerto Rico's Resident
  Commissioner are counted in `nonVoting`, never in the 435. Party order everywhere:
  Democrat, Independent, Republican (alphabetical among themselves), then every other party
  alphabetically by name; not by size and not by ideology.

All three are anonymous public reads with strict schemas, no writes, no approval step and no
idempotency key (gates 1-4 apply; gates 5-7 do not, there is no user data or external effect).

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
