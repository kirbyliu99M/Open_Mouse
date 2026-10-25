/**
 * `src/client/paper/calibration.ts` — the pure paper-edge geometry → mm
 * → gates → calibration chain extracted out of `pipeline.ts`'s
 * `runPaperEdgePipeline` (2026-09-25 PR #59 review: that function is
 * itself impure and untested by Vitest by design, which meant this exact
 * chain — including the side-normal px→mm conversion — had no direct
 * test at all; hard rule 3).
 */
import { describe, expect, it } from "vitest";
import {
  computePaperEdgeGeometry,
  evaluatePaperEdgeCalibration,
} from "../../src/client/paper/calibration";
import { detectPaperQuad } from "../../src/client/paper/detect";
import {
  paperEdgeEvidenceSchema,
  PAPER_EDGE_LIMITS,
} from "../../src/lib/contracts/measurement";
import type { SheetQuadDetection } from "../../src/client/paper/detect";
import { generateSyntheticPaper } from "./helpers/synthetic-paper";
import { screenSideOfPaperSide } from "../../src/client/camera/paperGate";

function detectFromSynthetic(
  overrides: Parameters<typeof generateSyntheticPaper>[0],
): SheetQuadDetection {
  const rendered = generateSyntheticPaper(overrides);
  const imageData = {
    width: overrides.width,
    height: overrides.height,
    data: rendered.data,
  } as unknown as ImageData;
  return detectPaperQuad(imageData, "a4");
}

/** A hand-built, fully-found quad — used where the test needs full control over `minSideCoverage` directly, rather than driving the detector to hit a coverage figure precisely. */
function fakeQuad(
  overrides: Partial<SheetQuadDetection> = {},
): SheetQuadDetection {
  return {
    corners: [
      { x: 100, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 524 },
      { x: 100, y: 524 },
    ],
    cornersSeen: 4,
    cornersFound: [true, true, true, true],
    partialCorners: [
      { x: 100, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 524 },
      { x: 100, y: 524 },
    ],
    minSideCoverage: 1,
    edgeFitResidualPx: 0.1,
    worstSideIndex: 0,
    paperRegionFound: true,
    ...overrides,
  };
}

describe("computePaperEdgeGeometry", () => {
  it("throws when quad.corners is null (precondition, mirrors computeHandMeasurements)", () => {
    expect(() =>
      computePaperEdgeGeometry(fakeQuad({ corners: null }), "a4"),
    ).toThrow();
  });

  it("converts a tiny residual on a near-axis-aligned quad to a small mm figure", () => {
    const geometry = computePaperEdgeGeometry(
      fakeQuad({ edgeFitResidualPx: 0.1 }),
      "a4",
    );
    expect(geometry.edgeFitResidualMm).toBeGreaterThan(0);
    expect(geometry.edgeFitResidualMm).toBeLessThan(0.2);
  });

  it("RED/GREEN regression guard: the side-normal conversion differs from the generic centroid-average scale for a perspective-distorted quad", () => {
    // A genuinely perspective-distorted quad (not just scaled/rotated) —
    // this is the case a centroid-based x/y-average scale and a
    // side-normal scale can meaningfully disagree on, unlike a flat
    // similarity transform (equal scale in every direction, where the
    // two methods coincide and a regression wouldn't show up in a test).
    const perspectiveQuad = fakeQuad({
      corners: [
        { x: 120, y: 80 },
        { x: 900, y: 40 },
        { x: 860, y: 700 },
        { x: 160, y: 740 },
      ],
      worstSideIndex: 1, // the right side (TR->BR), sharply foreshortened
      edgeFitResidualPx: 5,
    });
    const sideNormalResult = computePaperEdgeGeometry(perspectiveQuad, "a4");

    // The bug this guards: falling back to the OLD generic
    // centroid-average scale unconditionally (as if `worstSideIndex`
    // were always null) instead of the side's own normal direction.
    const centroidAverageResult = computePaperEdgeGeometry(
      { ...perspectiveQuad, worstSideIndex: null },
      "a4",
    );

    expect(sideNormalResult.edgeFitResidualMm).not.toBeCloseTo(
      centroidAverageResult.edgeFitResidualMm,
      1,
    );
  });
});

describe("evaluatePaperEdgeCalibration", () => {
  it("a flat sheet passes with a residual well under the limit, and the calibration validates against paperEdgeEvidenceSchema", () => {
    const width = 1000;
    const height = 750;
    const quad = detectFromSynthetic({ width, height, seed: 424242 });
    expect(quad.corners).not.toBeNull();

    const result = evaluatePaperEdgeCalibration(quad, "a4", true);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.calibration).not.toBeNull();
    expect(result.geometry!.edgeFitResidualMm).toBeLessThan(
      PAPER_EDGE_LIMITS.maxEdgeFitResidualMm,
    );
    expect(paperEdgeEvidenceSchema.safeParse(result.calibration).success).toBe(
      true,
    );
    expect(result.calibration).toMatchObject({
      method: "paper-edge",
      paperSize: "a4",
      parallaxCorrected: true,
    });
  });

  it("a curled/bowed side exceeds 1.5mm via the side-normal conversion and fails with PAPER_CURLED", () => {
    const width = 1000;
    const height = 750;
    const quad = detectFromSynthetic({
      width,
      height,
      seed: 424242 + 42,
      curledSideIndex: 1,
      curlAmplitudePx: 8,
    });
    expect(quad.corners).not.toBeNull();

    const result = evaluatePaperEdgeCalibration(quad, "a4", true);
    expect(result.geometry!.edgeFitResidualMm).toBeGreaterThan(
      PAPER_EDGE_LIMITS.maxEdgeFitResidualMm,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("PAPER_CURLED");
    expect(result.calibration).toBeNull();
  });

  it("coverage below 0.4 fails with PAPER_EDGE_HIDDEN, not PAPER_CURLED", () => {
    const quad = fakeQuad({ minSideCoverage: 0.3, edgeFitResidualPx: 0.1 });
    const result = evaluatePaperEdgeCalibration(quad, "a4", false);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(["PAPER_EDGE_HIDDEN"]);
    expect(result.calibration).toBeNull();
  });

  it("fewer than 4 corners fails with PAPER_CORNER_HIDDEN before any calibration is built", () => {
    const quad = fakeQuad({
      corners: null,
      cornersSeen: 2,
      cornersFound: [true, true, false, false],
    });
    const result = evaluatePaperEdgeCalibration(quad, "a4", false);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(["PAPER_CORNER_HIDDEN"]);
    expect(result.calibration).toBeNull();
  });

  it("passes parallaxCorrected through honestly into the calibration", () => {
    const quad = fakeQuad();
    const corrected = evaluatePaperEdgeCalibration(quad, "a4", true);
    const uncorrected = evaluatePaperEdgeCalibration(quad, "a4", false);
    expect(corrected.calibration?.parallaxCorrected).toBe(true);
    expect(uncorrected.calibration?.parallaxCorrected).toBe(false);
  });
});

