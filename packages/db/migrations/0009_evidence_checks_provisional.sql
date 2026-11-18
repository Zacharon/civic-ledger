-- Evidence trust (docs/evidence/evidence-trust-20261019-contract.md). Additive only:
-- * ingest_check: successful upstream checks that found the current publication unchanged;
--   the publication receipt (ingest_run) is never rewritten by a recheck.
-- * ingest_run.snapshot_locator: the immutable raw-evidence location of a run (null = pre-0009).
-- * ideology_score.provisional: source-stated provisional flag (null = unknown until reprocessed).
--
-- Every statement is guarded (IF NOT EXISTS, or a pg_constraint check for the foreign keys)
-- because this file was the evidence-trust branch's own 0006, with identical DDL. A database
-- that applied that 0006 already has these objects; drizzle replays this file there as 0009
-- (its journal `when` is newer than that database's last migration), and unguarded DDL
-- failed with 42P07 and rolled back every pending migration. On a database without them,
-- the guards change nothing: the same objects are created (test-pg/migrations-branch-0006).
-- Guards trust names, so the last statement verifies every object by definition and raises
-- (rolling the whole migration back) if a same-name object differs.
CREATE TABLE IF NOT EXISTS "ingest_check" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingest_check_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" text NOT NULL,
	"scope" text NOT NULL,
	"adapter_version" text NOT NULL,
	"outcome" text DEFAULT 'unchanged' NOT NULL,
	"snapshot_checksum" text NOT NULL,
	"publication_run_id" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingest_run" ADD COLUMN IF NOT EXISTS "snapshot_locator" text;--> statement-breakpoint
ALTER TABLE "ideology_score" ADD COLUMN IF NOT EXISTS "provisional" boolean;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ingest_check'::regclass AND conname = 'ingest_check_source_id_source_id_fk') THEN
		ALTER TABLE "ingest_check" ADD CONSTRAINT "ingest_check_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ingest_check'::regclass AND conname = 'ingest_check_publication_run_id_ingest_run_id_fk') THEN
		ALTER TABLE "ingest_check" ADD CONSTRAINT "ingest_check_publication_run_id_ingest_run_id_fk" FOREIGN KEY ("publication_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingest_check_source_scope_idx" ON "ingest_check" USING btree ("source_id","scope","checked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingest_check_publication_run_idx" ON "ingest_check" USING btree ("publication_run_id");
--> statement-breakpoint
DO $$
DECLARE
	problems text[] := '{}';
	got text;
BEGIN
	SELECT string_agg(column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') || ' ' || coalesce(identity_generation, ''), ', ' ORDER BY ordinal_position)
		INTO got FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ingest_check';
	IF got IS DISTINCT FROM 'id integer NO  ALWAYS, source_id text NO  , scope text NO  , adapter_version text NO  , outcome text NO ''unchanged''::text , snapshot_checksum text NO  , publication_run_id integer NO  , started_at timestamp with time zone NO  , checked_at timestamp with time zone NO now() ' THEN
		problems := problems || ('ingest_check columns are ' || coalesce(got, 'missing'));
	END IF;
	IF pg_get_serial_sequence('public.ingest_check', 'id') IS DISTINCT FROM 'public.ingest_check_id_seq' THEN
		problems := problems || 'ingest_check.id is not the identity of ingest_check_id_seq'::text;
	END IF;
	SELECT pg_get_constraintdef(oid) INTO got FROM pg_constraint WHERE conrelid = 'public.ingest_check'::regclass AND contype = 'p';
	IF got IS DISTINCT FROM 'PRIMARY KEY (id)' THEN
		problems := problems || ('ingest_check primary key is ' || coalesce(got, 'missing'));
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = 'ingest_check_source_id_source_id_fk'
		AND c.conrelid = 'public.ingest_check'::regclass AND c.contype = 'f' AND c.confrelid = 'public.source'::regclass
		AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.ingest_check'::regclass AND attname = 'source_id')]
		AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.source'::regclass AND attname = 'id')]
		AND c.confupdtype = 'a' AND c.confdeltype = 'a' AND c.confmatchtype = 's') THEN
		problems := problems || 'ingest_check_source_id_source_id_fk is not FOREIGN KEY (source_id) REFERENCES public.source(id)'::text;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = 'ingest_check_publication_run_id_ingest_run_id_fk'
		AND c.conrelid = 'public.ingest_check'::regclass AND c.contype = 'f' AND c.confrelid = 'public.ingest_run'::regclass
		AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.ingest_check'::regclass AND attname = 'publication_run_id')]
		AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.ingest_run'::regclass AND attname = 'id')]
		AND c.confupdtype = 'a' AND c.confdeltype = 'a' AND c.confmatchtype = 's') THEN
		problems := problems || 'ingest_check_publication_run_id_ingest_run_id_fk is not FOREIGN KEY (publication_run_id) REFERENCES public.ingest_run(id)'::text;
	END IF;
	SELECT indexdef INTO got FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ingest_check_source_scope_idx';
	IF got IS DISTINCT FROM 'CREATE INDEX ingest_check_source_scope_idx ON public.ingest_check USING btree (source_id, scope, checked_at)' THEN
		problems := problems || ('ingest_check_source_scope_idx is ' || coalesce(got, 'missing'));
	END IF;
	SELECT indexdef INTO got FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ingest_check_publication_run_idx';
	IF got IS DISTINCT FROM 'CREATE INDEX ingest_check_publication_run_idx ON public.ingest_check USING btree (publication_run_id)' THEN
		problems := problems || ('ingest_check_publication_run_idx is ' || coalesce(got, 'missing'));
	END IF;
	SELECT data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') INTO got FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'ingest_run' AND column_name = 'snapshot_locator';
	IF got IS DISTINCT FROM 'text YES ' THEN
		problems := problems || ('ingest_run.snapshot_locator is ' || coalesce(got, 'missing'));
	END IF;
	SELECT data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') INTO got FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'ideology_score' AND column_name = 'provisional';
	IF got IS DISTINCT FROM 'boolean YES ' THEN
		problems := problems || ('ideology_score.provisional is ' || coalesce(got, 'missing'));
	END IF;
	IF cardinality(problems) > 0 THEN
		RAISE EXCEPTION '0009_evidence_checks_provisional: existing objects differ from this migration: %', array_to_string(problems, '; ')
			USING HINT = 'Drop or fix the listed objects (see packages/db/migrations/README.md), then migrate again.';
	END IF;
END $$;
