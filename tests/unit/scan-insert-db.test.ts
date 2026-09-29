/**
 * #63 against a real Postgres (PGlite): a scan keeps the measurement model
 * and calibration evidence it was submitted with, and rows written before
 * migration 0006 (no such columns) still read back.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDrizzleScanRepo } from "../../src/server/scans/drizzle-repo";
import { migratedDatabase } from "./fixtures/pglite";

type ScanDb = Parameters<typeof createDrizzleScanRepo>[0];

// PGlite's drizzle driver has no `db.batch` (neon-http's atomic multi-query
// request). Run the batch's queries in order instead: this test checks the
// repo's column mapping against the real schema, not batch atomicity.
function withSequentialBatch(db: object): ScanDb {
  return Object.assign(db, {
    batch: async (queries: PromiseLike<unknown>[]) => {
      const results: unknown[] = [];
      for (const query of queries) results.push(await query);
      return results;
    },
  }) as unknown as ScanDb;
}

describe("createDrizzleScanRepo().insertScanWithMeasurements", () => {
  it("stores the measurement model, calibration method and evidence", async () => {
    const { pg, db } = await migratedDatabase();
    const repo = createDrizzleScanRepo(withSequentialBatch(db));
    const session = await repo.createAnonymousSession(
      new Date(Date.now() + 60_000),
    );
    const evidence = {
      method: "paper-edge" as const,
      paperSize: "a4" as const,
      edgeFitResidualMm: 0.6,
      minSideCoverage: 0.72,
      parallaxCorrected: true,
    };
    const { scanId } = await repo.insertScanWithMeasurements({
      sessionId: session.id,
      hand: "right",
      gripStyleStated: null,
      measurements: { handLengthMm: 186, palmLengthMm: 106, palmWidthMm: 82 },
      scaleCheckRatio: null,
      measurementModelVersion: "landmark-raw-v1",
      calibrationMethod: "paper-edge",
      calibrationEvidence: evidence,
    });

    const { rows } = await pg.query<{
      measurement_model_version: string;
      calibration_method: string;
      calibration_evidence: unknown;
    }>(
      `SELECT measurement_model_version, calibration_method, calibration_evidence
         FROM scan_measurements WHERE scan_id = $1`,
      [scanId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].measurement_model_version).toBe("landmark-raw-v1");
    expect(rows[0].calibration_method).toBe("paper-edge");
    expect(rows[0].calibration_evidence).toEqual(evidence);
    await pg.close();
  }, 30_000);

  it("rejects a calibration method outside the enum", async () => {
    const { pg } = await migratedDatabase();
    await expect(
      pg.query(`SELECT 'selfie'::calibration_method`),
    ).rejects.toThrow();
    await pg.close();
  }, 30_000);

  it("keeps the new columns nullable for rows written before migration 0006", async () => {
    const { pg, db } = await migratedDatabase();
    const repo = createDrizzleScanRepo(withSequentialBatch(db));
    const session = await repo.createAnonymousSession(
      new Date(Date.now() + 60_000),
    );
    const scanId = crypto.randomUUID();
    await pg.query(
      `INSERT INTO scans (id, session_id, hand) VALUES ($1, $2, 'left')`,
      [scanId, session.id],
    );
    await pg.query(
      `INSERT INTO scan_measurements (scan_id, hand_length_mm, palm_length_mm, palm_width_mm)
       VALUES ($1, 180, 104, 80)`,
      [scanId],
    );
    const { rows } = await pg.query<{ calibration_method: string | null }>(
      `SELECT calibration_method FROM scan_measurements WHERE scan_id = $1`,
      [scanId],
    );
    expect(rows[0].calibration_method).toBeNull();
    await pg.close();
  }, 30_000);
});
