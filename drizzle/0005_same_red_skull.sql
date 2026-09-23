-- Existing cache rows have no scan to attach to. Emptying this cache only costs re-generation.
DELETE FROM "analysis_cache";--> statement-breakpoint
ALTER TABLE "analysis_cache" DROP CONSTRAINT "analysis_cache_pkey";--> statement-breakpoint
ALTER TABLE "analysis_cache" ADD COLUMN "scan_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_cache" ADD CONSTRAINT "analysis_cache_scan_id_key_pk" PRIMARY KEY("scan_id","key");--> statement-breakpoint
ALTER TABLE "analysis_cache" ADD CONSTRAINT "analysis_cache_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;
