import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = readdirSync(join(process.cwd(), "drizzle")).find((name) =>
  /^0005_.*\.sql$/.test(name),
);
const migration = migrationName
  ? readFileSync(join(process.cwd(), "drizzle", migrationName), "utf8")
  : "";

describe("0005 analysis cache migration SQL", () => {
  it("deletes existing cache rows before adding scan_id", () => {
    expect(migration).toMatch(/DELETE FROM "analysis_cache";/);
    expect(migration.replace(/^--[^\n]*\n/, "").trimStart()).toMatch(
      /^DELETE FROM "analysis_cache";/,
    );
    expect(migration.indexOf('DELETE FROM "analysis_cache";')).toBeLessThan(
      migration.indexOf('ADD COLUMN "scan_id"'),
    );
    const drop = migration.indexOf('DROP CONSTRAINT "analysis_cache_pkey"');
    const column = migration.indexOf('ADD COLUMN "scan_id"');
    const composite = migration.indexOf('PRIMARY KEY("scan_id","key")');
    expect(drop).toBeGreaterThan(
      migration.indexOf('DELETE FROM "analysis_cache";'),
    );
    expect(column).toBeGreaterThan(drop);
    expect(composite).toBeGreaterThan(column);
  });

  it("declares a scan foreign key with ON DELETE CASCADE", () => {
    expect(migration).toMatch(
      /FOREIGN KEY \("scan_id"\) REFERENCES "public"\."scans"\("id"\) ON DELETE cascade/i,
    );
  });

  it("declares the primary key as scan_id and key", () => {
    expect(migration).toMatch(/PRIMARY KEY\("scan_id","key"\)/);
  });
});
