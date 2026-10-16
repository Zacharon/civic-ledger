ALTER TYPE "public"."industry_coding_method" ADD VALUE 'fec_code';--> statement-breakpoint
ALTER TABLE "rollcall" ADD COLUMN "session" integer;--> statement-breakpoint
ALTER TABLE "rollcall" ADD COLUMN "clerk_number" integer;--> statement-breakpoint
ALTER TABLE "committee" ADD COLUMN "organization_type" text;--> statement-breakpoint
CREATE INDEX "rollcall_clerk_idx" ON "rollcall" USING btree ("congress","chamber","session","clerk_number");