CREATE TYPE "public"."analysis_source" AS ENUM('model', 'fallback');--> statement-breakpoint
CREATE TABLE "analysis_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"output" jsonb NOT NULL,
	"source" "analysis_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_cache_source_is_model" CHECK ("analysis_cache"."source" = 'model')
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" bigint NOT NULL,
	"count" integer NOT NULL
);
