-- Touchpoint (candidate 2026-11-08, Kirby OK to build): two NEW tables, no
-- change to any existing table, so the old code keeps working on a migrated
-- database. Migrate BEFORE deploying code that writes them.
--   hand_samples: de-linked, default-kept copy of a scan's measurements
--     (contract src/lib/contracts/hand-sample.ts). No FK, month-only time.
--   error_photos: rows for opt-in uploaded photos in the private Blob store
--     (contract src/lib/contracts/error-photo.ts). No FK; code hash only.
CREATE TABLE "error_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consent_version" text NOT NULL,
	"blob_pathname" text NOT NULL,
	"delete_code_sha256" text NOT NULL,
	"meta" jsonb NOT NULL,
	"bytes" integer NOT NULL,
	"created_on" timestamp with time zone NOT NULL,
	CONSTRAINT "error_photos_blob_pathname_unique" UNIQUE("blob_pathname"),
	CONSTRAINT "error_photos_delete_code_sha256_unique" UNIQUE("delete_code_sha256"),
	CONSTRAINT "error_photos_consent_version_set" CHECK (char_length("error_photos"."consent_version") BETWEEN 1 AND 100),
	CONSTRAINT "error_photos_created_on_a_day" CHECK (("error_photos"."created_on" AT TIME ZONE 'UTC') = date_trunc('day', "error_photos"."created_on" AT TIME ZONE 'UTC')),
	CONSTRAINT "error_photos_code_hash_hex" CHECK ("error_photos"."delete_code_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "error_photos_bytes_range" CHECK ("error_photos"."bytes" BETWEEN 1 AND 1500000),
	CONSTRAINT "error_photos_meta_object" CHECK (jsonb_typeof("error_photos"."meta") = 'object')
);
--> statement-breakpoint
CREATE TABLE "hand_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notice_version" text NOT NULL,
	"sampled_month" timestamp with time zone NOT NULL,
	"hand" "hand_side" NOT NULL,
	"grip_style_stated" "grip_style",
	"palm_thickness_stated" text,
	"calibration_method" text NOT NULL,
	"measurement_model_version" text NOT NULL,
	"hand_length_mm" smallint NOT NULL,
	"palm_length_mm" smallint NOT NULL,
	"palm_width_mm" smallint NOT NULL,
	"thumb_length_mm" smallint,
	"index_length_mm" smallint,
	"middle_length_mm" smallint,
	"ring_length_mm" smallint,
	"pinky_length_mm" smallint,
	CONSTRAINT "hand_samples_notice_version_set" CHECK (char_length("hand_samples"."notice_version") BETWEEN 1 AND 100),
	CONSTRAINT "hand_samples_on_a_month" CHECK (("hand_samples"."sampled_month" AT TIME ZONE 'UTC') = date_trunc('month', "hand_samples"."sampled_month" AT TIME ZONE 'UTC')),
	CONSTRAINT "hand_samples_plausible" CHECK ("hand_samples"."hand_length_mm" BETWEEN 100 AND 280 AND "hand_samples"."palm_width_mm" BETWEEN 50 AND 150 AND "hand_samples"."palm_length_mm" < "hand_samples"."hand_length_mm")
);
--> statement-breakpoint
CREATE INDEX "error_photos_created_on_idx" ON "error_photos" USING btree ("created_on");--> statement-breakpoint
CREATE INDEX "hand_samples_month_idx" ON "hand_samples" USING btree ("sampled_month");