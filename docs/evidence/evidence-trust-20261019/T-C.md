# T-C vote-time membership: evidence

Worker C. Branch `claude/vote-membership-20261019`, worktree
`_worktrees/Civic_Ledger/fix/vote-membership-20261019`. Base `76b74c3`.

## Commits

| Commit | Content |
|---|---|
| `dec6d58` | Red regressions `packages/core/test/vote-membership.test.ts` + `T-C-red.txt` |
| `2169a7a` | Core fix: `frameworks/membership.ts`, `capabilities/votes.ts`, `capabilities/frameworks.ts` (+ 2 green compatibility tests) |
| `a386a37` | Web: policy matrix, legend, tally check; frameworks filter note; web unit test; Playwright helper update |
| (this commit) | This file + `T-C-green.txt` |

## Leads confirmed

- F4a: `apps/web/app/policy/[area]/page.tsx` printed sr-only "Not a member at the time" for any cell with no stored vote. Confirmed and removed.
- F4b: `frameworks.evaluate` matched chamber/state/party on `person_card` (latest term). The policy matrix used it, so a House -> Senate mover vanished from the House matrix (red test 2: `invalid_input` for the new option; the v1 default still excludes the mover by design, asserted).
- F4c: `votes.list` tally left-joined every covering term with `count(*)`: one yea with two overlapping terms counted 5 instead of 4 and appeared under two parties (red tests 3 and 4).
- F4d: `rollcall.yea_count` / `nay_count` were never exposed or compared (red test 5).

## Red (base behaviour, test committed first)

`pnpm vitest run packages/core/test/vote-membership.test.ts` at `dec6d58` (code = base): **exit 1, 6 failed / 6**. Full output: [T-C-red.txt](T-C-red.txt). Key lines:

```
× 1 ... AssertionError: expected undefined to deeply equal [ 'yea', 'unavailable' ]
× 2 ... CapabilityError: Input failed validation            (people.basis did not exist)
× 3 ... expected [ { yea: 3, nay: +0, …(3) }, …(1) ] to deeply equal [ Array(2) ]   (Alpha 3 = Olive double-counted)
× 4 ... expected { yea: 5, nay: +0, present: +0, …(1) } to deeply equal { yea: 4, ... }
× 5 ... expected undefined to deeply equal { yea: 4, nay: +0 }   (no sourceTally)
× 6 ... expected undefined to deeply equal [ 'yea', 'nay', 'present', … ]   (no state enum)
```

## Green

| Check | Commit | Scope | Result |
|---|---|---|---|
| `pnpm vitest run` core vote-membership, votes, frameworks, dispatch; web policy-member-states, parity, openapi, handler; mcp index; ingest smoke | `a386a37` | 10 files, PGlite | PASS, 102/102, exit 0, no retries ([T-C-green.txt](T-C-green.txt)) |
| `pnpm vitest run --reporter=verbose` the two regression files | `a386a37` | 11 tests | PASS, exit 0 |
| `pnpm lint` | `a386a37` | repo | PASS, exit 0 |
| `pnpm typecheck` | `a386a37` | repo (incl. `next typegen`, e2e TS) | PASS, exit 0 |
| `pnpm test:pg`, `pnpm build`, Playwright, full `pnpm test` | n/a | n/a | NOT RUN (orchestrator) |

Regression map: 1 serving + missing record -> `unavailable`; 2 House -> Senate mover kept on `at_vote`; 3 party changer grouped by vote-time party (byParty) and `partyAtVote` vs current `person.party`; vote-time party filter; 4 overlapping terms -> one yea, `ambiguousTermPositions: 1`, `ambiguousTerm: true`, latest start wins; 5 `sourceTally` + `tallyCheck` differs (-1 yea); 6 core enum `MEMBER_VOTE_STATES` + web test (`apps/web/test/policy-member-states.test.ts`) that the legend, glyphs and labels are keyed by exactly the output-schema enum. Extra green: with no filters, `at_vote` and `current` give identical people/counts/votes on the seed; recorded `rollcallStates` equal `votes`; every seed rollcall reconciles with its source totals.

No existing assertion was relaxed. One legitimately changed e2e expectation: `checkPolicy` in `apps/web/e2e/support/supplemental-values.ts` expected the sr label "Not a member at the time" for any missing vote (the F4a defect); it now expects the API state's label, and calls the matrix with `basis: 'at_vote'` as the page does. `keyed()` gained an optional value-attribute argument (default unchanged).

## The rule (one definition, `packages/core/src/frameworks/membership.ts`)

Covering term: `term.start_date <= vote_date < coalesce(term.end_date, infinity)`. The vote-time term is exactly one covering term: one in an office of the rollcall's chamber first, then latest `start_date`, then highest `term.id`. Ambiguous = more than one covering term in the rollcall's chamber (or, with none there, more than one covering term at all). States: a stored position wins; with none, `not_serving` if no covering term in the rollcall's chamber, else `unavailable`. Used by both `votes.list` tallies and `frameworks.evaluate`.

## New / changed public fields (all additive; v1 defaults unchanged)

