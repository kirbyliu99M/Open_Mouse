-- Inactive-account retention (spec 2026-10-11, decisions confirmed 2026-10-12):
-- users.last_active_at, and the three indexes the purge's safety nets and the
-- cascade need. Additive only: nothing existing is altered or removed, and an
-- insert that does not name the new column (the Auth.js adapter's createUser, old
-- code) takes the default.
--
-- No backfill (B0): every existing account gets the migration time, so the
-- earliest possible purge is 90 days after this runs.
--
-- Migrate BEFORE deploying the code that has this column. The adapter's
-- getSessionAndUser selects every column of users, so new code on a database
-- without it fails every session read and signs everyone out (the same class of
-- failure as 0007). Old code on the migrated database is safe: it ignores the
-- column.
--
-- One DO block, i.e. one statement, for the same reason as 0005 to 0007: the
-- neon-http migrator sends each statement as its own HTTP request with no
-- surrounding transaction, so a multi-statement migration that fails half-way
-- could not re-run. A single statement is atomic in Postgres. Every step is
-- guarded, so a re-run completes without error. The statements are the ones
-- drizzle-kit generated, only wrapped (tests/unit/migration-last-active.test.ts).
DO $$
BEGIN
  ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp with time zone DEFAULT now() NOT NULL;
  CREATE INDEX IF NOT EXISTS "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");
  CREATE INDEX IF NOT EXISTS "scan_sessions_user_id_idx" ON "scan_sessions" USING btree ("user_id");
  CREATE INDEX IF NOT EXISTS "scans_session_id_idx" ON "scans" USING btree ("session_id");
  CREATE INDEX IF NOT EXISTS "users_last_active_at_idx" ON "users" USING btree ("last_active_at");
END $$;
