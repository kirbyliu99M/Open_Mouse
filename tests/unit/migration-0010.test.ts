/**
 * Migration 0010 renames the second `data_source` enum value to
 * `public_compilation`. Two paths must both end with the contract's values:
 * a fresh database (0009 already creates `public_compilation`; 0010 is a
 * no-op) and a database that applied the earlier 0009 (0010 renames the
 * legacy value in place, rows included). The legacy label is not written in
 * the SQL; the upgrade test stands one in with a placeholder label.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { DATA_SOURCES } from "../../src/lib/contracts/descriptors";
import {
  MIGRATION_FILES,
  applyMigrations,
  migratedDatabase,
  migrationStatements,
} from "./fixtures/pglite";

const FILE = "0010_rename_data_source_value.sql";
const sql = readFileSync(
  new URL(`../../drizzle/${FILE}`, import.meta.url),
  "utf8",
);
const journal = JSON.parse(
  readFileSync(
    new URL("../../drizzle/meta/_journal.json", import.meta.url),
    "utf8",
  ),
) as { entries: { idx: number; when: number; tag: string }[] };
const snapshotEnum = (n: string): string[] =>
  (
    JSON.parse(
      readFileSync(
        new URL(`../../drizzle/meta/${n}_snapshot.json`, import.meta.url),
        "utf8",
      ),
    ) as { enums: Record<string, { values: string[] }> }
  ).enums["public.data_source"]!.values;

/** A stand-in for the value the earlier 0009 created. */
const PLACEHOLDER = "legacy_placeholder";

async function enumLabels(pg: PGlite): Promise<string[]> {
  const { rows } = await pg.query<{ label: string }>(
    `SELECT e.enumlabel AS label FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'data_source' ORDER BY e.enumsortorder`,
  );
  return rows.map((r) => r.label);
}

/** 0000-0008, then 0009 as it was first applied (with the placeholder value). */
async function databaseOnEarlier0009(): Promise<PGlite> {
  const pg = new PGlite();
  const at0009 = MIGRATION_FILES.findIndex((f) => f.startsWith("0009_"));
  await applyMigrations(pg, 0, at0009);
  for (const statement of migrationStatements(MIGRATION_FILES[at0009]!)) {
    await pg.exec(
      statement.replace("'public_compilation'", `'${PLACEHOLDER}'`),
    );
  }
  return pg;
}

describe("migration 0010: journal and files", () => {
  it("is journal entry 10, with sequential indexes and rising timestamps (later migrations may follow it)", () => {
    const { entries } = journal;
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
    for (let i = 1; i < entries.length; i += 1)
      expect(entries[i]!.when).toBeGreaterThan(entries[i - 1]!.when);
    expect(entries[10]!.tag).toBe(FILE.replace(/\.sql$/, ""));
    expect(entries.map((e) => `${e.tag}.sql`)).toEqual(MIGRATION_FILES);
  });

  it("has both snapshots on the contract's values", () => {
    expect(snapshotEnum("0009")).toEqual([...DATA_SOURCES]);
    expect(snapshotEnum("0010")).toEqual([...DATA_SOURCES]);
  });

  it("is a single DO statement", () => {
    expect(sql.split("--> statement-breakpoint")).toHaveLength(1);
    expect(sql.match(/^DO \$\$/m)).not.toBeNull();
  });

  it("names no enum value but the two current ones", () => {
    const literals = [...sql.matchAll(/'([^']*)'/g)].map((m) => m[1]!);
    const allowed = new Set([
      ...DATA_SOURCES,
      "public",
      "data_source",
      'ALTER TYPE "public"."data_source" RENAME VALUE %L TO %L',
      "enum public.data_source does not exist",
      "enum public.data_source has no public_compilation value: %",
      "enum public.data_source has unexpected values: %",
    ]);
    expect(literals.filter((l) => !allowed.has(l))).toEqual([]);
  });
});

describe("migration 0010: database paths", () => {
  it("leaves a fresh database on the contract's values, and re-runs cleanly", async () => {
    const { pg } = await migratedDatabase();
    expect(await enumLabels(pg)).toEqual([...DATA_SOURCES]);
    await pg.exec(sql);
    await pg.exec(sql);
    expect(await enumLabels(pg)).toEqual([...DATA_SOURCES]);
    await pg.close();
  }, 30_000);

  it("renames the earlier value in place on an upgraded database, rows included", async () => {
    const pg = await databaseOnEarlier0009();
    expect(await enumLabels(pg)).toEqual(["first_party", PLACEHOLDER]);
    await pg.exec(`CREATE TABLE probe (v data_source NOT NULL)`);
    await pg.exec(
      `INSERT INTO probe VALUES ('first_party'), ('${PLACEHOLDER}'), ('${PLACEHOLDER}')`,
    );
    await pg.exec(sql);
    expect(await enumLabels(pg)).toEqual([...DATA_SOURCES]);
    const { rows } = await pg.query<{ v: string; n: number }>(
      `SELECT v::text AS v, count(*)::int AS n FROM probe GROUP BY v ORDER BY v`,
    );
    expect(rows).toEqual([
      { v: "first_party", n: 1 },
      { v: "public_compilation", n: 2 },
    ]);
    // The mice default is untouched.
    const { rows: def } = await pg.query<{ d: string }>(
      `SELECT column_default AS d FROM information_schema.columns
        WHERE table_name = 'mice' AND column_name = 'data_source'`,
    );
    expect(def[0]!.d).toMatch(/^'first_party'::/);
    await pg.exec(sql);
    expect(await enumLabels(pg)).toEqual([...DATA_SOURCES]);
    await pg.close();
  }, 30_000);

  it("refuses an enum it does not recognise instead of guessing", async () => {
    const pg = await databaseOnEarlier0009();
    await pg.exec(`ALTER TYPE data_source ADD VALUE 'another_value'`);
    await expect(pg.exec(sql)).rejects.toThrow(/unexpected values/);
    expect(await enumLabels(pg)).toEqual([
      "first_party",
      PLACEHOLDER,
      "another_value",
    ]);
    await pg.close();
  }, 30_000);
});
