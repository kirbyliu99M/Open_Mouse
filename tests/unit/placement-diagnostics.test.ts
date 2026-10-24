/**
 * V3.3 WP1b: placementDiagnostics.ts, the photo's placement record. Synthetic
 * scenes as in hand-placement.test.ts (a pinhole camera over the sheet, a
 * synthetic hand at its landmark heights, projected to px and recovered
 * through the real homography and parallax correction). Every number here is
 * SIMULATED (模擬).
 */
import { describe, expect, it } from "vitest";
import {
  buildPlacementDiagnostics,
  cameraPlacement,
  computeShadowRing,
  frameEdgeDistance,
  SHADOW_RING,
  zWristMinusMcp,
} from "../../src/client/photo/placementDiagnostics";
import { computeHandPlacement } from "../../src/client/photo/handPlacement";
import { buildPaperHomography } from "../../src/client/paper/homography";
import {
  buildHandMask,
  HAND_MASK,
  isCoveredByHand,
} from "../../src/client/paper/handMask";
import { landmarkHeightsMm } from "../../src/client/geometry/parallax";
import { computeCorrectedHandMeasurements } from "../../src/client/geometry/measurements";
import type { Homography, Point2 } from "../../src/client/geometry/homography";
import type { Point3 } from "../../src/client/photo/handWorld";
import { PAPER_SIZES_MM } from "../../src/lib/contracts/measurement";
import { syntheticHand } from "./helpers/synthetic-hand";
import {
  buildSyntheticCamera,
  projectSheetMm,
} from "./helpers/synthetic-camera";

const W_PX = 1080;
const H_PX = 1920;
const F_PX = 998;
const L = 190;

function handScale(): number {
  const u = syntheticHand({ spread: false });
  return L / Math.hypot(u[12].x - u[0].x, u[12].y - u[0].y);
}

function scene(wrist: Point2, rotationDeg = 0, tiltDeg = 4) {
  const { width: W, height: H } = PAPER_SIZES_MM.a4;
  const cam = buildSyntheticCamera({
    tiltDeg,
    distanceMm: 330,
    fPx: F_PX,
    widthPx: W_PX,
    heightPx: H_PX,
  });
  const toPx = (p: Point2, h = 0) =>
    projectSheetMm(cam, { x: p.x - W / 2, y: p.y - H / 2 }, h);
  const corners = [
    toPx({ x: 0, y: 0 }),
    toPx({ x: W, y: 0 }),
    toPx({ x: W, y: H }),
    toPx({ x: 0, y: H }),
  ] as const;
  const homography = buildPaperHomography(corners, "a4");
  const truth = syntheticHand(
    { spread: false },
    { scale: handScale(), rotationDeg, offset: wrist },
  );
  const heights = landmarkHeightsMm(L);
  const px = truth.map((p, i) => toPx(p, heights[i]));
  return { cam, corners, homography, truth, px, heights };
}

/** The world hand: the sheet-frame truth (m), rotated into the camera frame by R (world Y = −sheet y). */
function worldHand(
  truth: readonly Point2[],
  R: readonly (readonly number[])[],
): Point3[] {
  return truth.map((p) => {
    const w = [p.x / 1000, -p.y / 1000, 0];
    return {
      x: R[0][0] * w[0] + R[0][1] * w[1] + R[0][2] * w[2],
      y: R[1][0] * w[0] + R[1][1] * w[1] + R[1][2] * w[2],
      z: R[2][0] * w[0] + R[2][1] * w[1] + R[2][2] * w[2],
    };
  });
}

