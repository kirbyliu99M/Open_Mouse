/**
 * V3.3 WP1a: handPlacement.ts. Synthetic scenes in the style of the F20
 * placement simulation (review/F20/f20_placement_sim.ts): a pinhole camera
 * over the sheet's centre, a synthetic hand laid on the sheet with every
 * landmark at its `landmarkHeightsMm` height, projected to image px, then
 * recovered through the real paper homography + parallax correction. Every
 * number here is SIMULATED (模擬).
 */
import { describe, expect, it } from "vitest";
import {
  centredIntrinsics,
  computeHandPlacement,
  EMPTY_HAND_PLACEMENT,
  placementPointsMm,
} from "../../src/client/photo/handPlacement";
import { computeHandWorld } from "../../src/client/photo/handWorld";
import { buildPaperHomography } from "../../src/client/paper/homography";
import { recoverCameraPose } from "../../src/client/geometry/camera-pose";
import { landmarkHeightsMm } from "../../src/client/geometry/parallax";
import type { Point2 } from "../../src/client/geometry/homography";
import {
  PAPER_SIZES_MM,
  type PaperSize,
} from "../../src/lib/contracts/measurement";
import { syntheticHand } from "./helpers/synthetic-hand";
import {
  buildSyntheticCamera,
  projectSheetMm,
} from "./helpers/synthetic-camera";

const W_PX = 1080;
const H_PX = 1920;
const F_PX = 998;
const L = 190;

/** Unit hand (fingers together, wrist at origin, fingers toward −y) scaled to |0→12| = L. */
function handScale(): number {
  const u = syntheticHand({ spread: false });
  return L / Math.hypot(u[12].x - u[0].x, u[12].y - u[0].y);
}

interface SceneOpts {
  readonly paper?: PaperSize;
  /** Wrist position on the sheet, sheet mm. */
  readonly wrist: Point2;
  /** Hand rotation, degrees, clockwise on screen; 0 = fingers toward the top edge. */
  readonly rotationDeg?: number;
  readonly mirror?: boolean;
  readonly tiltDeg?: number;
  readonly distanceMm?: number;
}

function scene(o: SceneOpts) {
  const paper = o.paper ?? "a4";
  const { width: W, height: H } = PAPER_SIZES_MM[paper];
  const cam = buildSyntheticCamera({
    tiltDeg: o.tiltDeg ?? 4,
    distanceMm: o.distanceMm ?? 330,
    fPx: F_PX,
    widthPx: W_PX,
    heightPx: H_PX,
  });
  // Sheet centred under the camera.
  const toPx = (p: Point2, h = 0) =>
    projectSheetMm(cam, { x: p.x - W / 2, y: p.y - H / 2 }, h);
  const corners = [
    toPx({ x: 0, y: 0 }),
    toPx({ x: W, y: 0 }),
    toPx({ x: W, y: H }),
    toPx({ x: 0, y: H }),
  ] as const;
  const homography = buildPaperHomography(corners, paper);
  const truth = syntheticHand(
    { spread: false },
    {
      scale: handScale(),
      rotationDeg: o.rotationDeg ?? 0,
      mirror: o.mirror ?? false,
      offset: o.wrist,
    },
  );
  const heights = landmarkHeightsMm(L);
  const px = truth.map((p, i) => toPx(p, heights[i]));
  return { paper, W, H, cam, homography, truth, px };
}

function measured(s: ReturnType<typeof scene>) {
  const pts = placementPointsMm(s.px, s.homography, s.cam.intrinsics, {
    handLengthMm: L,
  });
  expect(pts).not.toBeNull();
  return { pts: pts!, m: computeHandPlacement(pts, s.paper) };
}

