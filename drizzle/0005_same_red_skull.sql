-- Binds every analysis_cache row to its scan (ON DELETE CASCADE).
--
-- One DO block, i.e. one statement: the neon-http migrator sends each
-- statement as its own HTTP request with no surrounding transaction, so a
-- multi-statement migration that fails half-way (e.g. old code inserting a
-- scan_id-less row between the DELETE and the NOT NULL column) would leave
-- the table without a primary key and the migration unable to re-run. A
-- single statement is atomic in Postgres: it applies completely or not at all.
--
-- The ACCESS EXCLUSIVE lock stops concurrent writers for the few
-- milliseconds this takes. Existing rows are deleted because they have no
-- scan to attach to; this is a cache, so emptying it only costs
-- re-generation. Every step is guarded so a re-run completes without error
-- (it empties the cache again, which is harmless).
DO $$
BEGIN
  LOCK TABLE "analysis_cache" IN ACCESS EXCLUSIVE MODE;
  DELETE FROM "analysis_cache";
  ALTER TABLE "analysis_cache" DROP CONSTRAINT IF EXISTS "analysis_cache_pkey";
  ALTER TABLE "analysis_cache" ADD COLUMN IF NOT EXISTS "scan_id" uuid NOT NULL;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'analysis_cache_scan_id_key_pk'
      AND conrelid = '"analysis_cache"'::regclass
  ) THEN
    ALTER TABLE "analysis_cache"
      ADD CONSTRAINT "analysis_cache_scan_id_key_pk" PRIMARY KEY ("scan_id", "key");
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'analysis_cache_scan_id_scans_id_fk'
      AND conrelid = '"analysis_cache"'::regclass
  ) THEN
    ALTER TABLE "analysis_cache"
      ADD CONSTRAINT "analysis_cache_scan_id_scans_id_fk"
      FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
