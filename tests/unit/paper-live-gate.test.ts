/**
 * S1 (2026-10-19): the live preview runs the photo's own paper gate.
 *
 * `evaluateLivePaperGate` (src/client/camera/paperGate.ts) reads the very
 * `evaluatePaperEdgeCalibration` result `photo/pipeline.ts` reads, so for ONE
 * detection the preview and the photo cannot disagree. These tests pin that
 * (a grid of detections around both thresholds), the thresholds themselves
 * (0.4 coverage and 1.5 mm, equality and both sides), the side names, and
 * the cue each verdict calls for.
 */
import { describe, expect, it } from "vitest";
import {
  computePaperEdgeGeometry,
  evaluatePaperEdgeCalibration,
} from "../../src/client/paper/calibration";
import {
  lowestCoverageSide,
  type SheetQuadDetection,
} from "../../src/client/paper/detect";
import {
  SIDE_NAME_MIN_DOMINANCE,
  evaluateLivePaperGate,
  screenSideOfPaperSide,
  type LivePaperGate,
} from "../../src/client/camera/paperGate";
import { cueCodeForPaperGate, pickCue } from "../../src/client/camera/cues";
import { PAPER_EDGE_LIMITS } from "../../src/lib/contracts/measurement";
import type { Point2 } from "../../src/client/geometry/homography";

type Corners = readonly [Point2, Point2, Point2, Point2];

/** An upright portrait quad: side 0 top, 1 right, 2 bottom, 3 left. */
const UPRIGHT: Corners = [
  { x: 100, y: 100 },
  { x: 400, y: 100 },
  { x: 400, y: 524 },
  { x: 100, y: 524 },
];

/** A wider portrait quad (500 px) for the exact-millimetre boundary. */
const WIDE: Corners = [
  { x: 50, y: 50 },
  { x: 550, y: 50 },
  { x: 550, y: 757 },
  { x: 50, y: 757 },
];

function detection(
  overrides: Partial<SheetQuadDetection> = {},
): SheetQuadDetection {
  return {
    corners: UPRIGHT,
    cornersSeen: 4,
    cornersFound: [true, true, true, true],
    partialCorners: [...UPRIGHT],
    minSideCoverage: 1,
    edgeFitResidualPx: 0.1,
    worstSideIndex: 0,
    paperRegionFound: true,
    minCoverageSideIndex: null,
    ...overrides,
  };
}

/** The px residual that converts to exactly `mm` on `quad`, found by stepping a few ulps (the conversion is a float product). */
function residualPxForExactMm(quad: SheetQuadDetection, mm: number): number {
  const perPx = computePaperEdgeGeometry(
    { ...quad, edgeFitResidualPx: 1 },
    "a4",
  ).edgeFitResidualMm;
  const start = mm / perPx;
  let up = start;
  let down = start;
  for (let step = 0; step < 256; step++) {
    for (const candidate of [up, down]) {
      const got = computePaperEdgeGeometry(
        { ...quad, edgeFitResidualPx: candidate },
        "a4",
      ).edgeFitResidualMm;
      if (got === mm) return candidate;
    }
    up = nextUp(up);
    down = nextDown(down);
  }
  throw new Error(`no px residual converts to exactly ${mm} mm`);
}

function nextUp(x: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  view.setBigUint64(0, view.getBigUint64(0) + 1n);
  return view.getFloat64(0);
}
function nextDown(x: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  view.setBigUint64(0, view.getBigUint64(0) - 1n);
  return view.getFloat64(0);
}

