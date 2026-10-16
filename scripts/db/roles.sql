-- Least-privilege database roles (docs/OPERATIONS.md "Database roles", DECISIONS A44).
--
-- Run once per database, after `pnpm db:migrate`, as the role that owns the schema (the
-- role that runs migrations):
--
--   psql "$DATABASE_URL_OWNER" -v ON_ERROR_STOP=1 -f scripts/db/roles.sql
--
-- It creates two NOLOGIN group roles and grants them table privileges. It never sets a
-- password. Create the login roles yourself, with a password from your secret store, and
-- add them to a group:
--
--   create role civic_web login password '...' in role civic_readonly;
--   alter role civic_web set default_transaction_read_only = on;
--   create role civic_loader login password '...' in role civic_ingest;
--
-- Then point the processes at them:
--   web and MCP     DATABASE_URL_READONLY=postgres://civic_web:...@host/db
--   pnpm ingest     DATABASE_URL=postgres://civic_loader:...@host/db
--   pnpm db:migrate DATABASE_URL=<the owner role>
--
-- Safe to re-run: privileges are re-applied, roles are created only when missing.

do $$
begin
  if not exists (select from pg_roles where rolname = 'civic_readonly') then
    create role civic_readonly nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'civic_ingest') then
    create role civic_ingest nologin;
  end if;
end
$$;

do $$
begin
  execute format(
    'grant connect on database %I to civic_readonly, civic_ingest',
    current_database()
  );
end
$$;

-- Nobody but the owner creates objects in the application schema.
revoke create on schema public from public;
revoke create on schema public from civic_readonly, civic_ingest;
grant usage on schema public to civic_readonly, civic_ingest;

-- Read-only: every table, view and materialized view, current and future.
grant select on all tables in schema public to civic_readonly;
alter default privileges in schema public grant select on tables to civic_readonly;

-- Ingest: read and write rows; no DDL, no TRUNCATE, no TRIGGER, no REFERENCES.
grant select, insert, update, delete on all tables in schema public to civic_ingest;
grant usage, select on all sequences in schema public to civic_ingest;
alter default privileges in schema public
  grant select, insert, update, delete on tables to civic_ingest;
alter default privileges in schema public grant usage, select on sequences to civic_ingest;

-- REFRESH MATERIALIZED VIEW needs ownership before PostgreSQL 17, and the MAINTAIN
-- privilege from 17 on. On 16 or older, run ingest as the owner role instead (or
-- accept that the read model is refreshed by a separate owner-run step).
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'grant maintain on all tables in schema public to civic_ingest';
    execute 'alter default privileges in schema public grant maintain on tables to civic_ingest';
  else
    raise notice 'PostgreSQL % has no MAINTAIN privilege: civic_ingest cannot REFRESH MATERIALIZED VIEW; run ingest as the schema owner.',
      current_setting('server_version');
  end if;
end
$$;
