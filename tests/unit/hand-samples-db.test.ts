/**
 * The de-linked hand sample (contract src/lib/contracts/hand-sample.ts,
 * candidate; table `hand_samples`, migration 0015) on a real Postgres
 * (PGlite with the repo's own migrations), through the real scan route and
 * repo:
 *
 *   - with the current notice, the scan leaves exactly one sample: rounded
 *     whole millimetres, the UTC month only, and no column that could lead
 *     back to the scan, its session or its account;
 *   - without it (opted out, or an older client), no sample at all;
 *   - deleting the scan, its session or the whole account leaves the sample,
 *     by design (the notice says so before the scan is sent);
 *   - a scan whose rounded values would break the table's CHECK is still
 *     stored, alone.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { HAND_SAMPLE_NOTICE_VERSION } from "../../src/lib/contracts/hand-sample";
import { MEASUREMENT_MODEL_VERSION } from "../../src/lib/contracts/measurement";
import { createDrizzleAccountRepo } from "../../src/server/account/drizzle-repo";
import { createDrizzleScanRepo } from "../../src/server/scans/drizzle-repo";
import type { ScanInsertInput } from "../../src/server/scans/repo";
import { handleScanSubmission } from "../../src/server/scans/submit";
import {
  count,
  migratedDatabase,
  withSequentialBatch,
} from "./fixtures/pglite";

type ScanDb = Parameters<typeof createDrizzleScanRepo>[0];
type AccountDb = Parameters<typeof createDrizzleAccountRepo>[0];

async function world() {
  const { pg, db } = await migratedDatabase();
  const repo = createDrizzleScanRepo(withSequentialBatch<ScanDb>(db));
  const accountRepo = createDrizzleAccountRepo(
    withSequentialBatch<AccountDb>(db),
  );
  return { pg, repo, accountRepo };
}

const userLength = (mm: number) => ({
  method: "user-length" as const,
  referenceMeasurement: "handLengthMm" as const,
  referenceMm: mm,
  parallaxCorrected: false as const,
});

function scanInput(
  sessionId: string,
  overrides: Partial<ScanInsertInput> = {},
): ScanInsertInput {
  return {
    sessionId,
    hand: "left",
    gripStyleStated: "palm",
    palmThicknessStated: "thin",
    measurements: {
      handLengthMm: 183.6,
      palmLengthMm: 101.4,
      palmWidthMm: 84.5,
      indexLengthMm: 71.49,
    },
    scaleCheckRatio: null,
    measurementModelVersion: MEASUREMENT_MODEL_VERSION,
    calibrationMethod: "user-length",
    calibrationEvidence: userLength(183.6),
    sampleNotice: HAND_SAMPLE_NOTICE_VERSION,
    ...overrides,
  };
}

const post = (body: unknown) =>
  new Request("http://localhost/api/scans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const submissionBody = {
  hand: "right",
  gripStyleStated: "claw",
  measurements: { handLengthMm: 190.7, palmLengthMm: 108.2, palmWidthMm: 86.5 },
  calibration: userLength(190.7),
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
};

async function samples(pg: Awaited<ReturnType<typeof world>>["pg"]) {
  const { rows } = await pg.query<Record<string, unknown>>(
    `SELECT * FROM hand_samples`,
  );
  return rows;
}

describe("hand_samples, the table (migration 0015)", () => {
  it("has no column and no foreign key that could lead back to a scan, session or user", async () => {
    const { pg } = await world();
    const { rows: columns } = await pg.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'hand_samples' ORDER BY ordinal_position`,
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      "id",
      "notice_version",
      "sampled_month",
      "hand",
      "grip_style_stated",
      "palm_thickness_stated",
      "calibration_method",
      "measurement_model_version",
      "hand_length_mm",
      "palm_length_mm",
      "palm_width_mm",
      "thumb_length_mm",
      "index_length_mm",
      "middle_length_mm",
      "ring_length_mm",
      "pinky_length_mm",
    ]);
    expect(
      await count(
        pg,
        `SELECT count(*) AS n FROM information_schema.table_constraints
          WHERE table_name = 'hand_samples' AND constraint_type = 'FOREIGN KEY'`,
      ),
    ).toBe(0);
    await pg.close();
  }, 30_000);
});

describe("POST /api/scans on a real database: the sample", () => {
  it("with the notice: one row, rounded to whole mm, month only, nothing of the scan", async () => {
    const { pg, repo } = await world();
    const now = new Date();
    const res = await handleScanSubmission(
      post({ ...submissionBody, sampleNotice: HAND_SAMPLE_NOTICE_VERSION }),
      { repo, getUserId: async () => null, now: () => now },
    );
    expect(res.status).toBe(201);
    const { scanId } = (await res.json()) as { scanId: string };

    const rows = await samples(pg);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      notice_version: HAND_SAMPLE_NOTICE_VERSION,
      hand: "right",
      grip_style_stated: "claw",
      palm_thickness_stated: null,
      calibration_method: "user-length",
      measurement_model_version: MEASUREMENT_MODEL_VERSION,
      hand_length_mm: 191,
      palm_length_mm: 108,
      palm_width_mm: 87,
      thumb_length_mm: null,
      index_length_mm: null,
      middle_length_mm: null,
      ring_length_mm: null,
      pinky_length_mm: null,
    });
    // Month only: the first instant of the current UTC month.
    const month = new Date(row.sampled_month as string | Date);
    const expected = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    // A test that straddles midnight UTC on the 1st could see the next month.
    expect([
      expected.getTime(),
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    ]).toContain(month.getTime());
    // Nothing in the row names the scan or its session.
    const session = await pg.query<{ session_id: string }>(
      `SELECT session_id FROM scans WHERE id = $1`,
      [scanId],
    );
    const text = JSON.stringify(row);
    expect(text).not.toContain(scanId);
    expect(text).not.toContain(session.rows[0]!.session_id);
    expect(row.id).not.toBe(scanId);
    await pg.close();
  }, 30_000);

  it("without the notice: the scan is stored and no row is written", async () => {
    const { pg, repo } = await world();
    const res = await handleScanSubmission(post(submissionBody), {
      repo,
      getUserId: async () => null,
    });
    expect(res.status).toBe(201);
    expect(await count(pg, `SELECT count(*) AS n FROM scans`)).toBe(1);
    expect(await count(pg, `SELECT count(*) AS n FROM hand_samples`)).toBe(0);
    await pg.close();
  }, 30_000);
});

describe("createDrizzleScanRepo().insertScanWithMeasurements: the sample", () => {
  it("writes the finger lengths it was given, rounded", async () => {
    const { pg, repo } = await world();
    const session = await repo.createAnonymousSession(
      new Date(Date.now() + 60_000),
    );
    await repo.insertScanWithMeasurements(scanInput(session.id));
    const [row] = await samples(pg);
    expect(row).toMatchObject({
      hand: "left",
      grip_style_stated: "palm",
      palm_thickness_stated: "thin",
      hand_length_mm: 184,
      palm_length_mm: 101,
      palm_width_mm: 85,
      index_length_mm: 71,
      thumb_length_mm: null,
    });
    await pg.close();
  }, 30_000);

  it("stores the scan alone when rounding would break the CHECK (palm length = hand length)", async () => {
    const { pg, repo } = await world();
    const session = await repo.createAnonymousSession(
      new Date(Date.now() + 60_000),
    );
    const { scanId } = await repo.insertScanWithMeasurements(
      scanInput(session.id, {
        measurements: {
          handLengthMm: 150.6,
          palmLengthMm: 150.5,
          palmWidthMm: 80,
        },
        calibrationEvidence: userLength(150.6),
      }),
    );
    expect(
      await count(
        pg,
        `SELECT count(*) AS n FROM scans s
           JOIN scan_measurements m ON m.scan_id = s.id
          WHERE s.id = '${scanId}'`,
      ),
    ).toBe(1);
    expect(await count(pg, `SELECT count(*) AS n FROM hand_samples`)).toBe(0);
    await pg.close();
  }, 30_000);
});

describe("deleting a scan, its session or the account leaves the sample (by design)", () => {
  it("survives the anonymous session's delete and the expiry sweep", async () => {
    const { pg, repo } = await world();
    const live = await repo.createAnonymousSession(
      new Date(Date.now() + 60_000),
    );
    const expired = await repo.createAnonymousSession(
      new Date(Date.now() - 60_000),
    );
    await repo.insertScanWithMeasurements(scanInput(live.id));
    await repo.insertScanWithMeasurements(scanInput(expired.id));
    expect(await count(pg, `SELECT count(*) AS n FROM hand_samples`)).toBe(2);

    await repo.deleteSession(live.id);
    expect(await repo.deleteExpiredAnonymousSessions(new Date())).toBe(1);
    expect(await count(pg, `SELECT count(*) AS n FROM scans`)).toBe(0);
    expect(await count(pg, `SELECT count(*) AS n FROM hand_samples`)).toBe(2);
    await pg.close();
  }, 30_000);

  it("survives the owner's single-scan delete and 'delete everything'", async () => {
    const { pg, repo, accountRepo } = await world();
    await pg.query(`INSERT INTO users (id) VALUES ('user-1')`);
    const session = await repo.createClaimedSession("user-1");
    const first = await repo.insertScanWithMeasurements(scanInput(session.id));
    await repo.insertScanWithMeasurements(scanInput(session.id));
    expect(await count(pg, `SELECT count(*) AS n FROM hand_samples`)).toBe(2);

    expect(
      await repo.deleteOwnedScan(first.scanId, {
        userId: "user-1",
        cookieSessionId: null,
        now: new Date(),
      }),
    ).toBe(true);
    expect(await count(pg, `SELECT count(*) AS n FROM hand_samples`)).toBe(2);

    expect(await accountRepo.deleteAllScans("user-1")).toBe(1);
    expect(await count(pg, `SELECT count(*) AS n FROM users`)).toBe(0);
    expect(await count(pg, `SELECT count(*) AS n FROM scans`)).toBe(0);
    expect(await count(pg, `SELECT count(*) AS n FROM hand_samples`)).toBe(2);
    await pg.close();
  }, 30_000);
});
