/**
 * A real Postgres (PGlite, in-process WASM) with the repo's own migrations
 * applied, for tests that need database behaviour rather than a fake:
 * constraints, cascades, and the SQL a Drizzle repo actually generates.
 * Not a test file itself.
 *
 * Migrations are applied the way the neon-http migrator applies them: each
 * `--> statement-breakpoint` chunk is sent as its own statement, with no
 * transaction around the file.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");

export const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();

export function migrationStatements(file: string): string[] {
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/** Applies migration files [from, to) in order. */
export async function applyMigrations(
  pg: PGlite,
  from = 0,
  to = MIGRATION_FILES.length,
): Promise<void> {
  for (const file of MIGRATION_FILES.slice(from, to)) {
    for (const statement of migrationStatements(file)) {
      await pg.exec(statement);
    }
  }
}

export async function migratedDatabase() {
  const pg = new PGlite();
  await applyMigrations(pg);
  return { pg, db: drizzle(pg) };
}

/**
 * PGlite's drizzle driver has no `db.batch` (neon-http's atomic multi-query
 * request, which `createDrizzleScanRepo` uses to insert a scan and its
 * measurements). Run the batch's queries in order instead: tests using this
 * check the repo's SQL and column mapping against the real schema, not batch
 * atomicity. `Db` is the type the repo under test expects.
 */
export function withSequentialBatch<Db>(db: object): Db {
  return Object.assign(db, {
    batch: async (queries: PromiseLike<unknown>[]) => {
      const results: unknown[] = [];
      for (const query of queries) results.push(await query);
      return results;
    },
  }) as unknown as Db;
}

export async function count(pg: PGlite, sql: string): Promise<number> {
  const { rows } = await pg.query<{ n: number }>(sql);
  return Number(rows[0]!.n);
}
