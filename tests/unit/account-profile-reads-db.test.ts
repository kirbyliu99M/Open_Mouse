/**
 * The two reads the profile page adds for the questionnaire, over a real
 * Postgres (PGlite with the repo's own migrations): the mice the picker offers
 * (only the ones listed for the public) and the scan of this browser's own
 * anonymous scan session (the ownership rule's SQL, not a fake's).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  readCatalogueChoices,
  readSessionLatestScanId,
} from "../../src/server/account/profile";
import { createDrizzleScanRepo } from "../../src/server/scans/drizzle-repo";
import { migratedDatabase, withSequentialBatch } from "./fixtures/pglite";

type ScanDb = Parameters<typeof createDrizzleScanRepo>[0];
type ProfileDb = NonNullable<Parameters<typeof readCatalogueChoices>[0]>;

const evidence = {
  method: "user-length" as const,
  referenceMeasurement: "handLengthMm" as const,
  referenceMm: 183.4,
  parallaxCorrected: false as const,
};

async function world() {
  const { pg, db } = await migratedDatabase();
  const repo = createDrizzleScanRepo(withSequentialBatch<ScanDb>(db));
  const scan = (sessionId: string) =>
    repo.insertScanWithMeasurements({
      sessionId,
      hand: "right",
      gripStyleStated: null,
      palmThicknessStated: null,
      measurements: {
        handLengthMm: 183.4,
        palmLengthMm: 101.3,
        palmWidthMm: 84.7,
      },
      scaleCheckRatio: null,
      measurementModelVersion: "landmark-raw-v2",
      calibrationMethod: "user-length",
      calibrationEvidence: evidence,
    });
  return { pg, db: db as unknown as ProfileDb, repo, scan };
}

describe("readCatalogueChoices", () => {
  it("lists the mice listed for the public as slug, brand and model, and leaves the unlisted out", async () => {
    const { pg, db } = await world();
    for (const [slug, brand, model, listed] of [
      ["logitech-g502-x-plus", "Logitech", "G502 X Plus", true],
      ["logitech-m705", "Logitech", "M705", false],
      ["razer-deathadder-v3", "Razer", "DeathAdder V3", true],
    ] as const) {
      await pg.query(
        `INSERT INTO mice (slug, brand, model, length_mm, width_mm, height_mm, size, source_url, spec_retrieved_at, listed)
         VALUES ($1, $2, $3, 120, 65, 40, 'medium', 'https://example.test', now(), $4)`,
        [slug, brand, model, listed],
      );
    }
    const rows = await readCatalogueChoices(db);
    expect(rows.map((r) => r.slug).sort()).toEqual([
      "logitech-g502-x-plus",
      "razer-deathadder-v3",
    ]);
    expect(rows.find((r) => r.slug === "razer-deathadder-v3")).toEqual({
      slug: "razer-deathadder-v3",
      brand: "Razer",
      model: "DeathAdder V3",
    });
    // Only these three columns leave the database.
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      "brand",
      "model",
      "slug",
    ]);
  });
});

describe("readSessionLatestScanId", () => {
  const NOW = new Date();

  it("is the newest scan of the session the cookie names", async () => {
    const { db, repo, scan } = await world();
    const session = await repo.createAnonymousSession(
      new Date(Date.now() + 3_600_000),
    );
    const first = await scan(session.id);
    // created_at has the clock's resolution: the newer scan is made later.
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await scan(session.id);
    expect(first.scanId).not.toBe(second.scanId);
    expect(await readSessionLatestScanId(session.id, NOW, db)).toBe(
      second.scanId,
    );
  });

  it("is null with no cookie, an unknown session, or a session with no scan", async () => {
    const { db, repo } = await world();
    expect(await readSessionLatestScanId(null, NOW, db)).toBeNull();
    expect(
      await readSessionLatestScanId(
        "00000000-0000-4000-8000-0000000000aa",
        NOW,
        db,
      ),
    ).toBeNull();
    const empty = await repo.createAnonymousSession(
      new Date(Date.now() + 3_600_000),
    );
    expect(await readSessionLatestScanId(empty.id, NOW, db)).toBeNull();
  });

  it("never gives another session's scan: only the cookie's own", async () => {
    const { db, repo, scan } = await world();
    const mine = await repo.createAnonymousSession(
      new Date(Date.now() + 3_600_000),
    );
    const theirs = await repo.createAnonymousSession(
      new Date(Date.now() + 3_600_000),
    );
    const myScan = await scan(mine.id);
    const theirScan = await scan(theirs.id);
    expect(await readSessionLatestScanId(mine.id, NOW, db)).toBe(myScan.scanId);
    expect(await readSessionLatestScanId(theirs.id, NOW, db)).toBe(
      theirScan.scanId,
    );
    expect(await readSessionLatestScanId(mine.id, NOW, db)).not.toBe(
      theirScan.scanId,
    );
  });

  it("is null once the anonymous session has expired (expired means gone)", async () => {
    const { db, repo, scan } = await world();
    const session = await repo.createAnonymousSession(
      new Date(Date.now() + 3_600_000),
    );
    await scan(session.id);
    const later = new Date(Date.now() + 2 * 3_600_000);
    expect(await readSessionLatestScanId(session.id, later, db)).toBeNull();
  });

  it("is null for a session an account has claimed: that scan is the account's, not the cookie's", async () => {
    const { pg, db, repo, scan } = await world();
    await pg.query(
      `INSERT INTO users (id, name, email) VALUES ('user-1', 'Test', 'test@example.test')`,
    );
    const session = await repo.createAnonymousSession(
      new Date(Date.now() + 3_600_000),
    );
    await scan(session.id);
    await repo.claimSession(session.id, "user-1", new Date());
    expect(await readSessionLatestScanId(session.id, NOW, db)).toBeNull();
  });
});
