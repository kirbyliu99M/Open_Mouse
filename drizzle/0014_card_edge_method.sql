-- Card reference (v3.4, candidate 2026-11-05, Kirby OK): the fifth value of
-- the calibration_method enum. Additive only: no row and no column changes.
-- IF NOT EXISTS makes a re-run harmless; the neon-http migrator sends each
-- statement on its own with no transaction around the file.
--
-- Migrate BEFORE deploying the code that sends it: a card-edge submission on
-- a database without this value fails the insert with a 500.
ALTER TYPE "public"."calibration_method" ADD VALUE IF NOT EXISTS 'card-edge';
