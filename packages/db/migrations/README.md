# Migrations

Forward-only SQL, applied in journal order by `pnpm db:migrate` (PGlite or Postgres).
Generate table changes with `pnpm db:generate`; write views and other hand SQL with
`pnpm --filter @civic-ledger/db exec drizzle-kit generate --custom --name <name>`.
Never edit a migration after it has been applied anywhere; add a new one.

Each migration records how to undo it by hand if a release must be rolled back.

| Migration | Change | Rollback note |
|---|---|---|
| `0000_init` | All fact, vocabulary and run-ledger tables, enums, natural-key constraints, FK indexes. | Empty database only: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` then re-run migrations. |
| `0001_person_card` | `person_card` and `person_card_scorecard` materialized views with sort/filter indexes. | `DROP MATERIALIZED VIEW person_card_scorecard; DROP MATERIALIZED VIEW person_card;` and delete the `0001` row from `drizzle.__drizzle_migrations`. No data loss (derived). |
| `0002_ingest_columns` | `rollcall.session` + `rollcall.clerk_number` (official clerk roll number; Voteview `rollnumber` stays in `number`) with a join index; `committee.organization_type` (FEC ORG_TP); `industry_coding_method` gains `fec_code`. | `DROP INDEX rollcall_clerk_idx; ALTER TABLE rollcall DROP COLUMN clerk_number, DROP COLUMN session; ALTER TABLE committee DROP COLUMN organization_type;` An enum value cannot be dropped in place: recreate the type without `fec_code` after deleting rows that use it. Delete the `0002` row from `drizzle.__drizzle_migrations`. |
| `0003_candidate_summary` | `candidate_cycle_summary` (FEC candidate summary: itemized / unitemized individual split, own coverage date) with natural key and person / provenance indexes. | `DROP TABLE candidate_cycle_summary;` after 0004 is rolled back; delete the `0003` row from `drizzle.__drizzle_migrations`. Data reloads from the next `fec-bulk` run. |
| `0004_person_card_scope_and_shares` | Rebuilds `person_card`: gross-based industry coverage, net-positive top industries, guarded receipt shares, small-dollar share from the candidate summary (`small_dollar_as_of`), `term_end` / `service_start` (+ index) for the current-member scope, `tenure_years` = years served. | Re-run the `CREATE MATERIALIZED VIEW person_card` block and its indexes from `0001_person_card.sql` after `DROP MATERIALIZED VIEW person_card;`, then refresh; delete the `0004` row from `drizzle.__drizzle_migrations`. No data loss (derived), but core ≥ this branch reads the new columns. |
| `0005_ingest_receipts_and_coverage` | `ingest_status` gains `cancelled`; `ingest_run.note`, `ingest_run.replay_of`; rebuilds `person_card` with a coalesced coded-coverage numerator (0, not null, when positive PAC money is all uncoded) and `refreshed_at = statement_timestamp()`. | `DROP MATERIALIZED VIEW person_card;` and re-run the `CREATE MATERIALIZED VIEW person_card` block and indexes from `0004`, then refresh; `ALTER TABLE ingest_run DROP COLUMN note, DROP COLUMN replay_of;` The `cancelled` enum value cannot be dropped in place (recreate the type after updating rows that use it). Delete the `0005` row from `drizzle.__drizzle_migrations`. Run with an app that predates 0005 only after rolling those back: older core cannot parse a `cancelled` receipt. |