describe("buildPlacementDiagnostics — synthetic (模擬, no noise)", () => {
  it("reads the measurement's own corrected points: wrist within 0.5 mm, axis within 0.5°", () => {
    const s = scene({ x: 105, y: 297 - 10 });
    const d = buildPlacementDiagnostics({
      landmarksPx: s.px,
      homography: s.homography,
      paperSize: "a4",
      analysed: { width: W_PX, height: H_PX },
      fPx: F_PX,
      heightsMm: s.heights,
    });
    expect(d.corrected).toBe(true);
    expect(d.placement.wristEdge).toBe("near-bottom");
    expect(Math.abs(d.placement.wristToEdgeMm! - 10)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(d.placement.handAxisDeg!)).toBeLessThanOrEqual(0.5);
    // Camera 330 mm over the sheet's centre.
    expect(Math.abs(d.camDistMm! - 330)).toBeLessThan(1);
    expect(d.camOffsetMm!).toBeLessThan(1);
    expect(d.frameEdge).not.toBeNull();
    expect(d.shadowRing).toBeNull();
    expect(d.shadowRingMs).toBeNull();
  });

  it("uses exactly the points computeCorrectedHandMeasurements measured", () => {
    const s = scene({ x: 100, y: 297 - 25 }, 12);
    const corrected = computeCorrectedHandMeasurements(s.px, s.homography, {
      exifFocalPx: F_PX,
      widthPx: W_PX,
      heightPx: H_PX,
    });
    expect(corrected.parallaxCorrected).toBe(true);
    const d = buildPlacementDiagnostics({
      landmarksPx: s.px,
      homography: s.homography,
      paperSize: "a4",
      analysed: { width: W_PX, height: H_PX },
      fPx: corrected.fPx,
      heightsMm: corrected.heightsMm,
    });
    // Hand length from the same points the placement read.
    expect(Math.abs(d.placement.handAxisDeg! - 12)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(d.placement.wristToEdgeMm! - 25)).toBeLessThanOrEqual(0.5);
  });

  it("without a focal length it falls back to the plain homography (corrected false, no pose)", () => {
    const s = scene({ x: 105, y: 297 - 10 });
    const d = buildPlacementDiagnostics({
      landmarksPx: s.px,
      homography: s.homography,
      paperSize: "a4",
      analysed: { width: W_PX, height: H_PX },
      fPx: null,
      heightsMm: null,
    });
    expect(d.corrected).toBe(false);
    expect(d.camDistMm).toBeNull();
    expect(d.world.palmTiltDeg).toBeNull();
    const flat = computeHandPlacement(
      s.px.map((p) => {
        const h = s.homography;
        const w = h[2][0] * p.x + h[2][1] * p.y + h[2][2];
        return {
          x: (h[0][0] * p.x + h[0][1] * p.y + h[0][2]) / w,
          y: (h[1][0] * p.x + h[1][1] * p.y + h[1][2]) / w,
        };
      }),
      "a4",
    );
    expect(d.placement.wristToEdgeMm).toBeCloseTo(flat.wristToEdgeMm!, 9);
  });

  it("world readings: a flat hand seen through R has a palm tilt near 0°", () => {
    const s = scene({ x: 105, y: 297 - 10 }, 0, 8);
    const d = buildPlacementDiagnostics({
      landmarksPx: s.px,
      homography: s.homography,
      paperSize: "a4",
      analysed: { width: W_PX, height: H_PX },
      fPx: F_PX,
      heightsMm: s.heights,
      worldLandmarks: worldHand(s.truth, s.cam.R),
      landmarkZ: Array.from({ length: 21 }, (_, i) => (i === 0 ? 0 : -0.02)),
    });
    expect(d.world.palmTiltDeg).not.toBeNull();
    expect(d.world.palmTiltDeg!).toBeLessThan(0.5);
    expect(d.world.planarityRmsMm!).toBeLessThan(0.01);
    expect(d.zWristMinusMcp).toBeCloseTo(0.02, 9);
  });

  it("never throws: no hand, bad homography, bad sizes give nulls", () => {
    const s = scene({ x: 105, y: 297 - 10 });
    const empty = buildPlacementDiagnostics({
      landmarksPx: [],
      homography: s.homography,
      paperSize: "a4",
      analysed: { width: W_PX, height: H_PX },
      fPx: F_PX,
      heightsMm: s.heights,
    });
    expect(empty.placement.wristToEdgeMm).toBeNull();
    expect(empty.frameEdge).toBeNull();
    expect(empty.corrected).toBe(false);
    const zeros: Homography = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const bad = buildPlacementDiagnostics({
      landmarksPx: s.px,
      homography: zeros,
      paperSize: "a4",
      analysed: { width: 0, height: 0 },
      fPx: Number.NaN,
      heightsMm: null,
      worldLandmarks: [{ x: Number.NaN, y: 0, z: 0 }],
      landmarkZ: [1, 2],
    });
    expect(bad.world.palmTiltDeg).toBeNull();
    expect(bad.zWristMinusMcp).toBeNull();
    expect(bad.frameEdge).toBeNull();
  });
});

