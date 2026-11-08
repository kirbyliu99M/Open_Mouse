/**
 * `toHandSampleRow` (src/server/scans/hand-sample.ts): the de-linked sample a
 * scan may leave behind (contract src/lib/contracts/hand-sample.ts,
 * candidate). Pure: what the row keeps, what it never keeps, and when it
 * gives way so the scan is stored alone.
 */
import { describe, expect, it } from "vitest";
import { HAND_SAMPLE_NOTICE_VERSION } from "../../src/lib/contracts/hand-sample";
import { MEASUREMENT_MODEL_VERSION } from "../../src/lib/contracts/measurement";
import { toHandSampleRow } from "../../src/server/scans/hand-sample";
import type { ScanInsertInput } from "../../src/server/scans/repo";
import { handleScanSubmission } from "../../src/server/scans/submit";
import { createFakeRepo } from "./fixtures/fake-scan-repo";

const NOW = new Date("2026-11-08T15:47:12.345Z");

function input(overrides: Partial<ScanInsertInput> = {}): ScanInsertInput {
  return {
    sessionId: "00000000-0000-4000-8000-000000000001",
    hand: "right",
    gripStyleStated: "claw",
    palmThicknessStated: "thick",
    measurements: {
      handLengthMm: 186.4,
      palmLengthMm: 106.5,
      palmWidthMm: 82.49,
      thumbLengthMm: 61.2,
      indexLengthMm: 72.7,
      middleLengthMm: 80.5,
      ringLengthMm: 75.1,
      pinkyLengthMm: 58.9,
      palmThicknessMm: 31.3,
      knuckleHeightMm: 22.2,
      gripApertureMm: 91.1,
      thumbAngleDeg: 44.4,
    },
    scaleCheckRatio: null,
    measurementModelVersion: MEASUREMENT_MODEL_VERSION,
    calibrationMethod: "card-edge",
    calibrationEvidence: {
      method: "card-edge",
      cardSizeMm: { longMm: 85.6, shortMm: 53.98 },
      searchPass: "slot",
      cardFitRmsMm: 0.4,
      parallaxCorrected: true,
    },
    sampleNotice: HAND_SAMPLE_NOTICE_VERSION,
    ...overrides,
  };
}

