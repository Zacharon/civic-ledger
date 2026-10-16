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
