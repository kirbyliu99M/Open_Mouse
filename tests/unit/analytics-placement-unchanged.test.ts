/**
 * V3.3 WP1b: the placement record lives in the diagnostics and the local
 * attempt log only. The analytics payloads built from the same diagnostics
 * (`scan_quality`, `scan_rejected`) must be exactly what they were: the same
 * key set and the same values, with or without `diagnostics.placement`.
 */
import { describe, expect, it } from "vitest";
import {
  buildScanQuality,
  buildScanRejected,
  rejectedShadowProps,
} from "../../src/client/analytics/scanQuality";
import type { PipelineDiagnostics } from "../../src/client/photo/diagnostics";
import type { PlacementDiagnostics } from "../../src/client/photo/placementDiagnostics";

const BASE: PipelineDiagnostics = {
  decodeMs: 10,
  paperMs: 10,
  handMs: 10,
  totalMs: 40,
  decoded: { width: 2000, height: 1500 },
  analysed: { width: 2000, height: 1500 },
  fovCrop: null,
  view: null,
  paper: {
    cornersSeen: 4,
    paperRegionFound: true,
    widthFraction: 0.7,
    heightFraction: 0.8,
    edgeFitResidualMm: 0.3,
    maxAngleDeviationDeg: 1.5,
    observedAspect: 0.7066,
    minSideCoverage: 0.9,
    sideCoverages: [0.9, 1, 1, 0.95],
    worstSide: "top",
    gateFailures: [],
  },
  laplacianVariance: 150,
  hand: {
    detected: true,
    confidence: 0.9,
    handedness: "right",
    flatness: { pose: "flat_like", reachMean: 0.745, fingerStraightMin: 0.999 },
  },
  parallaxCorrected: true,
  measured: { handLengthMm: 180, palmWidthMm: 85 },
  focal: { source: "exif", px: 2900 },
  shadowPrior: { handLengthDeltaMm: -0.4 },
};

const PLACEMENT: PlacementDiagnostics = {
  placement: {
    wristToEdgeMm: 40,
    wristEdge: "near-bottom",
    handAxisDeg: 30,
    minSideMarginMm: -5,
    thumbOutside: true,
    palmOverHand: 0.3,
    distalOverProximal: [0.6, 0.6, 0.6, 0.6],
  },
  world: {
    palmTiltDeg: 25,
    fingerFlexDeg: [40, 40, 40, 40],
    fingerElevDeg: [10, 10, 10, 10],
    planarityRmsMm: 9,
  },
  corrected: true,
  zWristMinusMcp: 0.05,
  camDistMm: 400,
  camOffsetMm: 20,
  frameEdge: { minPx: 3, fractionOfShortSide: 0.002 },
  shadowRing: 0.5,
  shadowRingMs: 4,
};

const WITH: PipelineDiagnostics = { ...BASE, placement: PLACEMENT };

describe("analytics payloads do not change with the placement record", () => {
  it("scan_quality: same keys, same values", () => {
    const input = {
      flow: "easy" as const,
      attempt: 2,
      method: "canvas" as const,
    };
    const before = buildScanQuality({ ...input, diagnostics: BASE });
    const after = buildScanQuality({ ...input, diagnostics: WITH });
    expect(before).not.toBeNull();
    expect(Object.keys(after!).sort()).toEqual(Object.keys(before!).sort());
    expect(after).toStrictEqual(before);
    expect(JSON.stringify(after)).not.toMatch(
      /placement|wrist|shadow|world|experiment|guidance|softHint/i,
    );
  });

  it("scan_rejected: same keys, same values", () => {
    for (const errors of [
      [{ code: "LOW_LANDMARK_CONFIDENCE" }],
      [{ code: "PAPER_NOT_FOUND" }],
    ]) {
      const before = buildScanRejected({
        flow: "easy",
        attempt: 1,
        errors,
        diagnostics: BASE,
      });
      const after = buildScanRejected({
        flow: "easy",
        attempt: 1,
        errors,
        diagnostics: WITH,
      });
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      expect(after).toStrictEqual(before);
    }
    expect(rejectedShadowProps(WITH)).toStrictEqual(rejectedShadowProps(BASE));
  });
});
