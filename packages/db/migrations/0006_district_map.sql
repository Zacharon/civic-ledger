CREATE TABLE "district_map" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "district_map_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"state" text NOT NULL,
	"state_name" text NOT NULL,
	"district" integer,
	"view_box_width" integer NOT NULL,
	"view_box_height" integer NOT NULL,
	"path" text NOT NULL,
	"vintage" text NOT NULL,
	"publisher" text NOT NULL,
	"as_of" date NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "district_map_natural_key" UNIQUE NULLS NOT DISTINCT("state","district")
);
--> statement-breakpoint
ALTER TABLE "district_map" ADD CONSTRAINT "district_map_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "district_map" ADD CONSTRAINT "district_map_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "district_map_source_idx" ON "district_map" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "district_map_ingest_run_idx" ON "district_map" USING btree ("ingest_run_id");