describe("toHandSampleRow", () => {
  it("keeps exactly the sample columns, rounded to whole mm, at the UTC month", () => {
    expect(toHandSampleRow(input(), NOW)).toEqual({
      noticeVersion: HAND_SAMPLE_NOTICE_VERSION,
      sampledMonth: new Date("2026-11-01T00:00:00.000Z"),
      hand: "right",
      gripStyleStated: "claw",
      palmThicknessStated: "thick",
      calibrationMethod: "card-edge",
      measurementModelVersion: MEASUREMENT_MODEL_VERSION,
      handLengthMm: 186,
      palmLengthMm: 107,
      palmWidthMm: 82,
      thumbLengthMm: 61,
      indexLengthMm: 73,
      middleLengthMm: 81,
      ringLengthMm: 75,
      pinkyLengthMm: 59,
    });
  });

  it("never carries an id, the session, the evidence, a side/grip measurement or a finer time", () => {
    const row = toHandSampleRow(input(), NOW)!;
    const keys = Object.keys(row);
    for (const forbidden of [
      "id",
      "scanId",
      "sessionId",
      "userId",
      "calibrationEvidence",
      "scaleCheckRatio",
      "palmThicknessMm",
      "knuckleHeightMm",
      "gripApertureMm",
      "thumbAngleDeg",
      "createdAt",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(JSON.stringify(row)).not.toContain(input().sessionId);
    expect(row.sampledMonth.getUTCDate()).toBe(1);
    expect(row.sampledMonth.getUTCHours()).toBe(0);
    expect(row.sampledMonth.getUTCMinutes()).toBe(0);
    expect(row.sampledMonth.getUTCMilliseconds()).toBe(0);
  });

  it("takes the UTC month, not the Taipei one, at a month boundary", () => {
    // 2026-11-30T20:00Z is already 12-01 04:00 in Taipei.
    const row = toHandSampleRow(input(), new Date("2026-11-30T20:00:00Z"))!;
    expect(row.sampledMonth.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("is null without the notice (opted out, or a client older than it)", () => {
    expect(toHandSampleRow(input({ sampleNotice: undefined }), NOW)).toBeNull();
    const withoutKey = input();
    delete withoutKey.sampleNotice;
    expect("sampleNotice" in withoutKey).toBe(false);
    expect(toHandSampleRow(withoutKey, NOW)).toBeNull();
  });

  it("is null for any notice version other than the current one", () => {
    const stale = input({
      sampleNotice:
        "hand-sample-notice-v0" as typeof HAND_SAMPLE_NOTICE_VERSION,
    });
    expect(toHandSampleRow(stale, NOW)).toBeNull();
  });

  it("writes null, never a default, for skipped answers and absent fingers", () => {
    const row = toHandSampleRow(
      input({
        gripStyleStated: null,
        palmThicknessStated: null,
        measurements: { handLengthMm: 186, palmLengthMm: 106, palmWidthMm: 82 },
      }),
      NOW,
    )!;
    expect(row.gripStyleStated).toBeNull();
    expect(row.palmThicknessStated).toBeNull();
    expect(row.thumbLengthMm).toBeNull();
    expect(row.indexLengthMm).toBeNull();
    expect(row.middleLengthMm).toBeNull();
    expect(row.ringLengthMm).toBeNull();
    expect(row.pinkyLengthMm).toBeNull();
  });

  it("gives way when the palm length rounds up to the hand length (CHECK palm < hand)", () => {
    // Valid for the scan (150.4 < 150.6) but both round to 151.
    const edge = input({
      measurements: {
        handLengthMm: 150.6,
        palmLengthMm: 150.5,
        palmWidthMm: 82,
      },
    });
    expect(toHandSampleRow(edge, NOW)).toBeNull();
  });

  it.each([
    ["hand length at the top edge", { handLengthMm: 280 }, true],
    [
      "hand length at the bottom edge",
      { handLengthMm: 100, palmLengthMm: 60 },
      true,
    ],
    ["palm width at the top edge", { palmWidthMm: 150 }, true],
    ["palm width at the bottom edge", { palmWidthMm: 50 }, true],
    ["palm width rounding to 50", { palmWidthMm: 50.4 }, true],
  ] as const)("keeps a sample with %s", (_name, patch, kept) => {
    const base = input().measurements;
    const row = toHandSampleRow(
      input({ measurements: { ...base, ...patch } }),
      NOW,
    );
    expect(row !== null).toBe(kept);
  });

  it("gives way for values outside the CHECK, whatever got past the schema", () => {
    const base = input().measurements;
    for (const patch of [
      { handLengthMm: 280.6 },
      { handLengthMm: 99.4, palmLengthMm: 60 },
      { palmWidthMm: 150.6 },
      { palmWidthMm: 49.4 },
    ]) {
      expect(
        toHandSampleRow(input({ measurements: { ...base, ...patch } }), NOW),
      ).toBeNull();
    }
  });
});

describe("POST /api/scans passes sampleNotice through to the repo", () => {
  const body = {
    hand: "right",
    measurements: {
      handLengthMm: 186.4,
      palmLengthMm: 106.2,
      palmWidthMm: 82.6,
    },
    calibration: {
      method: "user-length",
      referenceMeasurement: "handLengthMm",
      referenceMm: 186.4,
      parallaxCorrected: false,
    },
    measurementModelVersion: MEASUREMENT_MODEL_VERSION,
  };
  const post = (payload: unknown) =>
    handleScanSubmission(
      new Request("http://localhost/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
      { repo: fake.repo, getUserId: async () => null },
    );
  let fake = createFakeRepo(() => NOW);

  it("with the notice: the repo gets it and one rounded sample is kept", async () => {
    fake = createFakeRepo(() => NOW);
    const res = await post({
      ...body,
      sampleNotice: HAND_SAMPLE_NOTICE_VERSION,
    });
    expect(res.status).toBe(201);
    expect(fake.insertedScans[0]!.sampleNotice).toBe(
      HAND_SAMPLE_NOTICE_VERSION,
    );
    expect(fake.handSamples).toHaveLength(1);
    expect(fake.handSamples[0]).toMatchObject({
      handLengthMm: 186,
      palmLengthMm: 106,
      palmWidthMm: 83,
      sampledMonth: new Date("2026-11-01T00:00:00.000Z"),
    });
  });

  it("without the notice: the repo gets none and no sample is kept", async () => {
    fake = createFakeRepo(() => NOW);
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(fake.insertedScans[0]!.sampleNotice).toBeUndefined();
    expect(fake.handSamples).toHaveLength(0);
  });

  it("400s an unknown notice version and stores nothing", async () => {
    fake = createFakeRepo(() => NOW);
    const res = await post({ ...body, sampleNotice: "hand-sample-notice-v0" });
    expect(res.status).toBe(400);
    expect(fake.insertedScans).toHaveLength(0);
    expect(fake.handSamples).toHaveLength(0);
  });
});
