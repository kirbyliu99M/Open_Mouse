import { describe, expect, it } from "vitest";
import {
  checkPaperFound,
  checkPaperCornersSeen,
  checkPaperEdgeCoverage,
  checkPaperCurled,
  runPaperEdgeGates,
  type PaperEdgeGateInput,
} from "../../src/client/photo/gates";
import { PAPER_EDGE_LIMITS } from "../../src/lib/contracts/measurement";
import type { Point2 } from "../../src/client/geometry/homography";

describe("checkPaperFound", () => {
  it("passes whenever a paper region was located, regardless of cornersSeen", () => {
    expect(checkPaperFound(true)).toBeNull();
  });

  it("fails with an honest retake message when no paper region was found at all", () => {
    const failure = checkPaperFound(false);
    expect(failure).not.toBeNull();
    expect(failure!.code).toBe("PAPER_NOT_FOUND");
    expect(failure!.message).toMatch(/couldn't find a sheet of paper/i);
  });
});

describe("checkPaperCornersSeen", () => {
  it("passes at exactly 4", () => {
    expect(checkPaperCornersSeen(4)).toBeNull();
  });

  it("fails for 0, 1, 2 or 3 with a message about a hidden corner/edge — even 0 (a found paper region can still fail every side's fit under heavy occlusion; 2026-09-25 PR #59 review M2)", () => {
    for (const n of [0, 1, 2, 3] as const) {
      const failure = checkPaperCornersSeen(n);
      expect(failure).not.toBeNull();
      expect(failure!.code).toBe("PAPER_CORNER_HIDDEN");
      expect(failure!.message).toMatch(/corner|edge/i);
    }
  });
});

describe("checkPaperEdgeCoverage", () => {
  it("passes at or above the limit", () => {
    expect(
      checkPaperEdgeCoverage(PAPER_EDGE_LIMITS.minSideCoverage),
    ).toBeNull();
    expect(checkPaperEdgeCoverage(1)).toBeNull();
  });

  it("fails below the limit with an actionable message", () => {
    const failure = checkPaperEdgeCoverage(
      PAPER_EDGE_LIMITS.minSideCoverage - 0.01,
    );
    expect(failure).not.toBeNull();
    expect(failure!.code).toBe("PAPER_EDGE_HIDDEN");
    expect(failure!.message).toMatch(/covered/i);
  });
});

describe("checkPaperCurled", () => {
  it("passes at or below the limit", () => {
    expect(checkPaperCurled(PAPER_EDGE_LIMITS.maxEdgeFitResidualMm)).toBeNull();
    expect(checkPaperCurled(0)).toBeNull();
  });

  it("fails above the limit with a message about the paper not being flat", () => {
    const failure = checkPaperCurled(
      PAPER_EDGE_LIMITS.maxEdgeFitResidualMm + 0.01,
    );
    expect(failure).not.toBeNull();
    expect(failure!.code).toBe("PAPER_CURLED");
    expect(failure!.message).toMatch(/flat|curl/i);
  });
});

const CENTRE_LANDMARKS: Point2[] = Array.from({ length: 21 }, () => ({
  x: 100,
  y: 140,
}));
const PAPER_CORNERS_MM: Point2[] = [
  { x: 0, y: 0 },
  { x: 210, y: 0 },
  { x: 210, y: 297 },
  { x: 0, y: 297 },
];

function baseInput(
  overrides: Partial<PaperEdgeGateInput> = {},
): PaperEdgeGateInput {
  return {
    cornersSeen: 4,
    paperRegionFound: true,
    minSideCoverage: 1,
    edgeFitResidualMm: 0.1,
    landmarkCount: 21,
    handedness: "right",
    handStated: "right",
    landmarkConfidence: 0.95,
    landmarksMm: CENTRE_LANDMARKS,
    paperCornersMm: PAPER_CORNERS_MM,
    laplacianVariance: 200,
    ...overrides,
  };
}

describe("runPaperEdgeGates", () => {
  it("passes with no errors and no warnings for a clean input", () => {
    const report = runPaperEdgeGates(baseInput());
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("reports PAPER_NOT_FOUND and skips the other paper checks when no paper region was found", () => {
    const report = runPaperEdgeGates(
      baseInput({ cornersSeen: 0, paperRegionFound: false }),
    );
    expect(report.ok).toBe(false);
    expect(report.errors.map((e) => e.code)).toEqual(["PAPER_NOT_FOUND"]);
  });

  it("reports PAPER_CORNER_HIDDEN when only some corners were seen", () => {
    const report = runPaperEdgeGates(baseInput({ cornersSeen: 2 }));
    expect(report.errors.map((e) => e.code)).toContain("PAPER_CORNER_HIDDEN");
  });

  it("reports PAPER_CORNER_HIDDEN (not PAPER_NOT_FOUND) when the paper region WAS found but every side's fit failed (2026-09-25 PR #59 review M2 — e.g. fingers covering a whole edge)", () => {
    const report = runPaperEdgeGates(
      baseInput({ cornersSeen: 0, paperRegionFound: true }),
    );
    expect(report.errors.map((e) => e.code)).toEqual(["PAPER_CORNER_HIDDEN"]);
    expect(report.errors.map((e) => e.code)).not.toContain("PAPER_NOT_FOUND");
  });

  it("reports PAPER_EDGE_HIDDEN for low coverage", () => {
    const report = runPaperEdgeGates(
      baseInput({ minSideCoverage: PAPER_EDGE_LIMITS.minSideCoverage - 0.05 }),
    );
    expect(report.errors.map((e) => e.code)).toContain("PAPER_EDGE_HIDDEN");
  });

  it("reports PAPER_CURLED for a high residual", () => {
    const report = runPaperEdgeGates(
      baseInput({
        edgeFitResidualMm: PAPER_EDGE_LIMITS.maxEdgeFitResidualMm + 1,
      }),
    );
    expect(report.errors.map((e) => e.code)).toContain("PAPER_CURLED");
  });

  it("still runs the hand gates (reuses checkHandDetected etc.)", () => {
    const report = runPaperEdgeGates(baseInput({ landmarkCount: 0 }));
    expect(report.errors.map((e) => e.code)).toContain("HAND_NOT_DETECTED");
  });

  it("reports HANDEDNESS_MISMATCH via the shared hand gate", () => {
    const report = runPaperEdgeGates(
      baseInput({ handedness: "left", handStated: "right" }),
    );
    expect(report.errors.map((e) => e.code)).toContain("HANDEDNESS_MISMATCH");
  });

  it("reports HAND_OUT_OF_BOUNDS when the hand is far outside the paper", () => {
    const farLandmarks: Point2[] = Array.from({ length: 21 }, () => ({
      x: 10000,
      y: 10000,
    }));
    const report = runPaperEdgeGates(baseInput({ landmarksMm: farLandmarks }));
    expect(report.errors.map((e) => e.code)).toContain("HAND_OUT_OF_BOUNDS");
  });

  it("surfaces low sharpness as a warning, not a blocking error", () => {
    const report = runPaperEdgeGates(baseInput({ laplacianVariance: 1 }));
    expect(report.ok).toBe(true);
    expect(report.warnings.map((w) => w.code)).toContain("LOW_SHARPNESS");
  });

  it("collects every independently-checkable failure, not just the first", () => {
    const report = runPaperEdgeGates(
      baseInput({
        minSideCoverage: 0.1,
        edgeFitResidualMm: 10,
        landmarkConfidence: 0.1,
      }),
    );
    const codes = report.errors.map((e) => e.code);
    expect(codes).toContain("PAPER_EDGE_HIDDEN");
    expect(codes).toContain("PAPER_CURLED");
    expect(codes).toContain("LOW_LANDMARK_CONFIDENCE");
  });
});
