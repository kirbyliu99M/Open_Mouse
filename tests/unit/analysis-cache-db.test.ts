/**
 * `analysis_cache` against a real Postgres (PGlite) with the repo's actual
 * migrations: the 0005 migration itself, the scan-scoped SQL the Drizzle
 * cache generates, and every scan-deletion path taking the cached prose
 * with it.
 */
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

// Each case starts a fresh in-process Postgres (PGlite) and applies every
// migration, about 2.5 s on an idle machine; under load that crossed
// Vitest's 5 s default (#61). The timeout covers the setup, not the logic.
vi.setConfig({ testTimeout: 30_000 });

vi.mock("server-only", () => ({}));

import { createDrizzleAccountRepo } from "../../src/server/account/drizzle-repo";
import { createDrizzleAnalysisCache } from "../../src/server/analysis/drizzle-cache";
import { createDrizzleScanRepo } from "../../src/server/scans/drizzle-repo";
import type { CachedAnalysis } from "../../src/server/analysis/cache";
import {
  MIGRATION_FILES,
  applyMigrations,
  count,
  migratedDatabase,
  migrationStatements,
} from "./fixtures/pglite";

type CacheDb = Parameters<typeof createDrizzleAnalysisCache>[0];
type ScanDb = Parameters<typeof createDrizzleScanRepo>[0];
type AccountDb = Parameters<typeof createDrizzleAccountRepo>[0];

const MIGRATION_0005 = MIGRATION_FILES.findIndex((f) => f.startsWith("0005_"));

const ANSWER: CachedAnalysis = {
  output: {
    headline: "A strong match.",
    whyTopPick: "It fits.",
    tradeoffs: [],
    whatToAvoid: [],
    caveats: [],
  },
  source: "model",
};

const EXPIRED = "00000000-0000-4000-8000-00000000000a";
const LIVE = "00000000-0000-4000-8000-00000000000b";
const CLAIMED = "00000000-0000-4000-8000-00000000000c";
const SCAN_EXPIRED = "10000000-0000-4000-8000-00000000000a";
const SCAN_LIVE_1 = "10000000-0000-4000-8000-00000000000b";
const SCAN_LIVE_2 = "10000000-0000-4000-8000-00000000000d";
const SCAN_CLAIMED = "10000000-0000-4000-8000-00000000000c";

async function seedScans(pg: PGlite) {
  await pg.exec(`
    insert into users (id) values ('user-1');
    insert into scan_sessions (id, user_id, expires_at) values
      ('${EXPIRED}', null, now() - interval '1 minute'),
      ('${LIVE}', null, now() + interval '1 hour'),
      ('${CLAIMED}', 'user-1', null);
    insert into scans (id, session_id, hand) values
      ('${SCAN_EXPIRED}', '${EXPIRED}', 'right'),
      ('${SCAN_LIVE_1}', '${LIVE}', 'right'),
      ('${SCAN_LIVE_2}', '${LIVE}', 'right'),
      ('${SCAN_CLAIMED}', '${CLAIMED}', 'right');
  `);
}

const cachedRows = (pg: PGlite, scanId: string) =>
  count(
    pg,
    `select count(*)::int as n from analysis_cache where scan_id = '${scanId}'`,
  );

describe("migration 0005 on a real Postgres", () => {
  it("applies to a cache that already has rows: empties it, adds the (scan_id, key) PK and a cascading FK", async () => {
    const pg = new PGlite();
    await applyMigrations(pg, 0, MIGRATION_0005);
    await pg.exec(
      `insert into analysis_cache (key, output, source) values ('k1', '{}', 'model'), ('k2', '{}', 'model')`,
    );

    await applyMigrations(pg, MIGRATION_0005, MIGRATION_0005 + 1);

    expect(
      await count(pg, "select count(*)::int as n from analysis_cache"),
    ).toBe(0);
    const { rows } = await pg.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid = 'analysis_cache'::regclass and contype in ('p', 'f')
       order by conname`,
    );
    expect(rows).toEqual([
      {
        conname: "analysis_cache_scan_id_key_pk",
        def: "PRIMARY KEY (scan_id, key)",
      },
      {
        conname: "analysis_cache_scan_id_scans_id_fk",
        def: "FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE",
      },
    ]);
  });

  it("is a single statement, and running it a second time does not error", async () => {
    expect(migrationStatements(MIGRATION_FILES[MIGRATION_0005]!)).toHaveLength(
      1,
    );
    const { pg } = await migratedDatabase();
    await expect(
      applyMigrations(pg, MIGRATION_0005, MIGRATION_0005 + 1),
    ).resolves.toBeUndefined();
  });
});

describe("createDrizzleAnalysisCache on a real Postgres", () => {
  it("scopes reads to the scan: the same key under another scan is a miss", async () => {
    const { pg, db } = await migratedDatabase();
    await seedScans(pg);
    const cache = createDrizzleAnalysisCache(db as unknown as CacheDb);

    await cache.set(SCAN_LIVE_1, "same-key", ANSWER);

    expect(await cache.get(SCAN_LIVE_1, "same-key")).toEqual(ANSWER);
    expect(await cache.get(SCAN_LIVE_2, "same-key")).toBeNull();
  });

  it("rejects a row for a scan that does not exist", async () => {
    const { db } = await migratedDatabase();
    const cache = createDrizzleAnalysisCache(db as unknown as CacheDb);
    await expect(
      cache.set("10000000-0000-4000-8000-0000000000ff", "k", ANSWER),
    ).rejects.toThrow();
  });
});

describe("every scan deletion path removes the cached prose", () => {
  async function withCachedScans() {
    const { pg, db } = await migratedDatabase();
    await seedScans(pg);
    const cache = createDrizzleAnalysisCache(db as unknown as CacheDb);
    for (const scan of [SCAN_EXPIRED, SCAN_LIVE_1, SCAN_LIVE_2, SCAN_CLAIMED]) {
      await cache.set(scan, "k", ANSWER);
    }
    return { pg, db };
  }

  it("the anonymous expiry sweep (deleteExpiredAnonymousSessions)", async () => {
    const { pg, db } = await withCachedScans();
    await createDrizzleScanRepo(
      db as unknown as ScanDb,
    ).deleteExpiredAnonymousSessions(new Date());
    expect(await cachedRows(pg, SCAN_EXPIRED)).toBe(0);
    expect(await cachedRows(pg, SCAN_LIVE_1)).toBe(1);
  });

  it("deleting one scan row (what DELETE /api/scans/{id} does) removes only that scan's prose", async () => {
    const { pg } = await withCachedScans();
    await pg.exec(`delete from scans where id = '${SCAN_LIVE_1}'`);
    expect(await cachedRows(pg, SCAN_LIVE_1)).toBe(0);
    expect(await cachedRows(pg, SCAN_LIVE_2)).toBe(1);
  });

  it("account deletion (deleteAllScans)", async () => {
    const { pg, db } = await withCachedScans();
    await createDrizzleAccountRepo(db as unknown as AccountDb).deleteAllScans(
      "user-1",
    );
    expect(await cachedRows(pg, SCAN_CLAIMED)).toBe(0);
    expect(await cachedRows(pg, SCAN_LIVE_1)).toBe(1);
  });
});
