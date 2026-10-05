/**
 * `GET /api/scans/{scanId}/measurements` over the real repo on a real
 * Postgres (PGlite, with the repo's own migrations): what a scan stores
 * (millimetres to 0.1, NULL for what it never had) comes back as the contract
 * says (numbers to 0.1, absent fields absent), and the ownership rule is the
 * SQL's, not a fake's.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { scanMeasurementsResponseSchema } from "../../src/lib/contracts/measurement";
import { scanMeasurementsPath } from "../../src/lib/contracts/routes";
import { createDrizzleScanRepo } from "../../src/server/scans/drizzle-repo";
import { handleScanMeasurements } from "../../src/server/scans/measurements";
import { migratedDatabase, withSequentialBatch } from "./fixtures/pglite";

type ScanDb = Parameters<typeof createDrizzleScanRepo>[0];

const evidence = {
  method: "user-length" as const,
  referenceMeasurement: "handLengthMm" as const,
  referenceMm: 183.44,
  parallaxCorrected: false as const,
};

async function world() {
  const { pg, db } = await migratedDatabase();
  const repo = createDrizzleScanRepo(withSequentialBatch<ScanDb>(db));
  const session = await repo.createAnonymousSession(
    new Date(Date.now() + 60_000),
  );
  return { pg, repo, session };
}

const request = (scanId: string, cookie?: string) =>
  new Request(`http://localhost${scanMeasurementsPath(scanId)}`, {
    headers: cookie ? { cookie: `scan_session=${cookie}` } : {},
  });

describe("GET /api/scans/{scanId}/measurements on a real database", () => {
  it("returns the stored millimetres to 0.1 mm, the hand, and no field the scan never had", async () => {
    const { pg, repo, session } = await world();
    const { scanId } = await repo.insertScanWithMeasurements({
      sessionId: session.id,
      hand: "left",
      gripStyleStated: "claw",
      // 183.44 is stored as numeric(5,1): 183.4.
      measurements: {
        handLengthMm: 183.44,
        palmLengthMm: 101.26,
        palmWidthMm: 84.7,
        middleLengthMm: 79.96,
      },
      scaleCheckRatio: null,
      measurementModelVersion: "landmark-raw-v2",
      calibrationMethod: "user-length",
      calibrationEvidence: evidence,
    });

    const res = await handleScanMeasurements(
      request(scanId, session.id),
      scanId,
      { repo, getUserId: async () => null },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain("null");
    const body = scanMeasurementsResponseSchema.parse(JSON.parse(text));
    expect(body).toEqual({
      scanId,
      hand: "left",
      measurements: {
        handLengthMm: 183.4,
        palmLengthMm: 101.3,
        palmWidthMm: 84.7,
        middleLengthMm: 80,
      },
    });
    await pg.close();
  }, 30_000);

  it("is a 404 for a caller whose cookie names another session, for no cookie at all, and for a malformed id", async () => {
    const { pg, repo, session } = await world();
    const other = await repo.createAnonymousSession(
      new Date(Date.now() + 60_000),
    );
    const { scanId } = await repo.insertScanWithMeasurements({
      sessionId: session.id,
      hand: "right",
      gripStyleStated: null,
      measurements: { handLengthMm: 180, palmLengthMm: 100, palmWidthMm: 85 },
      scaleCheckRatio: null,
      measurementModelVersion: "landmark-raw-v2",
      calibrationMethod: "user-length",
      calibrationEvidence: evidence,
    });
    const deps = { repo, getUserId: async () => null };

    expect(
      (await handleScanMeasurements(request(scanId, other.id), scanId, deps))
        .status,
    ).toBe(404);
    expect(
      (await handleScanMeasurements(request(scanId), scanId, deps)).status,
    ).toBe(404);
    expect(
      (await handleScanMeasurements(request("nope"), "nope", deps)).status,
    ).toBe(404);
    expect(
      (await handleScanMeasurements(request(scanId, session.id), scanId, deps))
        .status,
    ).toBe(200);
    await pg.close();
  }, 30_000);

  it("is a 404 once the anonymous session has expired", async () => {
    const { pg, repo } = await world();
    const expired = await repo.createAnonymousSession(
      new Date(Date.now() - 1000),
    );
    const { scanId } = await repo.insertScanWithMeasurements({
      sessionId: expired.id,
      hand: "right",
      gripStyleStated: null,
      measurements: { handLengthMm: 180, palmLengthMm: 100, palmWidthMm: 85 },
      scaleCheckRatio: null,
      measurementModelVersion: "landmark-raw-v2",
      calibrationMethod: "user-length",
      calibrationEvidence: evidence,
    });

    const res = await handleScanMeasurements(
      request(scanId, expired.id),
      scanId,
      { repo, getUserId: async () => null },
    );

    expect(res.status).toBe(404);
    await pg.close();
  }, 30_000);

  it("serves a signed-in owner from a browser with no cookie, and nobody else", async () => {
    const { pg, repo } = await world();
    await pg.query(`INSERT INTO users (id) VALUES ('user-1'), ('user-2')`);
    const owned = await repo.createClaimedSession("user-1");
    const { scanId } = await repo.insertScanWithMeasurements({
      sessionId: owned.id,
      hand: "right",
      gripStyleStated: null,
      measurements: { handLengthMm: 180, palmLengthMm: 100, palmWidthMm: 85 },
      scaleCheckRatio: null,
      measurementModelVersion: "landmark-raw-v2",
      calibrationMethod: "user-length",
      calibrationEvidence: evidence,
    });

    const mine = await handleScanMeasurements(request(scanId), scanId, {
      repo,
      getUserId: async () => "user-1",
    });
    const theirs = await handleScanMeasurements(request(scanId), scanId, {
      repo,
      getUserId: async () => "user-2",
    });

    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(404);
    await pg.close();
  }, 30_000);
});