describe("computeHandPlacement — synthetic scenes (模擬, no noise)", () => {
  it("recovers wristToEdgeMm within 0.5 mm and the axis within 0.5° (A4, wrist 10 mm above the bottom edge)", () => {
    const s = scene({ wrist: { x: 105, y: 297 - 10 } });
    const { pts, m } = measured(s);
    expect(m.wristEdge).toBe("near-bottom");
    expect(Math.abs(m.wristToEdgeMm! - 10)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(m.handAxisDeg!)).toBeLessThanOrEqual(0.5);
    // Parallax-corrected points land on the truth.
    for (let i = 0; i < 21; i++) {
      expect(
        Math.hypot(pts[i].x - s.truth[i].x, pts[i].y - s.truth[i].y),
      ).toBeLessThan(0.05);
    }
    expect(m.thumbOutside).toBe(false);
    expect(m.minSideMarginMm!).toBeGreaterThan(3);
  });

  it("the uncorrected homography would be biased by several mm (why correction is required)", () => {
    const s = scene({ wrist: { x: 105, y: 297 - 10 } });
    const flatPts = s.px.map((p) => {
      const h = s.homography;
      const w = h[2][0] * p.x + h[2][1] * p.y + h[2][2];
      return {
        x: (h[0][0] * p.x + h[0][1] * p.y + h[0][2]) / w,
        y: (h[1][0] * p.x + h[1][1] * p.y + h[1][2]) / w,
      };
    });
    const raw = computeHandPlacement(flatPts, "a4");
    expect(Math.abs(raw.wristToEdgeMm! - 10)).toBeGreaterThan(3);
  });

  it.each([
    ["wrist on the edge", 0],
    ["wrist 20 mm up", 20],
    ["wrist 40 mm up", 40],
    ["wrist 5 mm past the edge", -5],
  ])("A4, %s", (_label, up) => {
    const { m } = measured(scene({ wrist: { x: 100, y: 297 - up } }));
    expect(m.wristEdge).toBe("near-bottom");
    expect(Math.abs(m.wristToEdgeMm! - up)).toBeLessThanOrEqual(0.5);
  });

  it("sheet upside down: wrist at the top edge, fingers pointing down", () => {
    const s = scene({ wrist: { x: 110, y: 12 }, rotationDeg: 180 });
    const { m } = measured(s);
    expect(m.wristEdge).toBe("near-top");
    expect(Math.abs(m.wristToEdgeMm! - 12)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(m.handAxisDeg!)).toBeLessThanOrEqual(0.5);
  });

  it("left hand (mirrored) gives the same wrist distance and axis", () => {
    const { m } = measured(
      scene({ wrist: { x: 105, y: 297 - 8 }, mirror: true }),
    );
    expect(Math.abs(m.wristToEdgeMm! - 8)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(m.handAxisDeg!)).toBeLessThanOrEqual(0.5);
  });

  it.each([
    ["right hand +15°", 15, false],
    ["right hand −15°", -15, false],
    ["left hand +15°", 15, true],
    ["left hand −15°", -15, true],
  ])("%s: axis sign and size", (_l, rot, mirror) => {
    const { m } = measured(
      scene({ wrist: { x: 105, y: 297 - 10 }, rotationDeg: rot, mirror }),
    );
    expect(Math.abs(m.handAxisDeg! - rot)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(m.wristToEdgeMm! - 10)).toBeLessThanOrEqual(0.5);
  });

  it("upside-down sheet with the hand turned 15° clockwise on screen", () => {
    const { m } = measured(
      scene({ wrist: { x: 105, y: 10 }, rotationDeg: 195 }),
    );
    expect(m.wristEdge).toBe("near-top");
    expect(Math.abs(m.handAxisDeg! - 15)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(m.wristToEdgeMm! - 10)).toBeLessThanOrEqual(0.5);
  });

  it("Letter paper, stronger tilt, closer camera", () => {
    const { m } = measured(
      scene({
        paper: "letter",
        wrist: { x: 108, y: 279.4 - 6 },
        tiltDeg: 10,
        distanceMm: 280,
      }),
    );
    expect(m.wristEdge).toBe("near-bottom");
    expect(Math.abs(m.wristToEdgeMm! - 6)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(m.handAxisDeg!)).toBeLessThanOrEqual(0.5);
  });

  it("a hand pointing at its own wrist edge reads about ±180°", () => {
    const { m } = measured(
      scene({ wrist: { x: 105, y: 297 - 120 }, rotationDeg: 180 }),
    );
    // Wrist at y = 177 is in the lower half → near-bottom, fingers point down.
    expect(m.wristEdge).toBe("near-bottom");
    expect(180 - Math.abs(m.handAxisDeg!)).toBeLessThanOrEqual(0.5);
  });

  it("palmOverHand and distalOverProximal match the truth", () => {
    const s = scene({ wrist: { x: 105, y: 290 } });
    const { m } = measured(s);
    const t = computeHandPlacement(s.truth, "a4");
    expect(Math.abs(m.palmOverHand! - t.palmOverHand!)).toBeLessThan(1e-3);
    for (let f = 0; f < 4; f++) {
      expect(
        Math.abs(m.distalOverProximal![f] - t.distalOverProximal![f]),
      ).toBeLessThan(1e-3);
    }
  });
});