describe("frameEdgeDistance", () => {
  const hand = (dx: number, dy: number) =>
    syntheticHand({ spread: false }, { scale: 3, offset: { x: dx, y: dy } });

  it("is the smallest non-thumb distance to the picture's border", () => {
    const pts = hand(500, 1500);
    const d = frameEdgeDistance(pts, 1080, 1920)!;
    let expected = Infinity;
    for (const i of [0, ...Array.from({ length: 16 }, (_, k) => k + 5)]) {
      const p = pts[i];
      expected = Math.min(expected, p.x, p.y, 1080 - p.x, 1920 - p.y);
    }
    expect(d.minPx).toBeCloseTo(expected, 9);
    expect(d.fractionOfShortSide).toBeCloseTo(expected / 1080, 9);
  });

  it("ignores the thumb, and goes negative outside the picture", () => {
    const pts = hand(500, 1500).map((p) => ({ ...p }));
    pts[4] = { x: -50, y: 1500 };
    const withThumbOut = frameEdgeDistance(pts, 1080, 1920)!;
    expect(withThumbOut.minPx).toBeGreaterThan(0);
    pts[0] = { x: 500, y: 1930 };
    expect(frameEdgeDistance(pts, 1080, 1920)!.minPx).toBeCloseTo(-10, 9);
  });

  it("null for not 21 points or no size", () => {
    expect(frameEdgeDistance(null, 1080, 1920)).toBeNull();
    expect(frameEdgeDistance(hand(500, 1500).slice(0, 20), 1080, 1920)).toBe(
      null,
    );
    expect(frameEdgeDistance(hand(500, 1500), 0, 1920)).toBeNull();
  });
});

describe("zWristMinusMcp", () => {
  it("is wrist z minus the knuckles' mean", () => {
    const z = Array.from({ length: 21 }, () => 0);
    z[0] = 0.01;
    z[5] = -0.01;
    z[9] = -0.03;
    z[13] = -0.01;
    z[17] = -0.01;
    expect(zWristMinusMcp(z)).toBeCloseTo(0.025, 12);
  });
  it("null for not 21 finite values", () => {
    expect(zWristMinusMcp(null)).toBeNull();
    expect(zWristMinusMcp([1, 2, 3])).toBeNull();
    const z = Array.from({ length: 21 }, () => 0);
    z[3] = Number.NaN;
    expect(zWristMinusMcp(z)).toBeNull();
  });
});

describe("cameraPlacement", () => {
  it("height and foot-point offset from the sheet's centre (world Y = −sheet y)", () => {
    const c = cameraPlacement(
      { cameraCentreWorld: [105 + 30, -148.5 + 40, 300], cameraHeightMm: 300 },
      "a4",
    )!;
    expect(c.camDistMm).toBe(300);
    expect(c.camOffsetMm).toBeCloseTo(50, 9);
  });
  it("null without a pose or with a non-finite one", () => {
    expect(cameraPlacement(null, "a4")).toBeNull();
    expect(
      cameraPlacement(
        { cameraCentreWorld: [Number.NaN, 0, 1], cameraHeightMm: 1 },
        "a4",
      ),
    ).toBeNull();
  });
});