`frameworks.evaluate@1`
- input `people.basis?: 'current' | 'at_vote'` (default `'current'` = v1: chamber/state/party match the latest term, "people currently in ..."; `'at_vote'`: they match the vote-time term and a vote is kept only if cast while in that chamber/state/party). Note: the schema-level default for `people` is now `{ basis: 'current' }` instead of `{}` (same behaviour).
- output `peopleBasis: 'current' | 'at_vote'`.
- output `results[].rollcallStates[]: { ruleIndex, rollcall (key), state: 'yea'|'nay'|'present'|'not_voting'|'not_serving'|'unavailable', partyAtVote: string|null, ambiguousTerm: boolean }`, one per resolved rollcall in rule order.
- exports `MEMBER_VOTE_STATES`, `MemberVoteState`, `MemberVoteStateSchema` from `@civic-ledger/core`.

`votes.list@1` items
- `sourceTally: { yea, nay }` (rollcall yea_count / nay_count).
- `tallyCheck: { status: 'matches_source'|'differs_from_source', yeaDifference, nayDifference }` (reconstructed minus source).
- `ambiguousTermPositions: int`.
- Behaviour fix (no shape change): `tally` / `byParty` count each stored position once (F4c). `byParty` description updated.

Web (A62 hooks): `li[data-rollcall][data-source]` = `[sourceYea, sourceNay, status, ambiguousTermPositions]`; `[data-tally-check]`; matrix `tr[data-states]`; `td[data-state]`; legend `ul[aria-label=Legend] li[data-state]`.

## Proposed DECISIONS rows (orchestrator adds)

| A? | 2026-10-19 | Vote-time membership: a member's state on a rollcall is the stored position, else `not_serving` (no term in an office of the rollcall's chamber covers the vote date, `start <= date < coalesce(end, ∞)`), else `unavailable` (serving per terms, no stored record). Vote-time party/seat = one covering term (rollcall's chamber first, latest start date, highest id); more than one candidate is flagged (`ambiguousTerm`, `ambiguousTermPositions`), never multiplied. `frameworks.evaluate` gains `people.basis` (`current` default = v1 latest-term filters; `at_vote`); the policy matrix uses `at_vote` | Adopted (agent); fixes F4 | Absence of a record is not evidence of non-membership; historical matrices must keep members who later moved chamber; a tally must not double count. Additive per the compatibility rules. |
| A? | 2026-10-19 | `votes.list` reports `sourceTally` (rollcall yea/nay as recorded by the source) and `tallyCheck` beside the reconstructed tally; the policy page states a difference in words | Adopted (agent) | Coverage is visible (ARCHITECTURE §1.4). Expected sources of difference: missing positions, paired/announced votes stored as not voting (A17), withdrawn assertions (F3). |
| A62 amendment | 2026-10-19 | Adds `data-source`, `data-tally-check`, `data-state`, `data-states` | Adopted (agent, reversible) | Lets tests compare the new values with `/api/v1` and MCP. |

## Proposed CAPABILITIES text (orchestrator adds)

After the `frameworks.evaluate is stateless` paragraph:

> `frameworks.evaluate` `people` filters match the latest term by default (`basis: 'current'`, people currently in that chamber/state/party, all their votes). `basis: 'at_vote'` matches the term covering each rollcall's vote date and keeps only votes cast while in that chamber/state/party; the policy page's "How every member voted" uses it. Each result lists `rollcallStates` for every resolved rollcall: the stored position, `not_serving`, or `unavailable` (serving, no stored record), with the vote-time party. `votes.list` tallies are reconstructed from stored positions (each once, under one vote-time term) and are returned beside the source's own totals (`sourceTally`, `tallyCheck`).

## Shared-file edits (outside owned paths)

- `apps/web/e2e/support/supplemental-values.ts` (`checkPolicy`, `keyed`): needed because it asserted the F4a label. Not run.
- `apps/web/test/policy-member-states.test.ts`: new test file.

## Open risks

- Not run here: Playwright (`shared-values`, `a11y` on `/policy/health`, screenshots). The policy page gains a legend and one line per roll call, so screenshot baselines for policy pages may change. The seed has no mover/missing-record case, so the e2e check exercises recorded states and `matches_source` only; the historical cases are proven at core level.
- Matrix population is still "people with at least one stored vote on these roll calls". A serving member with no stored record on any of them does not appear as a row. Listing every serving member would need a term-based population query (possible follow-up).
- Real data: Voteview `yea_count` includes paired/announced yeas, which are stored as `not_voting` (A17), so `differs_from_source` will be common on real roll calls with pairs. That is the intended disclosure, but the wording may need tuning once seen on real data.
- `rollcallStates` adds a per-page query (page people × claimed rollcalls, lateral term lookup per pair). Bounded by limit ≤ 600 and the framework's rollcalls; `term_natural_key (person_id, office_id, start_date)` serves the lookup. Not measured on real Postgres (`test:pg` not run).
- `byParty` ordering is unchanged (SQL `order by party`), but the party for members with overlapping terms is now the latest-starting term's party, not both.
- Frameworks page filters keep current-basis semantics (now labelled); offering an `at_vote` toggle there is a product decision left open.