describe("computeHandPlacement — definitions on hand-built points", () => {
  /** A straight "hand": wrist at (wx, wy), every landmark on a vertical line, thumb out to the left. */
  function stick(wx: number, wy: number, dir = -1): Point2[] {
    const p: Point2[] = [];
    p[0] = { x: wx, y: wy };
    for (let i = 1; i <= 4; i++)
      p[i] = { x: wx - 10 * i, y: wy + dir * 10 * i };
    for (let f = 0; f < 4; f++) {
      const x = wx + (f - 1.5) * 18;
      const mcp = 5 + 4 * f;
      p[mcp] = { x, y: wy + dir * 90 };
      p[mcp + 1] = { x, y: wy + dir * 130 }; // proximal 40
      p[mcp + 2] = { x, y: wy + dir * 155 }; // middle 25
      p[mcp + 3] = { x, y: wy + dir * (175 + f) }; // distal 20+f
    }
    p[9] = { x: wx, y: wy + dir * 95 };
    p[12] = { x: wx, y: wy + dir * 190 };
    return p;
  }

  it("ratios and margins", () => {
    const m = computeHandPlacement(stick(105, 287), "a4");
    expect(m.wristToEdgeMm).toBeCloseTo(10, 9);
    expect(m.handAxisDeg).toBeCloseTo(0, 9);
    expect(m.palmOverHand).toBeCloseTo(95 / 190, 9);
    // index: 20/40; middle: |p11→p12| = 190−155 = 35 over |p9→p10| = 130−95 = 35; ring 22/40; little 23/40
    expect(m.distalOverProximal![0]).toBeCloseTo(20 / 40, 9);
    expect(m.distalOverProximal![1]).toBeCloseTo(35 / 35, 9);
    expect(m.distalOverProximal![2]).toBeCloseTo(22 / 40, 9);
    expect(m.distalOverProximal![3]).toBeCloseTo(23 / 40, 9);
    // Far edge: tip y = 287 − 190 = 97; sides: 105 − 27 = 78 → min is 78.
    expect(m.minSideMarginMm).toBeCloseTo(78, 9);
    expect(m.thumbOutside).toBe(false);
  });

  it("minSideMarginMm goes negative past a side and ignores the wrist edge and the thumb", () => {
    const pts = stick(20, 300); // wrist 3 mm past the bottom edge, little finger column at x = −7
    const m = computeHandPlacement(pts, "a4");
    expect(m.wristToEdgeMm).toBeCloseTo(-3, 9);
    expect(m.minSideMarginMm).toBeCloseTo(20 - 27, 9);
    // thumb tip at x = 20 − 40 = −20 → outside
    expect(m.thumbOutside).toBe(true);
    // Moving only the thumb back inside changes nothing but thumbOutside.
    const moved = pts.slice();
    moved[4] = { x: 50, y: 250 };
    const m2 = computeHandPlacement(moved, "a4");
    expect(m2.thumbOutside).toBe(false);
    expect(m2.minSideMarginMm).toBe(m.minSideMarginMm);
  });

  it("far-edge margin is measured from the edge opposite the wrist", () => {
    const m = computeHandPlacement(stick(105, 20, 1), "a4"); // upside down
    expect(m.wristEdge).toBe("near-top");
    expect(m.wristToEdgeMm).toBeCloseTo(20, 9);
    // tip at y = 20 + 190 = 210 → 87 from the bottom; sides 78.
    expect(m.minSideMarginMm).toBeCloseTo(78, 9);
    expect(m.handAxisDeg).toBeCloseTo(0, 9);
  });

  it("a wrist at the exact middle counts as near-bottom", () => {
    expect(computeHandPlacement(stick(105, 148.5), "a4").wristEdge).toBe(
      "near-bottom",
    );
  });

  it("a zero-length proximal segment nulls distalOverProximal only", () => {
    const pts = stick(105, 287);
    pts[6] = pts[5];
    const m = computeHandPlacement(pts, "a4");
    expect(m.distalOverProximal).toBeNull();
    expect(m.wristToEdgeMm).toBeCloseTo(10, 9);
  });
});

