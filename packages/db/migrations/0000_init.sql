CREATE TYPE "public"."aligned_position" AS ENUM('yea', 'nay');--> statement-breakpoint
CREATE TYPE "public"."framework_target_kind" AS ENUM('rollcall', 'bill');--> statement-breakpoint
CREATE TYPE "public"."promise_status" AS ENUM('kept', 'compromise', 'broken', 'in_progress', 'stalled', 'not_yet_rated');--> statement-breakpoint
CREATE TYPE "public"."candidacy_outcome" AS ENUM('won', 'lost', 'withdrew', 'pending');--> statement-breakpoint
CREATE TYPE "public"."chamber" AS ENUM('house', 'senate');--> statement-breakpoint
CREATE TYPE "public"."identifier_scheme" AS ENUM('bioguide', 'fec_candidate', 'icpsr', 'opensecrets', 'govtrack', 'openstates', 'wikidata');--> statement-breakpoint
CREATE TYPE "public"."office_level" AS ENUM('federal', 'state');--> statement-breakpoint
CREATE TYPE "public"."vote_position_value" AS ENUM('yea', 'nay', 'present', 'not_voting');--> statement-breakpoint
CREATE TYPE "public"."industry_coding_method" AS ENUM('curated', 'connected_org', 'name_rule');--> statement-breakpoint
CREATE TYPE "public"."support_oppose" AS ENUM('support', 'oppose');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('running', 'succeeded', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."terms_status" AS ENUM('not_reviewed', 'pending', 'cleared', 'declined');--> statement-breakpoint
CREATE TABLE "framework" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "framework_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"stated_orientation" text NOT NULL,
	"description" text NOT NULL,
	"methodology_url" text,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "framework_natural_key" UNIQUE("slug","version")
);
--> statement-breakpoint
CREATE TABLE "framework_rule" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "framework_rule_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"framework_id" integer NOT NULL,
	"target_kind" "framework_target_kind" NOT NULL,
	"rollcall_id" integer,
	"bill_id" integer,
	"aligned_position" "aligned_position" NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"rationale" text,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "framework_rule_natural_key" UNIQUE NULLS NOT DISTINCT("framework_id","rollcall_id","bill_id"),
	CONSTRAINT "framework_rule_one_target" CHECK (("framework_rule"."target_kind" = 'rollcall' and "framework_rule"."rollcall_id" is not null and "framework_rule"."bill_id" is null) or ("framework_rule"."target_kind" = 'bill' and "framework_rule"."bill_id" is not null and "framework_rule"."rollcall_id" is null))
);
--> statement-breakpoint
CREATE TABLE "platform_position" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "platform_position_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"person_id" integer NOT NULL,
	"cycle" integer NOT NULL,
	"policy_area_id" text NOT NULL,
	"stance" text NOT NULL,
	"source_url" text NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "platform_position_natural_key" UNIQUE("person_id","cycle","policy_area_id")
);
--> statement-breakpoint
CREATE TABLE "promise" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "promise_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"promise_key" text NOT NULL,
	"person_id" integer NOT NULL,
	"policy_area_id" text,
	"statement" text NOT NULL,
	"made_on" date,
	"source_url" text NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "promise_promise_key_unique" UNIQUE("promise_key")
);
--> statement-breakpoint
CREATE TABLE "promise_rating" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "promise_rating_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"promise_id" integer NOT NULL,
	"rater" text NOT NULL,
	"status" "promise_status" NOT NULL,
	"rated_on" date NOT NULL,
	"summary" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "promise_rating_natural_key" UNIQUE("promise_id","rater")
);
--> statement-breakpoint
CREATE TABLE "candidacy" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "candidacy_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"person_id" integer NOT NULL,
	"cycle" integer NOT NULL,
	"office_id" integer NOT NULL,
	"fec_candidate_id" text,
	"party" text NOT NULL,
	"outcome" "candidacy_outcome",
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "candidacy_natural_key" UNIQUE("person_id","cycle","office_id")
);
--> statement-breakpoint
CREATE TABLE "office" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "office_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"level" "office_level" NOT NULL,
	"chamber" "chamber" NOT NULL,
	"state" text NOT NULL,
	"district" integer,
	CONSTRAINT "office_natural_key" UNIQUE NULLS NOT DISTINCT("level","chamber","state","district")
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "person_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"full_name" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"birth_date" date,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "person_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "person_identifier" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "person_identifier_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"person_id" integer NOT NULL,
	"scheme" "identifier_scheme" NOT NULL,
	"value" text NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "person_identifier_natural_key" UNIQUE("scheme","value")
);
--> statement-breakpoint
CREATE TABLE "term" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "term_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"person_id" integer NOT NULL,
	"office_id" integer NOT NULL,
	"party" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "term_natural_key" UNIQUE("person_id","office_id","start_date")
);
--> statement-breakpoint
CREATE TABLE "bill" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bill_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"congress" integer NOT NULL,
	"bill_type" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"introduced_date" date,
	"sponsor_person_id" integer,
	"latest_action_text" text,
	"latest_action_date" date,
	"url" text NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bill_natural_key" UNIQUE("congress","bill_type","number")
);
--> statement-breakpoint
CREATE TABLE "bill_policy_area" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bill_policy_area_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"bill_id" integer NOT NULL,
	"policy_area_id" text NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bill_policy_area_natural_key" UNIQUE("bill_id","policy_area_id")
);
--> statement-breakpoint
CREATE TABLE "bill_subject" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bill_subject_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"bill_id" integer NOT NULL,
	"subject" text NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bill_subject_natural_key" UNIQUE("bill_id","subject")
);
--> statement-breakpoint
CREATE TABLE "policy_area" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "policy_area_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "rollcall" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rollcall_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"congress" integer NOT NULL,
	"chamber" "chamber" NOT NULL,
	"number" integer NOT NULL,
	"vote_date" date NOT NULL,
	"question" text NOT NULL,
	"description" text,
	"result" text NOT NULL,
	"yea_count" integer NOT NULL,
	"nay_count" integer NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rollcall_natural_key" UNIQUE("congress","chamber","number")
);
--> statement-breakpoint
CREATE TABLE "rollcall_bill" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rollcall_bill_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"rollcall_id" integer NOT NULL,
	"bill_id" integer NOT NULL,
	"is_final_passage" boolean DEFAULT false NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rollcall_bill_natural_key" UNIQUE("rollcall_id","bill_id")
);
--> statement-breakpoint
CREATE TABLE "vote_position" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vote_position_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"rollcall_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"position" "vote_position_value" NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vote_position_natural_key" UNIQUE("rollcall_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "candidate_cycle_totals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "candidate_cycle_totals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fec_candidate_id" text NOT NULL,
	"cycle" integer NOT NULL,
	"person_id" integer,
	"total_receipts_cents" bigint NOT NULL,
	"individual_cents" bigint NOT NULL,
	"unitemized_individual_cents" bigint,
	"other_committee_cents" bigint NOT NULL,
	"party_cents" bigint NOT NULL,
	"candidate_self_cents" bigint NOT NULL,
	"total_disbursements_cents" bigint NOT NULL,
	"cash_on_hand_cents" bigint NOT NULL,
	"debts_cents" bigint NOT NULL,
	"coverage_end_date" date,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "candidate_cycle_totals_natural_key" UNIQUE("fec_candidate_id","cycle")
);
--> statement-breakpoint
CREATE TABLE "committee" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "committee_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fec_committee_id" text NOT NULL,
	"name" text NOT NULL,
	"committee_type" text,
	"designation" text,
	"party" text,
	"connected_organization" text,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "committee_fec_committee_id_unique" UNIQUE("fec_committee_id")
);
--> statement-breakpoint
CREATE TABLE "committee_contribution" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "committee_contribution_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fec_sub_id" text NOT NULL,
	"committee_id" integer NOT NULL,
	"recipient_fec_candidate_id" text NOT NULL,
	"person_id" integer,
	"cycle" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"transaction_date" date,
	"transaction_type" text NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "committee_contribution_fec_sub_id_unique" UNIQUE("fec_sub_id")
);
--> statement-breakpoint
CREATE TABLE "committee_industry" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "committee_industry_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"committee_id" integer NOT NULL,
	"industry_id" text NOT NULL,
	"method" "industry_coding_method" NOT NULL,
	"confidence" double precision NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "committee_industry_natural_key" UNIQUE("committee_id")
);
--> statement-breakpoint
CREATE TABLE "committee_link" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "committee_link_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fec_candidate_id" text NOT NULL,
	"committee_id" integer NOT NULL,
	"cycle" integer NOT NULL,
	"designation" text,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "committee_link_natural_key" UNIQUE("fec_candidate_id","committee_id","cycle")
);
--> statement-breakpoint
CREATE TABLE "independent_expenditure" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "independent_expenditure_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"spender_fec_committee_id" text NOT NULL,
	"fec_transaction_id" text NOT NULL,
	"spender_committee_id" integer,
	"spender_name" text NOT NULL,
	"candidate_fec_id" text NOT NULL,
	"person_id" integer,
	"support_oppose" "support_oppose" NOT NULL,
	"cycle" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"expenditure_date" date,
	"purpose" text,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "independent_expenditure_natural_key" UNIQUE("spender_fec_committee_id","fec_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "industry" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sector" text NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_run" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingest_run_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" text NOT NULL,
	"adapter_version" text NOT NULL,
	"scope" text NOT NULL,
	"actor" text DEFAULT 'operator' NOT NULL,
	"status" "ingest_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"snapshot_checksum" text,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"read_model_refreshed_before" timestamp with time zone,
	"read_model_refreshed_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"license" text NOT NULL,
	"license_url" text,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideology_score" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ideology_score_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"person_id" integer NOT NULL,
	"congress" integer NOT NULL,
	"method" text NOT NULL,
	"dim1" double precision NOT NULL,
	"dim2" double precision,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ideology_score_natural_key" UNIQUE("person_id","congress","method")
);
--> statement-breakpoint
CREATE TABLE "scorecard_publisher" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"self_described_orientation" text NOT NULL,
	"terms_status" "terms_status" DEFAULT 'not_reviewed' NOT NULL,
	"url" text NOT NULL,
	"methodology_url" text NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scorecard_score" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scorecard_score_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"publisher_id" text NOT NULL,
	"person_id" integer NOT NULL,
	"year" integer NOT NULL,
	"score" double precision NOT NULL,
	"scale_min" double precision NOT NULL,
	"scale_max" double precision NOT NULL,
	"scale_label" text NOT NULL,
	"methodology_url" text NOT NULL,
	"source_id" text NOT NULL,
	"source_key" text NOT NULL,
	"ingest_run_id" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "scorecard_score_natural_key" UNIQUE("publisher_id","person_id","year")
);
--> statement-breakpoint
ALTER TABLE "framework" ADD CONSTRAINT "framework_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework" ADD CONSTRAINT "framework_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_rule" ADD CONSTRAINT "framework_rule_framework_id_framework_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."framework"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_rule" ADD CONSTRAINT "framework_rule_rollcall_id_rollcall_id_fk" FOREIGN KEY ("rollcall_id") REFERENCES "public"."rollcall"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_rule" ADD CONSTRAINT "framework_rule_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_rule" ADD CONSTRAINT "framework_rule_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_rule" ADD CONSTRAINT "framework_rule_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_position" ADD CONSTRAINT "platform_position_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_position" ADD CONSTRAINT "platform_position_policy_area_id_policy_area_id_fk" FOREIGN KEY ("policy_area_id") REFERENCES "public"."policy_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_position" ADD CONSTRAINT "platform_position_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_position" ADD CONSTRAINT "platform_position_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promise" ADD CONSTRAINT "promise_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promise" ADD CONSTRAINT "promise_policy_area_id_policy_area_id_fk" FOREIGN KEY ("policy_area_id") REFERENCES "public"."policy_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promise" ADD CONSTRAINT "promise_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promise" ADD CONSTRAINT "promise_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promise_rating" ADD CONSTRAINT "promise_rating_promise_id_promise_id_fk" FOREIGN KEY ("promise_id") REFERENCES "public"."promise"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promise_rating" ADD CONSTRAINT "promise_rating_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promise_rating" ADD CONSTRAINT "promise_rating_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidacy" ADD CONSTRAINT "candidacy_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidacy" ADD CONSTRAINT "candidacy_office_id_office_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."office"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidacy" ADD CONSTRAINT "candidacy_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidacy" ADD CONSTRAINT "candidacy_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_identifier" ADD CONSTRAINT "person_identifier_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_identifier" ADD CONSTRAINT "person_identifier_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_identifier" ADD CONSTRAINT "person_identifier_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term" ADD CONSTRAINT "term_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term" ADD CONSTRAINT "term_office_id_office_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."office"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term" ADD CONSTRAINT "term_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term" ADD CONSTRAINT "term_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_sponsor_person_id_person_id_fk" FOREIGN KEY ("sponsor_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_policy_area" ADD CONSTRAINT "bill_policy_area_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_policy_area" ADD CONSTRAINT "bill_policy_area_policy_area_id_policy_area_id_fk" FOREIGN KEY ("policy_area_id") REFERENCES "public"."policy_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_policy_area" ADD CONSTRAINT "bill_policy_area_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_policy_area" ADD CONSTRAINT "bill_policy_area_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_subject" ADD CONSTRAINT "bill_subject_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_subject" ADD CONSTRAINT "bill_subject_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_subject" ADD CONSTRAINT "bill_subject_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollcall" ADD CONSTRAINT "rollcall_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollcall" ADD CONSTRAINT "rollcall_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollcall_bill" ADD CONSTRAINT "rollcall_bill_rollcall_id_rollcall_id_fk" FOREIGN KEY ("rollcall_id") REFERENCES "public"."rollcall"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollcall_bill" ADD CONSTRAINT "rollcall_bill_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollcall_bill" ADD CONSTRAINT "rollcall_bill_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollcall_bill" ADD CONSTRAINT "rollcall_bill_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_position" ADD CONSTRAINT "vote_position_rollcall_id_rollcall_id_fk" FOREIGN KEY ("rollcall_id") REFERENCES "public"."rollcall"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_position" ADD CONSTRAINT "vote_position_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_position" ADD CONSTRAINT "vote_position_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_position" ADD CONSTRAINT "vote_position_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_cycle_totals" ADD CONSTRAINT "candidate_cycle_totals_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_cycle_totals" ADD CONSTRAINT "candidate_cycle_totals_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_cycle_totals" ADD CONSTRAINT "candidate_cycle_totals_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee" ADD CONSTRAINT "committee_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee" ADD CONSTRAINT "committee_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_contribution" ADD CONSTRAINT "committee_contribution_committee_id_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_contribution" ADD CONSTRAINT "committee_contribution_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_contribution" ADD CONSTRAINT "committee_contribution_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_contribution" ADD CONSTRAINT "committee_contribution_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_industry" ADD CONSTRAINT "committee_industry_committee_id_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_industry" ADD CONSTRAINT "committee_industry_industry_id_industry_id_fk" FOREIGN KEY ("industry_id") REFERENCES "public"."industry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_industry" ADD CONSTRAINT "committee_industry_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_industry" ADD CONSTRAINT "committee_industry_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_link" ADD CONSTRAINT "committee_link_committee_id_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_link" ADD CONSTRAINT "committee_link_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_link" ADD CONSTRAINT "committee_link_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "independent_expenditure" ADD CONSTRAINT "independent_expenditure_spender_committee_id_committee_id_fk" FOREIGN KEY ("spender_committee_id") REFERENCES "public"."committee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "independent_expenditure" ADD CONSTRAINT "independent_expenditure_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "independent_expenditure" ADD CONSTRAINT "independent_expenditure_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "independent_expenditure" ADD CONSTRAINT "independent_expenditure_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry" ADD CONSTRAINT "industry_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry" ADD CONSTRAINT "industry_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_run" ADD CONSTRAINT "ingest_run_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideology_score" ADD CONSTRAINT "ideology_score_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideology_score" ADD CONSTRAINT "ideology_score_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideology_score" ADD CONSTRAINT "ideology_score_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecard_publisher" ADD CONSTRAINT "scorecard_publisher_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecard_publisher" ADD CONSTRAINT "scorecard_publisher_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecard_score" ADD CONSTRAINT "scorecard_score_publisher_id_scorecard_publisher_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."scorecard_publisher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecard_score" ADD CONSTRAINT "scorecard_score_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecard_score" ADD CONSTRAINT "scorecard_score_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecard_score" ADD CONSTRAINT "scorecard_score_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "framework_source_idx" ON "framework" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "framework_ingest_run_idx" ON "framework" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "framework_rule_rollcall_idx" ON "framework_rule" USING btree ("rollcall_id");--> statement-breakpoint
CREATE INDEX "framework_rule_bill_idx" ON "framework_rule" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "framework_rule_source_idx" ON "framework_rule" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "framework_rule_ingest_run_idx" ON "framework_rule" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "platform_position_policy_area_idx" ON "platform_position" USING btree ("policy_area_id");--> statement-breakpoint
CREATE INDEX "platform_position_source_idx" ON "platform_position" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "platform_position_ingest_run_idx" ON "platform_position" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "promise_person_idx" ON "promise" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "promise_policy_area_idx" ON "promise" USING btree ("policy_area_id");--> statement-breakpoint
CREATE INDEX "promise_source_idx" ON "promise" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "promise_ingest_run_idx" ON "promise" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "promise_rating_source_idx" ON "promise_rating" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "promise_rating_ingest_run_idx" ON "promise_rating" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "candidacy_office_idx" ON "candidacy" USING btree ("office_id");--> statement-breakpoint
CREATE INDEX "candidacy_fec_candidate_idx" ON "candidacy" USING btree ("fec_candidate_id");--> statement-breakpoint
CREATE INDEX "candidacy_source_idx" ON "candidacy" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "candidacy_ingest_run_idx" ON "candidacy" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "person_source_idx" ON "person" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "person_ingest_run_idx" ON "person" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "person_identifier_person_idx" ON "person_identifier" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "person_identifier_source_idx" ON "person_identifier" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "person_identifier_ingest_run_idx" ON "person_identifier" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "term_office_idx" ON "term" USING btree ("office_id");--> statement-breakpoint
CREATE INDEX "term_source_idx" ON "term" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "term_ingest_run_idx" ON "term" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "bill_sponsor_idx" ON "bill" USING btree ("sponsor_person_id");--> statement-breakpoint
CREATE INDEX "bill_source_idx" ON "bill" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "bill_ingest_run_idx" ON "bill" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "bill_policy_area_policy_area_idx" ON "bill_policy_area" USING btree ("policy_area_id");--> statement-breakpoint
CREATE INDEX "bill_policy_area_source_idx" ON "bill_policy_area" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "bill_policy_area_ingest_run_idx" ON "bill_policy_area" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "bill_subject_source_idx" ON "bill_subject" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "bill_subject_ingest_run_idx" ON "bill_subject" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "rollcall_vote_date_idx" ON "rollcall" USING btree ("vote_date");--> statement-breakpoint
CREATE INDEX "rollcall_source_idx" ON "rollcall" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "rollcall_ingest_run_idx" ON "rollcall" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "rollcall_bill_bill_idx" ON "rollcall_bill" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "rollcall_bill_source_idx" ON "rollcall_bill" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "rollcall_bill_ingest_run_idx" ON "rollcall_bill" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "vote_position_person_idx" ON "vote_position" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "vote_position_source_idx" ON "vote_position" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "vote_position_ingest_run_idx" ON "vote_position" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "candidate_cycle_totals_person_idx" ON "candidate_cycle_totals" USING btree ("person_id","cycle");--> statement-breakpoint
CREATE INDEX "candidate_cycle_totals_source_idx" ON "candidate_cycle_totals" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "candidate_cycle_totals_ingest_run_idx" ON "candidate_cycle_totals" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "committee_source_idx" ON "committee" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "committee_ingest_run_idx" ON "committee" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "committee_contribution_committee_idx" ON "committee_contribution" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "committee_contribution_person_idx" ON "committee_contribution" USING btree ("person_id","cycle");--> statement-breakpoint
CREATE INDEX "committee_contribution_recipient_idx" ON "committee_contribution" USING btree ("recipient_fec_candidate_id","cycle");--> statement-breakpoint
CREATE INDEX "committee_contribution_source_idx" ON "committee_contribution" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "committee_contribution_ingest_run_idx" ON "committee_contribution" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "committee_industry_industry_idx" ON "committee_industry" USING btree ("industry_id");--> statement-breakpoint
CREATE INDEX "committee_industry_source_idx" ON "committee_industry" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "committee_industry_ingest_run_idx" ON "committee_industry" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "committee_link_committee_idx" ON "committee_link" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "committee_link_source_idx" ON "committee_link" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "committee_link_ingest_run_idx" ON "committee_link" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "independent_expenditure_spender_idx" ON "independent_expenditure" USING btree ("spender_committee_id");--> statement-breakpoint
CREATE INDEX "independent_expenditure_person_idx" ON "independent_expenditure" USING btree ("person_id","cycle");--> statement-breakpoint
CREATE INDEX "independent_expenditure_candidate_idx" ON "independent_expenditure" USING btree ("candidate_fec_id","cycle");--> statement-breakpoint
CREATE INDEX "independent_expenditure_source_idx" ON "independent_expenditure" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "independent_expenditure_ingest_run_idx" ON "independent_expenditure" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "industry_source_idx" ON "industry" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "industry_ingest_run_idx" ON "industry" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "ingest_run_source_started_idx" ON "ingest_run" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX "ingest_run_dedupe_idx" ON "ingest_run" USING btree ("source_id","adapter_version","snapshot_checksum");--> statement-breakpoint
CREATE INDEX "ideology_score_source_idx" ON "ideology_score" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "ideology_score_ingest_run_idx" ON "ideology_score" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "scorecard_publisher_source_idx" ON "scorecard_publisher" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "scorecard_publisher_ingest_run_idx" ON "scorecard_publisher" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "scorecard_score_person_idx" ON "scorecard_score" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "scorecard_score_source_idx" ON "scorecard_score" USING btree ("source_id","source_key");--> statement-breakpoint
CREATE INDEX "scorecard_score_ingest_run_idx" ON "scorecard_score" USING btree ("ingest_run_id");