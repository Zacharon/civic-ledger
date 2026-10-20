CREATE TYPE "public"."portrait_variant" AS ENUM('225x275', '450x550');--> statement-breakpoint
CREATE TABLE "person_portrait" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "person_portrait_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"person_id" integer NOT NULL,
	"variant" "portrait_variant" NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"byte_length" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"origin_url" text NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "person_portrait_natural_key" UNIQUE("person_id","variant")
);
--> statement-breakpoint
ALTER TABLE "person_portrait" ADD CONSTRAINT "person_portrait_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_portrait" ADD CONSTRAINT "person_portrait_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_portrait" ADD CONSTRAINT "person_portrait_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_portrait_person_idx" ON "person_portrait" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "person_portrait_source_idx" ON "person_portrait" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "person_portrait_ingest_run_idx" ON "person_portrait" USING btree ("ingest_run_id");