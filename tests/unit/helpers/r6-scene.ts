/**
 * R6's synthetic pinhole scene (review\R6\lib.ts, V3.2 F10), brought into the
 * repo so its findings can be pinned as tests. A camera looks at an A4 sheet
 * on the table from a distance that makes the sheet's short side `fill` of
 * the image width, tilted by pitch / roll; a synthetic hand lies along the
 * sheet with each landmark raised to the product's own height model
 * (`landmarkHeightsMm`). The truth is the contract's planar joint-centre
 * distances (0-12, 5-17). Every number from it is SIMULATED (模擬).
 */
import type { Point2 } from "../../../src/client/geometry/homography";
import { landmarkHeightsMm } from "../../../src/client/geometry/parallax";
import { computeCorrectedHandMeasurements } from "../../../src/client/geometry/measurements";
import type { ReusedFocal } from "../../../src/client/geometry/parallax";
import { evaluateManualPaperCalibration } from "../../../src/client/paper/calibration";
import { buildPaperHomography } from "../../../src/client/paper/homography";
import {
  orientManualQuad,
  type Quad4,
} from "../../../src/client/paper/manualQuad";
import { syntheticHand } from "./synthetic-hand";

type M3 = number[];
const deg = (d: number) => (d * Math.PI) / 180;
function mul(a: M3, b: M3): M3 {
  const o = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}
const Rx = (a: number): M3 => [
  1,
  0,
  0,
  0,
  Math.cos(a),
  -Math.sin(a),
  0,
  Math.sin(a),
  Math.cos(a),
];
const Ry = (a: number): M3 => [
  Math.cos(a),
  0,
  Math.sin(a),
  0,
  1,
  0,
  -Math.sin(a),
  0,
  Math.cos(a),
];
const Rz = (a: number): M3 => [
  Math.cos(a),
  -Math.sin(a),
  0,
  Math.sin(a),
  Math.cos(a),
  0,
  0,
  0,
  1,
];
const app = (m: M3, v: number[]) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

interface Cam {
  f: number;
  w: number;
  h: number;
  R: M3;
  C: number[];
}

function makeCam(o: {
  f: number;
  w: number;
  h: number;
  d: number;
  pitchDeg?: number;
  rollDeg?: number;
}): Cam {
  const R = mul(Rz(deg(o.rollDeg ?? 0)), mul(Rx(deg(o.pitchDeg ?? 0)), Ry(0)));
  const ax = app(R, [0, 0, 1]);
  return {
    f: o.f,
    w: o.w,
    h: o.h,
    R,
    C: [-o.d * ax[0], -o.d * ax[1], -o.d * ax[2]],
  };
}

function project(cam: Cam, X: number, Y: number, Z = 0): Point2 {
  const d = [X - cam.C[0], Y - cam.C[1], Z - cam.C[2]];
  const RT: M3 = [
    cam.R[0],
    cam.R[3],
    cam.R[6],
    cam.R[1],
    cam.R[4],
    cam.R[7],
    cam.R[2],
    cam.R[5],
    cam.R[8],
  ];
  const pc = app(RT, d);
  return {
    x: cam.w / 2 + (cam.f * pc[0]) / pc[2],
    y: cam.h / 2 + (cam.f * pc[1]) / pc[2],
  };
}

const d2 = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);
const A4 = { w: 210, h: 297 };

export interface R6SceneOptions {
  readonly w: number;
  readonly h: number;
  /** The true focal length, px. */
  readonly f: number;
  readonly fill?: number;
  readonly pitchDeg?: number;
  readonly rollDeg?: number;
  /** Shifts the whole picture (corners and hand) sideways, px: a sheet partly out of frame. */
  readonly shiftX?: number;
}

export interface R6Scene {
  /** TL, TR, BR, BL with TL->TR the short side (the detector's labels). */
  readonly corners: Quad4;
  /** The 21 landmarks at the product's own heights, image px. */
  readonly raisedPx: readonly Point2[];
  readonly trueLen: number;
  readonly truePw: number;
}

export function buildR6Scene(o: R6SceneOptions): R6Scene {
  const fill = o.fill ?? 0.72;
  const d = (o.f * A4.w) / (fill * o.w);
  const cam = makeCam({
    f: o.f,
    w: o.w,
    h: o.h,
    d,
    pitchDeg: o.pitchDeg,
    rollDeg: o.rollDeg,
  });
  const raw = syntheticHand({ spread: false }, {});
  const L = 190;
  const k = L / d2(raw[0], raw[12]);
  const handMm = raw.map((p) => ({ x: p.x * k, y: p.y * k + 60 }));
  const sx = o.shiftX ?? 0;
  const at = (p: Point2) => ({ x: p.x + sx, y: p.y });
  const corners = [
    [-A4.w / 2, -A4.h / 2],
    [A4.w / 2, -A4.h / 2],
    [A4.w / 2, A4.h / 2],
    [-A4.w / 2, A4.h / 2],
  ].map(([x, y]) => at(project(cam, x, y))) as unknown as Quad4;
  const heights = landmarkHeightsMm(L);
  const raisedPx = handMm.map((p, i) =>
    at(project(cam, p.x, p.y, -heights[i])),
  );
  return {
    corners,
    raisedPx,
    trueLen: d2(handMm[0], handMm[12]),
    truePw: d2(handMm[5], handMm[17]),
  };
}

export interface R6Measured {
  readonly len: number;
  readonly pw: number;
  readonly source: string;
  readonly fPx: number | null;
  readonly corrected: boolean;
}

/** The automatic path's measurement (paperEdgeFinish.ts) from the detector's labelled corners. */
export function measureAuto(
  corners: Quad4,
  landmarks: readonly Point2[],
  image: { readonly w: number; readonly h: number },
  exifFocalPx: number | null,
): R6Measured {
  const homography = buildPaperHomography(corners, "a4");
  const r = computeCorrectedHandMeasurements(landmarks, homography, {
    exifFocalPx,
    widthPx: image.w,
    heightPx: image.h,
  });
  return {
    len: r.measurements.handLengthMm,
    pw: r.measurements.palmWidthMm,
    source: r.focalSource,
    fPx: r.fPx,
    corrected: r.parallaxCorrected,
  };
}

/**
 * The placed-frame path as `finishManualPaper` runs it (no crop):
 * orientManualQuad, evaluateManualPaperCalibration, then the same corrected
 * measurement, with the automatic run's focal length when given (F10).
 */
export function measurePlaced(
  corners: Quad4,
  landmarks: readonly Point2[],
  image: { readonly w: number; readonly h: number },
  exifFocalPx: number | null,
  focalPxHint: number,
  reusedFocal: ReusedFocal | null,
): R6Measured {
  const size = { width: image.w, height: image.h };
  const labelled = orientManualQuad(corners, "a4", size, focalPxHint);
  const ev = evaluateManualPaperCalibration({
    corners: labelled,
    cornersSource: "manual",
    paperSize: "a4",
    image: size,
    parallaxCorrected: false,
  });
  if (!ev.ok || !ev.geometry)
    throw new Error(`placed frame refused: ${JSON.stringify(ev.errors)}`);
  const r = computeCorrectedHandMeasurements(
    landmarks,
    ev.geometry.homography,
    {
      exifFocalPx,
      widthPx: image.w,
      heightPx: image.h,
      reusedFocal,
    },
  );
  return {
    len: r.measurements.handLengthMm,
    pw: r.measurements.palmWidthMm,
    source: r.focalSource,
    fPx: r.fPx,
    corrected: r.parallaxCorrected,
  };
}
