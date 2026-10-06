-- Survey contributions (contract v2, src/lib/contracts/survey.ts): three new
-- tables and one nullable column on scans. Candidate shape (未拍板).
--
-- Additive only: nothing existing is dropped or altered, and the one column
-- added to an existing table (scans.survey_contributed_at) is nullable with no
-- default, so code that predates this migration keeps reading and writing
-- scans unchanged. Migrate BEFORE deploying the code that uses it: the survey
-- routes and the account's "Delete everything" (which now withdraws the
-- person's contributions) fail until the tables exist.
--
-- One DO block, i.e. one statement, for the same reason as 0005 and 0006: the
-- neon-http migrator sends each statement as its own HTTP request with no
-- surrounding transaction, so a multi-statement migration that fails half-way
-- (the generated file has twenty statements) would leave tables without their
-- constraints and could not re-run. A single statement is atomic in Postgres.
-- Every step is guarded, so a re-run completes without error. The statements
-- are the ones drizzle-kit generated, only wrapped; tests/unit/survey-schema-db.test.ts
-- checks the tables, columns, constraints and indexes this builds against
-- drizzle/meta/0007_snapshot.json, so a hand edit cannot drift from the schema.
DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS "survey_contributions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" text,
    "consent_version" text NOT NULL,
    "consented_at" timestamp with time zone NOT NULL,
    "hand_length_bin_mm" smallint NOT NULL,
    "palm_width_bin_mm" smallint NOT NULL,
    "grip_style" "grip_style" NOT NULL,
    "main_use" text,
    "feedback" text,
    CONSTRAINT "survey_contributions_bins" CHECK ("survey_contributions"."hand_length_bin_mm" BETWEEN 100 AND 280 AND "survey_contributions"."hand_length_bin_mm" % 5 = 0 AND "survey_contributions"."palm_width_bin_mm" BETWEEN 50 AND 150 AND "survey_contributions"."palm_width_bin_mm" % 5 = 0),
    CONSTRAINT "survey_contributions_consented_on_a_day" CHECK (("survey_contributions"."consented_at" AT TIME ZONE 'UTC') = date_trunc('day', "survey_contributions"."consented_at" AT TIME ZONE 'UTC')),
    CONSTRAINT "survey_contributions_consent_version_set" CHECK (char_length("survey_contributions"."consent_version") BETWEEN 1 AND 100),
    CONSTRAINT "survey_contributions_main_use_length" CHECK ("survey_contributions"."main_use" IS NULL OR char_length("survey_contributions"."main_use") BETWEEN 1 AND 40),
    CONSTRAINT "survey_contributions_feedback_length" CHECK ("survey_contributions"."feedback" IS NULL OR char_length("survey_contributions"."feedback") BETWEEN 1 AND 500),
    CONSTRAINT "survey_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
  );

  CREATE TABLE IF NOT EXISTS "survey_other_mice" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "contribution_id" uuid NOT NULL,
    "user_id" text,
    "brand" text NOT NULL,
    "size_feel" text NOT NULL,
    "is_current" boolean DEFAULT false NOT NULL,
    CONSTRAINT "survey_other_mice_brand_length" CHECK (char_length("survey_other_mice"."brand") BETWEEN 1 AND 60),
    CONSTRAINT "survey_other_mice_size_feel_length" CHECK (char_length("survey_other_mice"."size_feel") BETWEEN 1 AND 40),
    CONSTRAINT "survey_other_mice_contribution_id_survey_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."survey_contributions"("id") ON DELETE cascade ON UPDATE no action,
    CONSTRAINT "survey_other_mice_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
  );

  CREATE TABLE IF NOT EXISTS "survey_ratings" (
    "contribution_id" uuid NOT NULL,
    "mouse_id" uuid NOT NULL,
    "user_id" text,
    "satisfaction" smallint NOT NULL,
    "duration" text,
    "pain_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "is_current" boolean DEFAULT false NOT NULL,
    CONSTRAINT "survey_ratings_contribution_id_mouse_id_pk" PRIMARY KEY("contribution_id","mouse_id"),
    CONSTRAINT "survey_ratings_satisfaction_range" CHECK ("survey_ratings"."satisfaction" BETWEEN 1 AND 5),
    CONSTRAINT "survey_ratings_pain_points_array" CHECK (jsonb_typeof("survey_ratings"."pain_points") = 'array'),
    CONSTRAINT "survey_ratings_contribution_id_survey_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."survey_contributions"("id") ON DELETE cascade ON UPDATE no action,
    CONSTRAINT "survey_ratings_mouse_id_mice_id_fk" FOREIGN KEY ("mouse_id") REFERENCES "public"."mice"("id") ON DELETE cascade ON UPDATE no action,
    CONSTRAINT "survey_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
  );

  ALTER TABLE "scans" ADD COLUMN IF NOT EXISTS "survey_contributed_at" timestamp with time zone;

  CREATE INDEX IF NOT EXISTS "survey_contributions_user_id_idx" ON "survey_contributions" USING btree ("user_id");
  CREATE INDEX IF NOT EXISTS "survey_other_mice_contribution_id_idx" ON "survey_other_mice" USING btree ("contribution_id");
  CREATE UNIQUE INDEX IF NOT EXISTS "survey_other_mice_user_brand_unique" ON "survey_other_mice" USING btree ("user_id",lower(btrim("brand"))) WHERE "survey_other_mice"."user_id" IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS "survey_ratings_user_mouse_unique" ON "survey_ratings" USING btree ("user_id","mouse_id") WHERE "survey_ratings"."user_id" IS NOT NULL;
  CREATE INDEX IF NOT EXISTS "survey_ratings_mouse_id_idx" ON "survey_ratings" USING btree ("mouse_id");
END $$;
