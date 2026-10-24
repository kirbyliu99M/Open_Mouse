/**
 * V3.2 F19 (candidate): what the local attempt log keeps about how the
 * sheet's sides were fitted (per-side residuals in px, points left out under
 * the hand, whether a hand mask was used, pieces joined, the second call).
 * Local only: no analytics event carries any of it.
 */
import { describe, expect, it } from "vitest";
import {
  buildAttemptRecord,
  describeAttempt,
  sanitizeAttempt,
} from "../../src/client/camera/attemptLog";
import type { PipelineResult } from "../../src/client/photo/pipeline";
import type {
  PaperEdgeFitDiagnostics,
  PipelineDiagnostics,
} from "../../src/client/photo/diagnostics";

const DIAGNOSTICS: PipelineDiagnostics = {
  decodeMs: 300,
  paperMs: 400,
  handMs: 180,
  totalMs: 1200,
  decoded: { width: 1024, height: 1920 },
  analysed: { width: 1024, height: 1920 },
  fovCrop: null,
  view: null,
  paper: {
    cornersSeen: 4,
    paperRegionFound: true,
    widthFraction: 0.8,
    heightFraction: 0.7,
    edgeFitResidualMm: 0.31,
    maxAngleDeviationDeg: 3,
    observedAspect: 0.7,
    minSideCoverage: 0.6,
    sideCoverages: [1, 1, 0.6, 1],
    worstSide: "bottom",
    gateFailures: [],
  },
  laplacianVariance: 140,
  hand: {
    detected: true,
    confidence: 0.9,
    handedness: "left",
    flatness: null,
  },
  parallaxCorrected: null,
  measured: { handLengthMm: null, palmWidthMm: null },
  focal: null,
  shadowPrior: null,
};

function resultWith(paperEdgeFit?: PaperEdgeFitDiagnostics): PipelineResult {
  return {
    status: "error",
    errors: [{ code: "LOW_LANDMARK_CONFIDENCE", message: "Not clear." }],
    overlay: {
      imageWidth: 1024,
      imageHeight: 1920,
      markers: [],
      card: null,
      landmarksPx: null,
    },
    diagnostics: {
      ...DIAGNOSTICS,
      ...(paperEdgeFit ? { paperEdgeFit } : {}),
    },
  };
}

function build(paperEdgeFit?: PaperEdgeFitDiagnostics) {
  return buildAttemptRecord({
    at: "2026-10-25T01:02:03.000Z",
    userAgent: "test",
    capture: {
      method: "takePhoto",
      photoWidth: 1024,
      photoHeight: 1920,
      photoKb: 300,
      previewWidth: 1080,
      previewHeight: 1920,
    },
    outcome: { kind: "result", result: resultWith(paperEdgeFit) },
  });
}

const FIT: PaperEdgeFitDiagnostics = {
  edgeFit: {
    sideResidualsPx: [0.0123456, 0.02, 0.4567891, null],
    sideEndsSeen: [true, true, false, true],
    excludedPoints: 312,
    handMask: true,
    piecesJoined: 2,
  },
  secondLook: { palm: false, handMask: true, used: true, ms: 41.6 },
};

describe("F19 in the attempt log", () => {
  it("keeps per-side residuals to 0.001 px, ends seen, points left out, the mask, pieces and the second call", () => {
    const r = build(FIT);
    expect(r.paperEdgeFit).toStrictEqual({
      sideResidualsPx: [0.012, 0.02, 0.457, null],
      sideEndsSeen: [true, true, false, true],
      excludedPoints: 312,
      handMask: true,
      piecesJoined: 2,
      secondLook: { palm: false, handMask: true, used: true, ms: 42 },
    });
    const line = describeAttempt(r);
    expect(line).toContain("side resid 0.012/0.02/0.457/? px");
    expect(line).toContain("hand mask · 312 pts out · 2 pieces joined");
    expect(line).toContain("second look used");
  });

  it("an attempt without it (an older record, no sheet and no second call) has no field and no words", () => {
    const r = build();
    expect("paperEdgeFit" in r).toBe(false);
    const line = describeAttempt(r);
    expect(line).not.toContain("side resid");
    expect(line).not.toContain("hand mask");
    expect(line).not.toContain("second look");
  });

  it("a found sheet with no hand: residuals kept, no mask words", () => {
    const r = build({
      edgeFit: {
        sideResidualsPx: [0.01, 0.01, 0.02, 0.01],
        sideEndsSeen: [true, true, true, true],
        excludedPoints: 0,
        handMask: false,
        piecesJoined: 1,
      },
      secondLook: null,
    });
    expect(r.paperEdgeFit?.handMask).toBe(false);
    expect(r.paperEdgeFit?.secondLook).toBeNull();
    expect(describeAttempt(r)).not.toContain("hand mask");
  });

  it("a second call that carried the hand but found no sheet still says the mask was used", () => {
    const r = build({
      edgeFit: null,
      secondLook: { palm: true, handMask: true, used: false, ms: 12 },
    });
    expect(r.paperEdgeFit).toStrictEqual({
      sideResidualsPx: null,
      sideEndsSeen: null,
      excludedPoints: null,
      handMask: true,
      piecesJoined: null,
      secondLook: { palm: true, handMask: true, used: false, ms: 12 },
    });
    expect(describeAttempt(r)).toContain("second look not used");
  });

  it("read back, anything malformed is dropped field by field, never kept as given", () => {
    const base = build(FIT);
    const r = sanitizeAttempt({
      ...base,
      paperEdgeFit: {
        sideResidualsPx: [1, 2, 3],
        sideEndsSeen: [true, "yes", false, true],
        excludedPoints: "many",
        handMask: "true",
        piecesJoined: Infinity,
        secondLook: "used",
        photo: "data:image/png;base64,AAAA",
      },
    });
    expect(r?.paperEdgeFit).toStrictEqual({
      sideResidualsPx: null,
      sideEndsSeen: null,
      excludedPoints: null,
      handMask: false,
      piecesJoined: null,
      secondLook: null,
    });
    expect(
      sanitizeAttempt({ ...base, paperEdgeFit: [1, 2] }),
    ).not.toHaveProperty("paperEdgeFit");
  });
});
