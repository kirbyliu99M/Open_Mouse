/**
 * landmark-raw-v3 (V3.2 F12, candidate): the scan and account repos read
 * `calibration_evidence.parallaxCorrected` (jsonb) back, so the engine scale
 * (`fitScaleMeasurements`) and the page (`shownAccountMeasurements`) can tell a
 * corrected scan from an uncorrected one, old records included (D3). PGlite,
 * real migrations.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ScanSubmission } from "../../src/lib/contracts/measurement";
import { createDrizzleAccountRepo } from "../../src/server/account/drizzle-repo";
import { createDrizzleScanRepo } from "../../src/server/scans/drizzle-repo";
import { migratedDatabase, withSequentialBatch } from "./fixtures/pglite";

type ScanDb = Parameters<typeof createDrizzleScanRepo>[0];
type AccountDb = Parameters<typeof createDrizzleAccountRepo>[0];

const paperEdge = (
  parallaxCorrected: boolean,
  focalSource?: "exif" | "homography" | "nominal" | "none",
): ScanSubmission["calibration"] => ({
  method: "paper-edge",
  paperSize: "a4",
  edgeFitResidualMm: 0.4,
  minSideCoverage: 0.9,
  parallaxCorrected,
  ...(focalSource ? { focalSource } : {}),
});

describe("parallaxCorrected is read back from the stored evidence", () => {
  it("findOwnedScan and listScans: true, false, and an older (v2) corrected record without focalSource", async () => {
    const { pg, db } = await migratedDatabase();
    const repo = createDrizzleScanRepo(withSequentialBatch<ScanDb>(db));
    const accountRepo = createDrizzleAccountRepo(
      withSequentialBatch<AccountDb>(db),
    );
    await pg.query(`INSERT INTO users (id) VALUES ('user-1')`);
    const session = await repo.createClaimedSession("user-1");
    const insert = (
      calibrationEvidence: ScanSubmission["calibration"],
      version: "landmark-raw-v2" | "landmark-raw-v3",
    ) =>
      repo.insertScanWithMeasurements({
        sessionId: session.id,
        hand: "right",
        gripStyleStated: null,
        palmThicknessStated: null,
        measurements: { handLengthMm: 185, palmLengthMm: 103, palmWidthMm: 64 },
        scaleCheckRatio: null,
        measurementModelVersion: version,
        calibrationMethod: "paper-edge",
        calibrationEvidence,
      });
    const nominal = await insert(paperEdge(true, "nominal"), "landmark-raw-v3");
    const none = await insert(paperEdge(false, "none"), "landmark-raw-v3");
    const oldExif = await insert(paperEdge(true), "landmark-raw-v2");

    const ctx = { userId: "user-1", cookieSessionId: null, now: new Date() };
    expect((await repo.findOwnedScan(nominal.scanId, ctx))?.parallaxCorrected).toBe(
      true,
    );
    expect((await repo.findOwnedScan(none.scanId, ctx))?.parallaxCorrected).toBe(
      false,
    );
    expect(
      (await repo.findOwnedScan(oldExif.scanId, ctx))?.parallaxCorrected,
    ).toBe(true);
    // The stored numbers are never changed.
    expect((await repo.findOwnedScan(nominal.scanId, ctx))?.measurements).toMatchObject(
      { handLengthMm: 185, palmLengthMm: 103, palmWidthMm: 64 },
    );

    const listed = new Map(
      (await accountRepo.listScans("user-1")).map((s) => [s.scanId, s]),
    );
    expect(listed.get(nominal.scanId)?.parallaxCorrected).toBe(true);
    expect(listed.get(none.scanId)?.parallaxCorrected).toBe(false);
    expect(listed.get(oldExif.scanId)?.parallaxCorrected).toBe(true);
    expect(listed.get(nominal.scanId)?.measurements.handLengthMm).toBe(185);
    await pg.close();
  }, 30_000);
});
