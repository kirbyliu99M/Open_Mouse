-- Renames the second value of the data_source enum to 'public_compilation'
-- (2026-10-11). 0009 now creates the enum with that value, so on a fresh
-- database this is a no-op; on a database that applied the earlier 0009 it
-- renames the one legacy value in place (rows keep their value, now spelled
-- 'public_compilation'). The legacy label is read from pg_enum rather than
-- written here. One statement, safe to re-run: the neon-http migrator sends
-- each statement on its own with no transaction around the file.
DO $$
DECLARE
  labels text[];
  legacy text[];
BEGIN
  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
    INTO labels
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public' AND t.typname = 'data_source';
  IF labels IS NULL THEN
    RAISE EXCEPTION 'enum public.data_source does not exist';
  END IF;
  legacy := array_remove(array_remove(labels, 'first_party'), 'public_compilation');
  IF cardinality(legacy) = 0 THEN
    -- Already renamed, or created by the current 0009.
    IF NOT ('public_compilation' = ANY (labels)) THEN
      RAISE EXCEPTION 'enum public.data_source has no public_compilation value: %', labels;
    END IF;
  ELSIF cardinality(legacy) = 1
        AND cardinality(labels) = 2
        AND labels[1] = 'first_party' THEN
    EXECUTE format(
      'ALTER TYPE "public"."data_source" RENAME VALUE %L TO %L',
      legacy[1],
      'public_compilation'
    );
  ELSE
    RAISE EXCEPTION 'enum public.data_source has unexpected values: %', labels;
  END IF;
END $$;
