CREATE TABLE "candidate_cycle_summary" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "candidate_cycle_summary_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fec_candidate_id" text NOT NULL,
	"cycle" integer NOT NULL,
	"person_id" integer,
	"total_receipts_cents" bigint NOT NULL,
	"individual_cents" bigint NOT NULL,
	"itemized_individual_cents" bigint NOT NULL,
	"unitemized_individual_cents" bigint NOT NULL,
	"coverage_end_date" date,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "candidate_cycle_summary_natural_key" UNIQUE("fec_candidate_id","cycle")
);
--> statement-breakpoint
ALTER TABLE "candidate_cycle_summary" ADD CONSTRAINT "candidate_cycle_summary_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_cycle_summary" ADD CONSTRAINT "candidate_cycle_summary_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_cycle_summary" ADD CONSTRAINT "candidate_cycle_summary_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_cycle_summary_person_idx" ON "candidate_cycle_summary" USING btree ("person_id","cycle");--> statement-breakpoint
CREATE INDEX "candidate_cycle_summary_source_idx" ON "candidate_cycle_summary" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "candidate_cycle_summary_ingest_run_idx" ON "candidate_cycle_summary" USING btree ("ingest_run_id");