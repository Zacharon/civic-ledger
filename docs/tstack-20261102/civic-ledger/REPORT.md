# Tstack 03: embedded-server typecheck

Outcome: BLOCKED. No source change. Local-only report, not release acceptance.

## Identity and scope

- Worktree: `C:/Users/user/.t3/worktrees/Civic_Ledger/tstack-civic-ledger-20261102`.
- Clean initial HEAD/pinned base: `e884b6735a049dbe99bd5dabf72a07a68daba368`; branch `tstack/civic-ledger-20261102`.
- Remote: `https://github.com/Zacharon/civic-ledger.git`; configured identity Claude / claude@local. No commits made.
- Canonical checkout HEAD equals pinned base. No dirty canonical files copied.
- Cached origin/main is `5d1ef3f27907e37d012b81a6b7cee7388019f8b2`; merge-base `8f4a092aca1fa2c4be938cf3403f830690bedb57`. No fetch performed under local-only scope.
- Selection source: canonical NEXT_ACTIONS item 4f, read only.
- Existing local `claude/types-node-26-20261019` at `04be4fafdc6d0041f1f2ee20baa9e0c64ada8802` has the optional-chain fix and a types bump; merge-base with pinned HEAD is `92647184174312c9893f9bee0ff7985f05fff8a9`. Its fix is absent from the pinned source. This is static evidence, not current compiler proof.

## Evidence and blocker

Node v24.16.0, pnpm 11.13.1. No node_modules existed initially.
Root manifest requests @types/node ^24.19.2. Attempted root tsc triggered pnpm's automatic installation. Terminal output showed ERR_PNPM_ENOENT copying a Next acorn LICENSE from the local pnpm store; that initial output was not captured in the named log files. A temporary exact @types/node 26.6.5 install also failed with ENOENT for Vite package.json. The temporary install was started before the initial automatic installation finished; overlapping setup makes it unsuitable as reproduction evidence. package.json and pnpm-lock.yaml were restored byte-for-byte from pre-attempt copies. No dependency upgrade remains.

`pnpm exec tsc --noEmit -p tsconfig.json`: attempted, compiler NOT RUN successfully. TS2722 at 26.6.5 remains UNREPRODUCED, not superseded.

`pnpm check`: attempted, stalled in automatic dependency installation before lint; interrupted locally. Lint/typecheck/tests/build NOT RUN successfully. See check.log and types-install.log; reproduction.log preserves the incomplete second attempt.

Focused startup/cleanup runtime evidence: NOT RUN. A draft mock regression was removed without changing the entrypoint because the reproduction prerequisite failed. No database, ingest, migration, hosted, browser, human/device or H3 validation performed.

Source remains SHA256 `1D14148C5C097477376FAC25AE42D18ED3692C37CD3C978B4EF14BF462A1122F` for test-pg/embedded-server.ts. Static candidate is `if (process.connected) process.disconnect?.();`, preserving the connection guard, one-stop promise, and receiver binding while handling absent disconnect. This is a proposal only.

## Review ledger and usage

Implementation: Codex gpt-6.1-sol, medium effort. Reviewer: independent Codex gpt-6.1-sol, medium effort, one round. VERDICT APPROVE for blocked-report handoff only; no blocker or should findings. S1 (nit): initial Next/acorn failure was absent from the named logs. Disposition: clarified that it was terminal-only evidence; the retained Vite ENOENT log independently supports the installation blocker. Documentation-only clarification needs no new round. No nested reviewers. Source, manifest and lockfile diff verified empty by reviewer.

Input/output/cached/reasoning token counts: UNKNOWN. Elapsed task time: UNKNOWN (not measured). No efficiency claim.

No commit, push, PR, comment, deployment, publication, account/service change or governance change. A PR title/body is not proposed because there is no verified implementation to submit.

Next action: complete an isolated dependency installation, reproduce at exactly 26.6.5, apply and test the smallest guard if still failing, run pnpm check, then review that implementation. Existing project gates remain open.
