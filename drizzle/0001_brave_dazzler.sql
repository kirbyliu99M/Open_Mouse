CREATE TYPE "public"."connectivity" AS ENUM('wired', 'wireless');--> statement-breakpoint
CREATE TYPE "public"."descriptor_method" AS ENUM('rubric_vision', 'manual');--> statement-breakpoint
CREATE TYPE "public"."front_flare" AS ENUM('inward_aggressive', 'inward_moderate', 'inward_slight', 'flat', 'outward_slight', 'outward_moderate', 'outward_aggressive');--> statement-breakpoint
CREATE TYPE "public"."grip_style" AS ENUM('palm', 'claw', 'fingertip');--> statement-breakpoint
CREATE TYPE "public"."hand_compatibility" AS ENUM('right', 'left', 'ambidextrous');--> statement-breakpoint
CREATE TYPE "public"."hand_side" AS ENUM('left', 'right');--> statement-breakpoint
CREATE TYPE "public"."hump_placement" AS ENUM('center', 'back_minimal', 'back_moderate', 'back_aggressive');--> statement-breakpoint
CREATE TYPE "public"."mouse_shape" AS ENUM('symmetrical', 'ergonomic', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."side_curvature" AS ENUM('inward_aggressive', 'inward', 'flat', 'outward', 'outward_aggressive');--> statement-breakpoint
CREATE TYPE "public"."mouse_size" AS ENUM('fingertip', 'small', 'medium', 'large');--> statement-breakpoint
CREATE TABLE "fit_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"mouse_id" uuid NOT NULL,
	"engine_version" text NOT NULL,
	"rank" smallint NOT NULL,
	"total_score" smallint NOT NULL,
	"length_score" smallint NOT NULL,
	"grip_width_score" smallint NOT NULL,
	"height_hump_score" smallint NOT NULL,
	"front_flare_score" smallint NOT NULL,
	"thumb_score" smallint NOT NULL,
	"weight_score" smallint NOT NULL,
	"reasons" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fit_results_scan_mouse_version" UNIQUE("scan_id","mouse_id","engine_version"),
	CONSTRAINT "fit_results_scores_bounded" CHECK ("fit_results"."total_score" BETWEEN 0 AND 100 AND "fit_results"."length_score" BETWEEN 0 AND 100 AND "fit_results"."grip_width_score" BETWEEN 0 AND 100 AND "fit_results"."height_hump_score" BETWEEN 0 AND 100 AND "fit_results"."front_flare_score" BETWEEN 0 AND 100 AND "fit_results"."thumb_score" BETWEEN 0 AND 100 AND "fit_results"."weight_score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "mice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"length_mm" numeric(5, 1) NOT NULL,
	"width_mm" numeric(5, 1) NOT NULL,
	"height_mm" numeric(5, 1) NOT NULL,
	"weight_g" numeric(5, 1),
	"connectivity" "connectivity",
	"size" "mouse_size" NOT NULL,
	"shape" "mouse_shape",
	"hand_compatibility" "hand_compatibility",
	"hump_placement" "hump_placement",
	"front_flare" "front_flare",
	"side_curvature" "side_curvature",
	"thumb_rest" boolean,
	"ring_finger_rest" boolean,
	"source_url" text NOT NULL,
	"spec_retrieved_at" timestamp with time zone NOT NULL,
	"descriptor_method" "descriptor_method",
	"descriptor_model" text,
	"descriptor_source_urls" jsonb,
	"classified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mice_slug_unique" UNIQUE("slug"),
	CONSTRAINT "mice_brand_model_unique" UNIQUE("brand","model"),
	CONSTRAINT "mice_dimensions_positive" CHECK ("mice"."length_mm" > 0 AND "mice"."width_mm" > 0 AND "mice"."height_mm" > 0),
	CONSTRAINT "mice_source_url_https" CHECK ("mice"."source_url" LIKE 'https://%'),
	CONSTRAINT "mice_ambidextrous_is_symmetrical" CHECK ("mice"."hand_compatibility" <> 'ambidextrous' OR "mice"."shape" = 'symmetrical'),
	CONSTRAINT "mice_thumb_rest_is_ergonomic" CHECK ("mice"."thumb_rest" IS NOT TRUE OR "mice"."shape" = 'ergonomic'),
	CONSTRAINT "mice_ring_rest_is_ergonomic" CHECK ("mice"."ring_finger_rest" IS NOT TRUE OR "mice"."shape" = 'ergonomic')
);
--> statement-breakpoint
CREATE TABLE "scan_measurements" (
	"scan_id" uuid PRIMARY KEY NOT NULL,
	"hand_length_mm" numeric(5, 1) NOT NULL,
	"palm_length_mm" numeric(5, 1) NOT NULL,
	"palm_width_mm" numeric(5, 1) NOT NULL,
	"thumb_length_mm" numeric(5, 1),
	"index_length_mm" numeric(5, 1),
	"middle_length_mm" numeric(5, 1),
	"ring_length_mm" numeric(5, 1),
	"pinky_length_mm" numeric(5, 1),
	"palm_thickness_mm" numeric(5, 1),
	"knuckle_height_mm" numeric(5, 1),
	"grip_aperture_mm" numeric(5, 1),
	"thumb_angle_deg" numeric(5, 1),
	"scale_check_ratio" numeric(6, 4),
	CONSTRAINT "scan_measurements_plausible" CHECK ("scan_measurements"."hand_length_mm" BETWEEN 100 AND 280 AND "scan_measurements"."palm_width_mm" BETWEEN 50 AND 150 AND "scan_measurements"."palm_length_mm" < "scan_measurements"."hand_length_mm")
);
--> statement-breakpoint
CREATE TABLE "scan_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "scan_sessions_anonymous_expire" CHECK ("scan_sessions"."user_id" IS NOT NULL OR "scan_sessions"."expires_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"hand" "hand_side" NOT NULL,
	"grip_style_stated" "grip_style",
	"grip_style_predicted" "grip_style",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp with time zone,
	"image" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "fit_results" ADD CONSTRAINT "fit_results_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_results" ADD CONSTRAINT "fit_results_mouse_id_mice_id_fk" FOREIGN KEY ("mouse_id") REFERENCES "public"."mice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_measurements" ADD CONSTRAINT "scan_measurements_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_sessions" ADD CONSTRAINT "scan_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_session_id_scan_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."scan_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scan_sessions_expires_at_idx" ON "scan_sessions" USING btree ("expires_at");