describe("computeShadowRing", () => {
  const width = 360;
  const height = 640;
  const corners: Point2[] = [
    { x: 20, y: 20 },
    { x: 340, y: 20 },
    { x: 340, y: 620 },
    { x: 20, y: 620 },
  ];
  const hand = syntheticHand(
    { spread: false },
    { scale: 1.2, offset: { x: 180, y: 560 } },
  );

  /** A frame painted by mask: hand 60, ring `ring`, sheet 200, outside the sheet 30. */
  function frame(ring: number) {
    const inner = buildHandMask(hand, width, height, {
      ...HAND_MASK,
      marginPalmWidths: SHADOW_RING.innerPalmWidths,
    })!;
    const outer = buildHandMask(hand, width, height, {
      ...HAND_MASK,
      marginPalmWidths:
        SHADOW_RING.innerPalmWidths + SHADOW_RING.ringPalmWidths,
    })!;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = { x: x + 0.5, y: y + 0.5 };
        const onSheet = x >= 20 && x <= 340 && y >= 20 && y <= 620;
        const v = !onSheet
          ? 30
          : isCoveredByHand(p, inner)
            ? 60
            : isCoveredByHand(p, outer)
              ? ring
              : 200;
        const i = (y * width + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return { data, width, height };
  }

  it("ring luma over sheet luma (模擬: a ring at 150 on a sheet at 200 → 0.75)", () => {
    const r = computeShadowRing(frame(150), corners, hand)!;
    expect(r.ratio).toBeCloseTo(0.75, 9);
    expect(r.step).toBe(1);
    expect(r.ringPixels).toBeGreaterThan(SHADOW_RING.minPixels);
    expect(r.paperPixels).toBeGreaterThan(SHADOW_RING.minPixels);
  });

  it("no shadow → 1", () => {
    expect(computeShadowRing(frame(200), corners, hand)!.ratio).toBe(1);
  });

  it("null for a missing hand, corners or pixels, and never throws", () => {
    const f = frame(150);
    expect(computeShadowRing(f, corners, null)).toBeNull();
    expect(computeShadowRing(f, null, hand)).toBeNull();
    expect(computeShadowRing(f, corners.slice(0, 3), hand)).toBeNull();
    expect(computeShadowRing(null, corners, hand)).toBeNull();
    expect(
      computeShadowRing(
        { data: new Uint8ClampedArray(10), width, height },
        corners,
        hand,
      ),
    ).toBeNull();
  });
});

describe("computeShadowRing cost (desktop, 實測 on this machine)", () => {
  /** A uniform frame (the cost does not depend on the luma) with the 360×640 scene scaled up. */
  function bigScene(width: number, height: number) {
    const k = Math.min(width / 360, height / 640);
    const corners: Point2[] = [
      { x: 20 * k, y: 20 * k },
      { x: 340 * k, y: 20 * k },
      { x: 340 * k, y: 620 * k },
      { x: 20 * k, y: 620 * k },
    ];
    const hand = syntheticHand(
      { spread: false },
      { scale: 1.2 * k, offset: { x: 180 * k, y: 560 * k } },
    );
    const data = new Uint8ClampedArray(width * height * 4).fill(200);
    return { frame: { data, width, height }, corners, hand };
  }

  it.each([
    [1080, 1920, 3],
    [3000, 4000, 6],
  ])("%i×%i: step %i, time reported", (width, height, step) => {
    const s = bigScene(width, height);
    const first = computeShadowRing(s.frame, s.corners, s.hand)!;
    expect(first).not.toBeNull();
    expect(first.step).toBe(step);
    const N = 5;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) computeShadowRing(s.frame, s.corners, s.hand);
    const meanMs = (performance.now() - t0) / N;
    console.log(
      `[WP1b bench] computeShadowRing ${width}×${height} step ${first.step}: ${meanMs.toFixed(2)} ms (mean of ${N})`,
    );
    // Loose bound so a busy machine does not flake; the number is reported, the step keeps it small.
    expect(meanMs).toBeLessThan(200);
  });
});