describe("the thresholds are the contract's, read by one gate", () => {
  it("states the current limits: coverage 0.4, residual 1.5 mm (not changed by S1)", () => {
    expect(PAPER_EDGE_LIMITS.minSideCoverage).toBe(0.4);
    expect(PAPER_EDGE_LIMITS.maxEdgeFitResidualMm).toBe(1.5);
  });

  it("coverage: exactly 0.4 passes, the next value below it is a covered edge, the next above passes", () => {
    const at = detection({ minSideCoverage: 0.4, minCoverageSideIndex: 1 });
    expect(evaluateLivePaperGate(at, "a4")).toEqual({ kind: "pass" });
    expect(evaluatePaperEdgeCalibration(at, "a4", false).ok).toBe(true);

    const below = detection({
      minSideCoverage: nextDown(0.4),
      minCoverageSideIndex: 1,
    });
    expect(evaluateLivePaperGate(below, "a4")).toEqual({
      kind: "edge-covered",
      side: "right",
    });
    expect(evaluatePaperEdgeCalibration(below, "a4", false).ok).toBe(false);

    const above = detection({ minSideCoverage: nextUp(0.4) });
    expect(evaluateLivePaperGate(above, "a4")).toEqual({ kind: "pass" });
  });

  it("residual: exactly 1.5 mm passes, the next value above it is curled, the next below passes", () => {
    // A 500 px wide sheet (0.42 mm per px): the px residual for 1.5 mm then
    // sits where every float product is reachable, so "exactly 1.5" exists.
    const wide = (overrides: Partial<SheetQuadDetection> = {}) =>
      detection({
        corners: WIDE,
        partialCorners: [...WIDE],
        ...overrides,
      });
    const atPx = residualPxForExactMm(wide(), 1.5);
    const at = wide({ edgeFitResidualPx: atPx });
    expect(computePaperEdgeGeometry(at, "a4").edgeFitResidualMm).toBe(1.5);
    expect(evaluateLivePaperGate(at, "a4")).toEqual({ kind: "pass" });
    expect(evaluatePaperEdgeCalibration(at, "a4", false).ok).toBe(true);

    // One more ulp of px may or may not move the product; step until it does.
    let aboveMm = 1.5;
    let abovePx = atPx;
    for (let i = 0; i < 64 && aboveMm <= 1.5; i++) {
      abovePx = nextUp(abovePx);
      aboveMm = computePaperEdgeGeometry(
        wide({ edgeFitResidualPx: abovePx }),
        "a4",
      ).edgeFitResidualMm;
    }
    expect(aboveMm).toBeGreaterThan(1.5);
    const above = wide({ edgeFitResidualPx: abovePx });
    expect(evaluateLivePaperGate(above, "a4")).toEqual({ kind: "curled" });
    expect(evaluatePaperEdgeCalibration(above, "a4", false).ok).toBe(false);

    const below = wide({ edgeFitResidualPx: nextDown(atPx) });
    expect(evaluateLivePaperGate(below, "a4")).toEqual({ kind: "pass" });
  });

  it("both failing: the covered edge is the one named", () => {
    const both = detection({
      minSideCoverage: 0.2,
      minCoverageSideIndex: 3,
      edgeFitResidualPx: 40,
    });
    expect(evaluateLivePaperGate(both, "a4")).toEqual({
      kind: "edge-covered",
      side: "left",
    });
  });
});

describe("one detection, one verdict: live and photo never disagree", () => {
  const coverages = [0, 0.2, 0.39, 0.4, 0.41, 0.75, 1];
  // px residuals spanning pass and curled on this quad (0.1 px is ~0.1 mm here).
  const residualsPx = [0, 0.1, 1, 1.4, 1.5, 1.6, 3, 40];
  const papers = ["a4", "letter"] as const;
  const sideIndexes = [null, 0, 1, 2, 3] as const;

  it("matches the photo's paper gate on every cell of the grid (100%)", () => {
    let cells = 0;
    for (const paperSize of papers)
      for (const minSideCoverage of coverages)
        for (const edgeFitResidualPx of residualsPx)
          for (const minCoverageSideIndex of sideIndexes) {
            const d = detection({
              minSideCoverage,
              edgeFitResidualPx,
              minCoverageSideIndex,
            });
            const live = evaluateLivePaperGate(d, paperSize);
            // The photo's call (pipeline.ts): same function, its own flag.
            const photo = evaluatePaperEdgeCalibration(d, paperSize, true);
            expect(live.kind === "pass", JSON.stringify(d)).toBe(photo.ok);
            const codes = photo.errors.map((e) => e.code);
            expect(live.kind === "edge-covered").toBe(
              codes.includes("PAPER_EDGE_HIDDEN"),
            );
            expect(live.kind === "curled").toBe(
              codes.includes("PAPER_CURLED") &&
                !codes.includes("PAPER_EDGE_HIDDEN"),
            );
            cells += 1;
          }
    expect(cells).toBe(2 * 7 * 8 * 5);
  });

  it("does not judge a detection without four corners (the corner cues speak first)", () => {
    const none = detection({
      corners: null,
      cornersSeen: 2,
      cornersFound: [true, false, true, false],
      minSideCoverage: 0,
      paperRegionFound: true,
    });
    expect(evaluateLivePaperGate(none, "a4")).toEqual({
      kind: "not-evaluated",
    });
    // The photo rejects it too (a corner is hidden), through the same call.
    expect(evaluatePaperEdgeCalibration(none, "a4", false).ok).toBe(false);
  });

  it("never reports a pass for a refusal it has no words for", () => {
    const odd: LivePaperGate = evaluateLivePaperGate(detection(), "a4", {
      ok: false,
      errors: [{ code: "PAPER_NOT_FOUND", message: "x" }],
      calibration: null,
      geometry: null,
    });
    expect(odd).toEqual({ kind: "blocked" });
  });
});