describe("invalid input → all null, never throws", () => {
  const good = syntheticHand(
    { spread: false },
    { scale: 1, offset: { x: 105, y: 280 } },
  );
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["20 points", good.slice(0, 20)],
    ["22 points", [...good, good[0]]],
    ["a NaN", good.map((p, i) => (i === 7 ? { x: Number.NaN, y: p.y } : p))],
    [
      "an Infinity",
      good.map((p, i) => (i === 0 ? { x: p.x, y: Infinity } : p)),
    ],
    [
      "a missing point",
      good.map((p, i) => (i === 3 ? (undefined as unknown as Point2) : p)),
    ],
    [
      "a string coordinate",
      good.map((p, i) =>
        i === 3 ? ({ x: "1", y: 2 } as unknown as Point2) : p,
      ),
    ],
  ])("%s", (_l, pts) => {
    expect(
      computeHandPlacement(pts as Point2[] | null | undefined, "a4"),
    ).toEqual(EMPTY_HAND_PLACEMENT);
  });

  it("unknown paper size", () => {
    expect(computeHandPlacement(good, "a3" as PaperSize)).toEqual(
      EMPTY_HAND_PLACEMENT,
    );
  });

  it("placementPointsMm returns null for bad points, focal, hand length or homography", () => {
    const s = scene({ wrist: { x: 105, y: 287 } });
    const k = s.cam.intrinsics;
    expect(placementPointsMm(s.px.slice(0, 20), s.homography, k)).toBeNull();
    expect(placementPointsMm(s.px, s.homography, { ...k, fPx: 0 })).toBeNull();
    expect(
      placementPointsMm(s.px, s.homography, { ...k, cx: Number.NaN }),
    ).toBeNull();
    expect(
      placementPointsMm(s.px, s.homography, k, { handLengthMm: -1 }),
    ).toBeNull();
    const zero = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ] as unknown as typeof s.homography;
    expect(() => placementPointsMm(s.px, zero, k)).not.toThrow();
    expect(placementPointsMm(s.px, zero, k)).toBeNull();
  });

  it("centredIntrinsics puts the principal point at the frame centre", () => {
    expect(centredIntrinsics(333, 360, 640)).toEqual({
      fPx: 333,
      cx: 180,
      cy: 320,
    });
  });
});

describe("cost per hand reading (desktop, 實測 on this machine)", () => {
  it("placementPointsMm + computeHandPlacement + recoverCameraPose + computeHandWorld", () => {
    const s = scene({ wrist: { x: 105, y: 287 } });
    const world = s.truth.map((p) => ({ x: p.x / 1000, y: p.y / 1000, z: 0 }));
    const run = () => {
      const pts = placementPointsMm(s.px, s.homography, s.cam.intrinsics);
      computeHandPlacement(pts, "a4");
      const pose = recoverCameraPose(s.homography, s.cam.intrinsics);
      computeHandWorld(world, pose.R);
    };
    for (let i = 0; i < 200; i++) run(); // warm-up
    const N = 2000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) run();
    const perCallMs = (performance.now() - t0) / N;
    const t1 = performance.now();
    for (let i = 0; i < N; i++) computeHandPlacement(s.truth, "a4");
    const placementOnlyMs = (performance.now() - t1) / N;
    const t2 = performance.now();
    for (let i = 0; i < N; i++) computeHandWorld(world, s.cam.R);
    const worldOnlyMs = (performance.now() - t2) / N;
    console.log(
      `[WP1a bench] full ${perCallMs.toFixed(4)} ms; computeHandPlacement ${placementOnlyMs.toFixed(4)} ms; computeHandWorld ${worldOnlyMs.toFixed(4)} ms (mean of ${N})`,
    );
    // Loose bound so a busy machine does not flake; the target is ≤ 1 ms.
    expect(perCallMs).toBeLessThan(5);
  });
});
