CREATE TABLE "candidate" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "candidate_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fec_candidate_id" text NOT NULL,
	"cycle" integer NOT NULL,
	"name_as_filed" text NOT NULL,
	"party_code" text,
	"election_year" integer NOT NULL,
	"office" text NOT NULL,
	"state" text NOT NULL,
	"district" integer,
	"incumbency" text,
	"status" text,
	"principal_committee_id" text,
	"person_id" integer,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "candidate_natural_key" UNIQUE("fec_candidate_id","cycle")
);
--> statement-breakpoint
ALTER TABLE "candidate" ADD CONSTRAINT "candidate_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate" ADD CONSTRAINT "candidate_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate" ADD CONSTRAINT "candidate_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_seat_idx" ON "candidate" USING btree ("cycle","office","state","district");--> statement-breakpoint
CREATE INDEX "candidate_person_idx" ON "candidate" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "candidate_source_idx" ON "candidate" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "candidate_ingest_run_idx" ON "candidate" USING btree ("ingest_run_id");