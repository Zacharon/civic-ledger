-- Evidence trust (docs/evidence/evidence-trust-20261019-contract.md). Additive only:
-- * ingest_check: successful upstream checks that found the current publication unchanged;
--   the publication receipt (ingest_run) is never rewritten by a recheck.
-- * ingest_run.snapshot_locator: the immutable raw-evidence location of a run (null = pre-0009).
-- * ideology_score.provisional: source-stated provisional flag (null = unknown until reprocessed).
CREATE TABLE "ingest_check" (
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
ALTER TABLE "ingest_run" ADD COLUMN "snapshot_locator" text;--> statement-breakpoint
ALTER TABLE "ideology_score" ADD COLUMN "provisional" boolean;--> statement-breakpoint
ALTER TABLE "ingest_check" ADD CONSTRAINT "ingest_check_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_check" ADD CONSTRAINT "ingest_check_publication_run_id_ingest_run_id_fk" FOREIGN KEY ("publication_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_check_source_scope_idx" ON "ingest_check" USING btree ("source_id","scope","checked_at");--> statement-breakpoint
CREATE INDEX "ingest_check_publication_run_idx" ON "ingest_check" USING btree ("publication_run_id");