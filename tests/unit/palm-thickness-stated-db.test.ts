/**
 * `palmThicknessStated` (the user's own thin / medium / thick answer, asked
 * after the scan; candidate, 2026-10-08) on a real Postgres (PGlite, with the
 * repo's own migrations): what the scan route stores, what the owner's
 * measurements lookup reads back, and what the account export carries.
 *
 * The rule these tests hold: skipping the question means the field is absent
 * and the column is NULL. Nothing between the request and the row may fill in
 * "medium". The measured `palm_thickness_mm` is a different column and is
 * never touched by this one.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MEASUREMENT_MODEL_VERSION,
  PALM_THICKNESS_LEVELS,
  scanSubmissionSchema,
} from "../../src/lib/contracts/measurement";
import { handleAccountScansList } from "../../src/server/account/handlers";
import { createDrizzleAccountRepo } from "../../src/server/account/drizzle-repo";
import { createDrizzleScanRepo } from "../../src/server/scans/drizzle-repo";
import { handleScanSubmission } from "../../src/server/scans/submit";
import { migratedDatabase, withSequentialBatch } from "./fixtures/pglite";

type ScanDb = Parameters<typeof createDrizzleScanRepo>[0];
type AccountDb = Parameters<typeof createDrizzleAccountRepo>[0];

const evidence = {
  method: "user-length" as const,
  referenceMeasurement: "handLengthMm" as const,
  referenceMm: 186,
  parallaxCorrected: false as const,
};

const baseSubmission = {
  hand: "right",
  measurements: { handLengthMm: 186, palmLengthMm: 106, palmWidthMm: 82 },
  calibration: {
    method: "user-length",
    referenceMeasurement: "handLengthMm",
    referenceMm: 186,
    parallaxCorrected: false,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
};

async function world() {
  const { pg, db } = await migratedDatabase();
  const repo = createDrizzleScanRepo(withSequentialBatch<ScanDb>(db));
  const accountRepo = createDrizzleAccountRepo(
    withSequentialBatch<AccountDb>(db),
  );
  return { pg, repo, accountRepo };
}

const post = (body: unknown) =>
  new Request("http://localhost/api/scans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function storedStated(
  pg: Awaited<ReturnType<typeof world>>["pg"],
  scanId: string,
) {
  const { rows } = await pg.query<{
    palm_thickness_stated: string | null;
    is_null: boolean;
    is_medium: boolean | null;
  }>(
    `SELECT palm_thickness_stated,
            palm_thickness_stated IS NULL AS is_null,
            palm_thickness_stated = 'medium' AS is_medium
       FROM scans WHERE id = $1`,
    [scanId],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe("scans.palm_thickness_stated, the column (migration 0008)", () => {
  it("is a nullable text column with no default", async () => {
    const { pg } = await world();
    const { rows } = await pg.query<{
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'scans' AND column_name = 'palm_thickness_stated'`,
    );
    expect(rows).toEqual([
      { data_type: "text", is_nullable: "YES", column_default: null },
    ]);
    await pg.close();
  }, 30_000);

  it("old code that never names the column still inserts, and the row reads NULL, not medium", async () => {
    const { pg, repo } = await world();
    const session = await repo.createAnonymousSession(
      new Date(Date.now() + 60_000),
    );
    const scanId = crypto.randomUUID();
    await pg.query(
      `INSERT INTO scans (id, session_id, hand) VALUES ($1, $2, 'left')`,
      [scanId, session.id],
    );
    const row = await storedStated(pg, scanId);
    expect(row.palm_thickness_stated).toBeNull();
    expect(row.is_null).toBe(true);
    await pg.close();
  }, 30_000);
});

describe("createDrizzleScanRepo(): palmThicknessStated is written and read back", () => {
  it.each(PALM_THICKNESS_LEVELS)(
    "stores %s and findOwnedScan returns it",
    async (level) => {
      const { pg, repo } = await world();
      const session = await repo.createAnonymousSession(
        new Date(Date.now() + 60_000),
      );
      const { scanId } = await repo.insertScanWithMeasurements({
        sessionId: session.id,
        hand: "right",
        gripStyleStated: null,
        palmThicknessStated: level,
        measurements: { handLengthMm: 186, palmLengthMm: 106, palmWidthMm: 82 },
        scaleCheckRatio: null,
        measurementModelVersion: "landmark-raw-v2",
        calibrationMethod: "user-length",
        calibrationEvidence: evidence,
      });

      expect((await storedStated(pg, scanId)).palm_thickness_stated).toBe(
        level,
      );
      const owned = await repo.findOwnedScan(scanId, {
        userId: null,
        cookieSessionId: session.id,
        now: new Date(),
      });
      expect(owned?.palmThicknessStated).toBe(level);
      await pg.close();
    },
    30_000,
  );

  it("stores NULL when the answer is null, and findOwnedScan returns null (never medium)", async () => {
    const { pg, repo } = await world();
    const session = await repo.createAnonymousSession(
      new Date(Date.now() + 60_000),
    );
    const { scanId } = await repo.insertScanWithMeasurements({
      sessionId: session.id,
      hand: "right",
      gripStyleStated: "claw",
      palmThicknessStated: null,
      measurements: { handLengthMm: 186, palmLengthMm: 106, palmWidthMm: 82 },
      scaleCheckRatio: null,
      measurementModelVersion: "landmark-raw-v2",
      calibrationMethod: "user-length",
      calibrationEvidence: evidence,
    });

    const row = await storedStated(pg, scanId);
    expect(row.palm_thickness_stated).toBeNull();
    expect(row.is_null).toBe(true);
    expect(row.is_medium).toBeNull(); // NULL = 'medium' is NULL, not false
    const owned = await repo.findOwnedScan(scanId, {
      userId: null,
      cookieSessionId: session.id,
      now: new Date(),
    });
    expect(owned).not.toBeNull();
    expect(owned?.palmThicknessStated).toBeNull();
    expect(owned?.palmThicknessStated).not.toBe("medium");
    await pg.close();
  }, 30_000);

  it("is independent of the measured palm_thickness_mm, in both directions", async () => {
    const { pg, repo } = await world();
    const session = await repo.createAnonymousSession(
      new Date(Date.now() + 60_000),
    );
    const input = {
      sessionId: session.id,
      hand: "right" as const,
      gripStyleStated: null,
      scaleCheckRatio: null,
      measurementModelVersion: "landmark-raw-v2" as const,
      calibrationMethod: "user-length" as const,
      calibrationEvidence: evidence,
    };
    const statedOnly = await repo.insertScanWithMeasurements({
      ...input,
      palmThicknessStated: "thin",
      measurements: { handLengthMm: 186, palmLengthMm: 106, palmWidthMm: 82 },
    });
    const measuredOnly = await repo.insertScanWithMeasurements({
      ...input,
      palmThicknessStated: null,
      measurements: {
        handLengthMm: 186,
        palmLengthMm: 106,
        palmWidthMm: 82,
        palmThicknessMm: 31.5,
      },
    });

    const mm = async (scanId: string) =>
      (
        await pg.query<{ palm_thickness_mm: string | null }>(
          `SELECT palm_thickness_mm FROM scan_measurements WHERE scan_id = $1`,
          [scanId],
        )
      ).rows[0]!.palm_thickness_mm;

    expect(await mm(statedOnly.scanId)).toBeNull();
    expect(
      (await storedStated(pg, statedOnly.scanId)).palm_thickness_stated,
    ).toBe("thin");
    expect(Number(await mm(measuredOnly.scanId))).toBe(31.5);
    expect(
      (await storedStated(pg, measuredOnly.scanId)).palm_thickness_stated,
    ).toBeNull();
    await pg.close();
  }, 30_000);
});

describe("POST /api/scans on a real database: the answer, or the skip", () => {
  it.each(PALM_THICKNESS_LEVELS)(
    "a submission with palmThicknessStated %s is stored as %s",
    async (level) => {
      const { pg, repo } = await world();
      const res = await handleScanSubmission(
        post({ ...baseSubmission, palmThicknessStated: level }),
        { repo, getUserId: async () => null },
      );
      expect(res.status).toBe(201);
      const { scanId } = await res.json();
      expect((await storedStated(pg, scanId)).palm_thickness_stated).toBe(
        level,
      );
      await pg.close();
    },
    30_000,
  );

  it("a skipped question (field absent) is stored as NULL, not medium", async () => {
    const { pg, repo } = await world();
    expect("palmThicknessStated" in baseSubmission).toBe(false);
    const res = await handleScanSubmission(post(baseSubmission), {
      repo,
      getUserId: async () => null,
    });
    expect(res.status).toBe(201);
    const { scanId } = await res.json();
    const row = await storedStated(pg, scanId);
    expect(row.palm_thickness_stated).toBeNull();
    expect(row.is_null).toBe(true);
    await pg.close();
  }, 30_000);

  it.each([["huge"], [""], [null], [2], ["Medium"], ["THIN"]])(
    "rejects palmThicknessStated %j with 400 and stores nothing",
    async (bad) => {
      const { pg, repo } = await world();
      expect(
        scanSubmissionSchema.safeParse({
          ...baseSubmission,
          palmThicknessStated: bad,
        }).success,
      ).toBe(false);
      const res = await handleScanSubmission(
        post({ ...baseSubmission, palmThicknessStated: bad }),
        { repo, getUserId: async () => null },
      );
      expect(res.status).toBe(400);
      const { rows } = await pg.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM scans`,
      );
      expect(rows[0]!.n).toBe(0);
      await pg.close();
    },
    30_000,
  );
});

describe("GET /api/account/scans on a real database: the export carries the answer", () => {
  it("includes palmThicknessStated for an answered scan and null for a skipped one", async () => {
    const { pg, repo, accountRepo } = await world();
    await pg.query(`INSERT INTO users (id) VALUES ('user-1')`);
    const claimed = await repo.createClaimedSession("user-1");
    const common = {
      sessionId: claimed.id,
      hand: "right" as const,
      gripStyleStated: null,
      measurements: { handLengthMm: 186, palmLengthMm: 106, palmWidthMm: 82 },
      scaleCheckRatio: null,
      measurementModelVersion: "landmark-raw-v2" as const,
      calibrationMethod: "user-length" as const,
      calibrationEvidence: evidence,
    };
    const answered = await repo.insertScanWithMeasurements({
      ...common,
      palmThicknessStated: "thick",
    });
    // Later createdAt so ordering (newest first) is deterministic.
    await pg.query(
      `UPDATE scans SET created_at = now() + interval '1 minute' WHERE id = $1`,
      [answered.scanId],
    );
    const skipped = await repo.insertScanWithMeasurements({
      ...common,
      palmThicknessStated: null,
    });

    const res = await handleAccountScansList({
      repo: accountRepo,
      getUserId: async () => "user-1",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scans: { scanId: string; palmThicknessStated: unknown }[];
    };
    const byId = new Map(body.scans.map((s) => [s.scanId, s]));
    expect(byId.size).toBe(2);
    expect(byId.get(answered.scanId)).toHaveProperty(
      "palmThicknessStated",
      "thick",
    );
    // The key is present and null: an export reader can tell "skipped" from
    // "field missing", and it is never "medium".
    expect(byId.get(skipped.scanId)).toHaveProperty(
      "palmThicknessStated",
      null,
    );
    await pg.close();
  }, 30_000);
});
