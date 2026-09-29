-- #63: keep the measurement model and calibration evidence with each scan.
--
-- One DO block, i.e. one statement, for the same reason as 0005: the
-- neon-http migrator sends each statement as its own HTTP request with no
-- surrounding transaction, so a half-applied multi-statement migration could
-- not re-run. Every step is guarded, so a re-run completes without error.
--
-- Additive only. All three columns are nullable, so code that predates this
-- migration keeps inserting and reading rows unchanged; migrate BEFORE
-- deploying the code that writes these columns.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'calibration_method') THEN
    CREATE TYPE "public"."calibration_method"
      AS ENUM ('printed-sheet', 'paper-edge', 'user-length');
  END IF;
  ALTER TABLE "scan_measurements"
    ADD COLUMN IF NOT EXISTS "measurement_model_version" text;
  ALTER TABLE "scan_measurements"
    ADD COLUMN IF NOT EXISTS "calibration_method" "calibration_method";
  ALTER TABLE "scan_measurements"
    ADD COLUMN IF NOT EXISTS "calibration_evidence" jsonb;
END $$;
