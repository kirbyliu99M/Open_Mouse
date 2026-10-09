CREATE TYPE "public"."catalogue_category" AS ENUM('gaming', 'office');--> statement-breakpoint
CREATE TYPE "public"."data_source" AS ENUM('first_party', 'eloshapes');--> statement-breakpoint
CREATE TYPE "public"."form_factor" AS ENUM('standard', 'vertical', 'trackball');--> statement-breakpoint
ALTER TABLE "mice" ADD COLUMN "category" "catalogue_category" DEFAULT 'gaming' NOT NULL;--> statement-breakpoint
ALTER TABLE "mice" ADD COLUMN "listed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "mice" ADD COLUMN "form_factor" "form_factor" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "mice" ADD COLUMN "image_path" text;--> statement-breakpoint
ALTER TABLE "mice" ADD COLUMN "data_source" "data_source" DEFAULT 'first_party' NOT NULL;