describe("screenSideOfPaperSide", () => {
  it("names the sides of an upright quad as the user sees them", () => {
    expect(
      [0, 1, 2, 3].map((i) => screenSideOfPaperSide(UPRIGHT, i as 0)),
    ).toEqual(["top", "right", "bottom", "left"]);
  });

  it("follows the picture, not the side's number: a quad relabelled by a quarter turn", () => {
    // detectPaperQuad relabels so side 0 is the paper's WIDTH side; a
    // landscape sheet has that side on the left of the screen.
    const landscape: Corners = [
      { x: 100, y: 524 },
      { x: 100, y: 100 },
      { x: 524, y: 100 },
      { x: 524, y: 524 },
    ];
    expect(
      [0, 1, 2, 3].map((i) => screenSideOfPaperSide(landscape, i as 0)),
    ).toEqual(["left", "top", "right", "bottom"]);
  });

  it("names nothing when the paper is turned about 45 degrees", () => {
    const diamond: Corners = [
      { x: 250, y: 50 },
      { x: 450, y: 250 },
      { x: 250, y: 450 },
      { x: 50, y: 250 },
    ];
    for (const i of [0, 1, 2, 3])
      expect(screenSideOfPaperSide(diamond, i as 0)).toBeNull();
  });

  it("keeps the name up to the dominance limit and drops it just past", () => {
    // A sheet rotated by theta: the side midpoint offset is (cos, sin) times
    // the half size; dominance = 1 / tan(theta) for the nearly-horizontal axis.
    const rotated = (thetaDeg: number): Corners => {
      const t = (thetaDeg * Math.PI) / 180;
      const pts = [
        [-150, -212],
        [150, -212],
        [150, 212],
        [-150, 212],
      ].map(([x, y]) => ({
        x: 300 + x * Math.cos(t) - y * Math.sin(t),
        y: 300 + x * Math.sin(t) + y * Math.cos(t),
      }));
      return pts as unknown as Corners;
    };
    expect(SIDE_NAME_MIN_DOMINANCE).toBe(1.5);
    expect(screenSideOfPaperSide(rotated(10), 0)).toBe("top");
    expect(screenSideOfPaperSide(rotated(10), 1)).toBe("right");
    expect(screenSideOfPaperSide(rotated(40), 0)).toBeNull();
  });

  it("returns null for a degenerate quad rather than a name", () => {
    const flat: Corners = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    expect(screenSideOfPaperSide(flat, 0)).toBeNull();
    const nan: Corners = [
      { x: Number.NaN, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(screenSideOfPaperSide(nan, 0)).toBeNull();
  });

  it("an unknown or absent minCoverageSideIndex gives the plain 'an edge' verdict", () => {
    for (const minCoverageSideIndex of [undefined, null] as const) {
      const d = detection({ minSideCoverage: 0.1, minCoverageSideIndex });
      expect(evaluateLivePaperGate(d, "a4")).toEqual({
        kind: "edge-covered",
        side: null,
      });
    }
  });
});

describe("lowestCoverageSide (the detector's diagnostic)", () => {
  it("is the one side with the lowest coverage", () => {
    expect(lowestCoverageSide([1, 0.35, 1, 0.9])).toBe(1);
    expect(lowestCoverageSide([0.75, 0.9, 0.75 - 0.01, 1])).toBe(2);
  });
  it("is null on a tie for the lowest, with all sides fully seen, or with nothing measured", () => {
    expect(lowestCoverageSide([0.3, 0.3, 1, 1])).toBeNull();
    expect(lowestCoverageSide([1, 1, 1, 1])).toBeNull();
    expect(lowestCoverageSide([])).toBeNull();
  });
  it("counts a side that could not be fitted at all (coverage 0) as the lowest", () => {
    expect(lowestCoverageSide([0.8, 0.9, 0, 0.7])).toBe(2);
  });
});

describe("the cue a verdict calls for", () => {
  it("maps each verdict to one cue code, with the side in the code", () => {
    const code = (g: LivePaperGate) => cueCodeForPaperGate(g);
    expect(code({ kind: "pass" })).toBeNull();
    expect(code({ kind: "not-evaluated" })).toBeNull();
    expect(cueCodeForPaperGate(undefined)).toBeNull();
    expect(code({ kind: "edge-covered", side: null })).toBe("edge-covered");
    expect(code({ kind: "edge-covered", side: "top" })).toBe(
      "edge-covered-top",
    );
    expect(code({ kind: "edge-covered", side: "bottom" })).toBe(
      "edge-covered-bottom",
    );
    expect(code({ kind: "edge-covered", side: "left" })).toBe(
      "edge-covered-left",
    );
    expect(code({ kind: "edge-covered", side: "right" })).toBe(
      "edge-covered-right",
    );
    expect(code({ kind: "curled" })).toBe("paper-curled");
    expect(code({ kind: "blocked" })).toBe("some-corners");
  });

  it("a failed gate is never 'perfect', so the shutter ring has nothing to count", () => {
    const quad = {
      topLeft: UPRIGHT[0],
      topRight: UPRIGHT[1],
      bottomRight: UPRIGHT[2],
      bottomLeft: UPRIGHT[3],
    };
    for (const paperGate of [
      { kind: "edge-covered", side: "left" },
      { kind: "edge-covered", side: null },
      { kind: "curled" },
      { kind: "blocked" },
    ] as const) {
      const cue = pickCue(
        {
          cornersSeen: 4,
          quad,
          frameWidth: 640,
          meanLuma: 120,
          clippedFraction: 0,
          steady: true,
          sharpEnough: true,
          paperGate,
          msSinceLastDetection: 0,
        },
        "paper-edge",
        "en",
      );
      expect(cue.allPass, paperGate.kind).toBe(false);
    }
  });
});
