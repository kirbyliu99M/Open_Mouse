/**
 * The migration that adds `users.last_active_at` and the four indexes
 * (inactive-retention spec 2026-10-11, sections 3.1 and 4), on PGlite: applied
 * to a database that already has users, applied twice, and checked for the
 * column's type, nullability and default and for each index.
 *
 * Found by content, not by number, so a renumbering (another open PR also adds
 * a migration; whichever merges second renumbers) does not break it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  MIGRATION_FILES,
  applyMigrations,
  migrationStatements,
} from "./fixtures/pglite";

const FILE = MIGRATION_FILES.find((name) =>
  readFileSync(join(process.cwd(), "drizzle", name), "utf8").includes(
    "last_active_at",
  ),
);
const INDEX = FILE ? MIGRATION_FILES.indexOf(FILE) : -1;

const EXPECTED_INDEXES = [
  "auth_sessions_user_id_idx",
  "scan_sessions_user_id_idx",
  "scans_session_id_idx",
  "users_last_active_at_idx",
];

let pg: PGlite | undefined;
afterEach(async () => {
  await pg?.close();
  pg = undefined;
});

async function databaseBeforeIt(): Promise<PGlite> {
  pg = new PGlite();
  await applyMigrations(pg, 0, INDEX);
  return pg;
}

describe("the last_active_at migration", () => {
  it("exists, and is one guarded statement (one DO block), like 0005 to 0007", () => {
    expect(FILE).toBeDefined();
    const statements = migrationStatements(FILE!);
    expect(statements).toHaveLength(1);
    const code = statements[0]!
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim();
    expect(code).toMatch(/^DO \$\$/);
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS "last_active_at"/);
    for (const name of EXPECTED_INDEXES) {
      expect(code).toContain(`CREATE INDEX IF NOT EXISTS "${name}"`);
    }
  });

  it("gives every existing user the migration time, not NULL and not an invented older date", async () => {
    const db = await databaseBeforeIt();
    await db.exec(
      `insert into users (id, email) values ('before', 'before@example.test')`,
    );
    await applyMigrations(db, INDEX, INDEX + 1);

    const { rows } = await db.query<{ age_s: number }>(
      `select extract(epoch from (now() - last_active_at))::float8 as age_s from users where id = 'before'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.age_s).toBeGreaterThanOrEqual(-1);
    expect(rows[0]!.age_s).toBeLessThan(60);
  });

  it("the column is timestamptz, NOT NULL, default now()", async () => {
    const db = await databaseBeforeIt();
    await applyMigrations(db, INDEX, INDEX + 1);
    const { rows } = await db.query<{
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `select data_type, is_nullable, column_default from information_schema.columns
       where table_name = 'users' and column_name = 'last_active_at'`,
    );
    expect(rows).toEqual([
      {
        data_type: "timestamp with time zone",
        is_nullable: "NO",
        column_default: "now()",
      },
    ]);
  });

  it("creates the four indexes on the right columns", async () => {
    const db = await databaseBeforeIt();
    await applyMigrations(db, INDEX, INDEX + 1);
    const { rows } = await db.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where schemaname = 'public' and indexname = any($1) order by indexname`,
      [EXPECTED_INDEXES],
    );
    expect(rows.map((r) => r.indexname)).toEqual(EXPECTED_INDEXES);
    const byName = Object.fromEntries(
      rows.map((r) => [r.indexname, r.indexdef]),
    );
    expect(byName.users_last_active_at_idx).toMatch(
      /ON public\.users .*\(last_active_at\)/,
    );
    expect(byName.auth_sessions_user_id_idx).toMatch(
      /ON public\.auth_sessions .*\(user_id\)/,
    );
    expect(byName.scan_sessions_user_id_idx).toMatch(
      /ON public\.scan_sessions .*\(user_id\)/,
    );
    expect(byName.scans_session_id_idx).toMatch(
      /ON public\.scans .*\(session_id\)/,
    );
  });

  it("can be applied a second time without error and without moving anyone's date", async () => {
    const db = await databaseBeforeIt();
    await db.exec(`insert into users (id) values ('u')`);
    await applyMigrations(db, INDEX, INDEX + 1);
    await db.exec(
      `update users set last_active_at = now() - interval '5 days' where id = 'u'`,
    );

    await applyMigrations(db, INDEX, INDEX + 1);

    const { rows } = await db.query<{ days: number }>(
      `select extract(epoch from (now() - last_active_at))::float8 / 86400 as days from users where id = 'u'`,
    );
    expect(rows[0]!.days).toBeGreaterThan(4.9);
    expect(rows[0]!.days).toBeLessThan(5.1);
  });

  it("a user inserted the way old code does (without the column) still works afterwards", async () => {
    const db = await databaseBeforeIt();
    await applyMigrations(db, INDEX, INDEX + 1);
    await db.exec(
      `insert into users (id, email) values ('x', 'x@example.test')`,
    );
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from users where last_active_at is not null`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("is additive only: nothing in it drops, deletes or rewrites data", () => {
    const sql = readFileSync(join(process.cwd(), "drizzle", FILE!), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
  });
});
