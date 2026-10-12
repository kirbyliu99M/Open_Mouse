-- Typed hand length and width (manual entry, candidate 2026-10-12): the fourth
-- value of the calibration_method enum. Additive only: no row and no column
-- changes. IF NOT EXISTS makes a re-run harmless; the neon-http migrator sends
-- each statement on its own with no transaction around the file.
--
-- Migrate BEFORE deploying the code that sends it: a manual-entry submission on
-- a database without this value fails the insert with a 500.
ALTER TYPE "public"."calibration_method" ADD VALUE IF NOT EXISTS 'manual-entry';