describe("the paper gate's thresholds (current limits, unchanged by S1)", () => {
  it("coverage: exactly 0.4 passes, just below fails", () => {
    expect(
      evaluatePaperEdgeCalibration(
        fakeQuad({ minSideCoverage: 0.4 }),
        "a4",
        false,
      ).ok,
    ).toBe(true);
    expect(
      evaluatePaperEdgeCalibration(
        fakeQuad({ minSideCoverage: 0.4 - 1e-9 }),
        "a4",
        false,
      ).errors.map((e) => e.code),
    ).toEqual(["PAPER_EDGE_HIDDEN"]);
  });

  it("residual: just under and just over 1.5 mm, both sides of the gate", () => {
    const perPx = computePaperEdgeGeometry(
      fakeQuad({ edgeFitResidualPx: 1 }),
      "a4",
    ).edgeFitResidualMm;
    const at = (mm: number) =>
      evaluatePaperEdgeCalibration(
        fakeQuad({ edgeFitResidualPx: mm / perPx }),
        "a4",
        false,
      );
    expect(at(1.5 - 1e-6).ok).toBe(true);
    expect(at(1.5 + 1e-6).errors.map((e) => e.code)).toEqual(["PAPER_CURLED"]);
  });

  it("the verdict does not depend on parallaxCorrected (it is the one argument the gates never read)", () => {
    for (const quad of [
      fakeQuad(),
      fakeQuad({ minSideCoverage: 0.1 }),
      fakeQuad({ edgeFitResidualPx: 50 }),
    ]) {
      const a = evaluatePaperEdgeCalibration(quad, "a4", true);
      const b = evaluatePaperEdgeCalibration(quad, "a4", false);
      expect(a.ok).toBe(b.ok);
      expect(a.errors).toEqual(b.errors);
    }
  });
});

describe("detectPaperQuad: minCoverageSideIndex (diagnostic only)", () => {
  it("points at the covered bottom side when a hand-coloured blob crosses it, and names it 'bottom' on screen", () => {
    for (const seed of [1, 3, 6, 9]) {
      const quad = detectFromSynthetic({
        width: 640,
        height: 480,
        seed,
        occluder: true,
      });
      expect(quad.minSideCoverage, `seed ${seed}`).toBeLessThan(1);
      expect(quad.minCoverageSideIndex, `seed ${seed}`).toBe(2);
      expect(screenSideOfPaperSide(quad.corners!, 2)).toBe("bottom");
    }
  });

  it("is null when no side is hidden anywhere", () => {
    const quad = detectFromSynthetic({
      width: 640,
      height: 480,
      seed: 1,
      occluder: false,
    });
    expect(quad.minSideCoverage).toBe(1);
    expect(quad.minCoverageSideIndex).toBeNull();
  });

  it("changes nothing the gates read: the same detection's coverage, residual and corners", () => {
    const withBlob = detectFromSynthetic({
      width: 640,
      height: 480,
      seed: 3,
      occluder: true,
    });
    const { minCoverageSideIndex, sideCoverages, ...rest } = withBlob;
    void minCoverageSideIndex;
    void sideCoverages;
    // The photo chain on the diagnostic-free copy gives the same verdict.
    expect(evaluatePaperEdgeCalibration(withBlob, "a4", false)).toEqual(
      evaluatePaperEdgeCalibration(rest, "a4", false),
    );
  });
});

describe("detectPaperQuad: sideCoverages (diagnostic only, scan S3)", () => {
  it("is the four per-side coverages, whose smallest is minSideCoverage and whose lowest is the side minCoverageSideIndex names", () => {
    for (const seed of [1, 3, 6, 9]) {
      const quad = detectFromSynthetic({
        width: 640,
        height: 480,
        seed,
        occluder: true,
      });
      const sides = quad.sideCoverages!;
      expect(sides, `seed ${seed}`).toHaveLength(4);
      for (const v of sides) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(Math.min(...sides), `seed ${seed}`).toBe(quad.minSideCoverage);
      expect(sides.indexOf(Math.min(...sides)), `seed ${seed}`).toBe(
        quad.minCoverageSideIndex,
      );
      expect(sides[2]).toBeLessThan(1);
    }
  });

  it("is all ones when nothing is hidden", () => {
    const quad = detectFromSynthetic({
      width: 640,
      height: 480,
      seed: 1,
      occluder: false,
    });
    expect(quad.sideCoverages).toEqual([1, 1, 1, 1]);
  });
});
