/**
 * #63 against a real Postgres (PGlite): a scan keeps the measurement model
 * and calibration evidence it was submitted with, and rows written before
 * migration 0006 (no such columns) still read back.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readFileSync } from "node:fs";
import { CALIBRATION_METHODS } from "../../src/lib/contracts/measurement";
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

  it("has exactly the contract's calibration methods in the enum, and each one writes", async () => {
    const { pg, db } = await migratedDatabase();
    const { rows } = await pg.query<{ v: string }>(
      `SELECT unnest(enum_range(NULL::calibration_method))::text AS v`,
    );
    expect(rows.map((r) => r.v)).toEqual([...CALIBRATION_METHODS]);

    const repo = createDrizzleScanRepo(withSequentialBatch(db));
    const session = await repo.createAnonymousSession(
      new Date(Date.now() + 60_000),
    );
    for (const method of CALIBRATION_METHODS) {
      const { scanId } = await repo.insertScanWithMeasurements({
        sessionId: session.id,
        hand: "right",
        gripStyleStated: null,
        measurements: { handLengthMm: 186, palmLengthMm: 106, palmWidthMm: 82 },
        scaleCheckRatio: null,
        measurementModelVersion: "landmark-raw-v1",
        calibrationMethod: method,
        calibrationEvidence: {
          method: "user-length",
          referenceMeasurement: "handLengthMm",
          referenceMm: 186,
          parallaxCorrected: false,
        },
      });
      const stored = await pg.query<{ calibration_method: string }>(
        `SELECT calibration_method FROM scan_measurements WHERE scan_id = $1`,
        [scanId],
      );
      expect(stored.rows[0].calibration_method).toBe(method);
    }
    await pg.close();
  }, 30_000);

  it("old code that omits the new columns still inserts (they are nullable)", async () => {
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
    // NULL means "unknown" for rows written before 0006; a default would
    // backfill a value those rows never had.
    const { rows } = await pg.query<{
      measurement_model_version: string | null;
      calibration_method: string | null;
      calibration_evidence: unknown;
    }>(
      `SELECT measurement_model_version, calibration_method, calibration_evidence
         FROM scan_measurements WHERE scan_id = $1`,
      [scanId],
    );
    expect(rows[0]).toEqual({
      measurement_model_version: null,
      calibration_method: null,
      calibration_evidence: null,
    });
    await pg.close();
  }, 30_000);
});

// Same guarantees as 0005 (analysis-cache-db.test.ts): the neon-http
// migrator sends each statement separately with no transaction, so 0006 must
// be one statement and safe to re-run.
describe("migration 0006", () => {
  const sql = readFileSync(
    new URL("../../drizzle/0006_sad_energizer.sql", import.meta.url),
    "utf8",
  );

  it("is a single statement", () => {
    expect(sql.split("--> statement-breakpoint")).toHaveLength(1);
    expect(sql.match(/^DO \$\$/m)).not.toBeNull();
  });

  it("re-runs without error", async () => {
    const { pg } = await migratedDatabase();
    await pg.exec(sql);
    await pg.exec(sql);
    const { rows } = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'scan_measurements'
          AND column_name IN ('measurement_model_version', 'calibration_method', 'calibration_evidence')`,
    );
    expect(rows[0].n).toBe(3);
    await pg.close();
  }, 30_000);
});
