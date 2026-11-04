import { describe, expect, it } from "vitest";
import { handleScanSubmission } from "../../src/server/scans/submit";
import {
  calibrationMethodOf,
  cardEdgeEvidenceSchema,
  scanSubmissionSchema,
} from "../../src/lib/contracts/measurement";
import { buildCardSubmission } from "../../src/client/card/cardSubmission";
import { createFakeRepo } from "./fixtures/fake-scan-repo";

/**
 * v3.4 card reference (candidate, Kirby OK 2026-11-05): the `card-edge`
 * evidence through the contract and the real `handleScanSubmission`.
 */
function post(body: unknown, repo: ReturnType<typeof createFakeRepo>["repo"]) {
  return handleScanSubmission(
    new Request("http://localhost/api/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { repo, getUserId: async () => null },
  );
}

const MEASUREMENTS = {
  handLengthMm: 190.1,
  palmLengthMm: 104.2,
  palmWidthMm: 64.6,
  middleLengthMm: 79.9,
};
const ID1 = { longMm: 85.6, shortMm: 53.98 };
const BODY = buildCardSubmission({
  hand: "right",
  measurements: MEASUREMENTS,
  cardSize: ID1,
  searchPass: "slot",
  cardFitRmsMm: 0.4,
});

describe("card-edge evidence (contract)", () => {
  it("is its own calibration method", () => {
    expect(calibrationMethodOf(BODY.calibration)).toBe("card-edge");
  });

  it("refuses an unknown key, a bad pass, a negative or huge residual, a silly card", () => {
    const ok = BODY.calibration;
    const bad = [
      { ...ok, extra: 1 },
      { ...ok, searchPass: "whole-frame" },
      { ...ok, cardFitRmsMm: -0.1 },
      { ...ok, cardFitRmsMm: 6 },
      { ...ok, cardSizeMm: { longMm: 5, shortMm: 53.98 } },
      { ...ok, parallaxCorrected: undefined },
    ];
    for (const e of bad)
      expect(cardEdgeEvidenceSchema.safeParse(e).success).toBe(false);
    expect(
      scanSubmissionSchema.safeParse({ ...BODY, calibration: bad[0] }).success,
    ).toBe(false);
  });
});

describe("POST /api/scans with a card", () => {
  it("stores calibrationMethod card-edge, no scale-check ratio, and the evidence as sent", async () => {
    const { repo, insertedScans } = createFakeRepo();
    const res = await post(BODY, repo);
    expect(res.status).toBe(201);
    expect(insertedScans).toHaveLength(1);
    const stored = insertedScans[0]!;
    expect(stored.calibrationMethod).toBe("card-edge");
    expect(stored.scaleCheckRatio).toBeNull();
    expect(stored.calibrationEvidence).toEqual(BODY.calibration);
    expect(stored.measurements).toEqual(MEASUREMENTS);
  });
});
