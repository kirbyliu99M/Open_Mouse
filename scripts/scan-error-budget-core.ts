/**
 * Scan error budget: the pure core of `scripts/scan-error-budget.ts`.
 *
 * SIMULATION, NOT MEASUREMENT. Everything here is a synthetic pinhole camera
 * looking at a synthetic flat hand on a synthetic A4 sheet. It runs the REAL
 * pipeline functions (`buildPaperHomography`, `computeCorrectedHandMeasurements`,
 * which in turn call `estimateHomography`, `recoverCameraPose`,
 * `estimateFocalFromHomography`, `correctLandmarksByHandLength` and
 * `MEASUREMENT_DEFINITIONS`) on perturbed inputs and reports how far the
 * resulting handLengthMm / palmWidthMm land from the synthetic truth. No
 * formula is re-implemented here. The only things this file owns are the
 * synthetic world (camera, hand, noise) and the statistics.
 *
 * Assumptions that are NOT facts about real phones, hands or detectors:
 *  - image 1080 x 1440 (portrait), f = 1081 px (a 26 mm-equivalent main camera:
 *    26 / 43.27 x the 1800 px diagonal), principal point at the image centre;
 *  - noise is independent per point and per axis, Gaussian. Real paper-corner
 *    errors come from line fits (correlated along a side) and real MediaPipe
 *    errors are correlated across a finger, so independent noise is a
 *    simplification whose direction of error is not known;
 *  - the hand template is a stylised flat hand (proportions below), not a
 *    measured one; the true joint heights are the product's own Garrett
 *    ratios (`landmarkHeightsMm`) times a scale and a per-joint jitter.
 *
 * Everything is deterministic: the same seed gives the same numbers.
 */
import {
  PAPER_SIZES_MM,
  buildPaperHomography,
} from "../src/client/paper/homography";
import { centrePrincipalPoint } from "../src/client/geometry/camera-pose";
import {
  computeCorrectedHandMeasurements,
  computeHandMeasurements,
} from "../src/client/geometry/measurements";
import type { Point2 } from "../src/client/geometry/homography";
import { landmarkHeightsMm } from "../src/client/geometry/parallax";

// ── Deterministic randomness ─────────────────────────────────────────────

/** mulberry32: a tiny deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the parts, so each (seed, label, index) gets its own stream. */
export function hashSeed(...parts: readonly (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = `${part}|`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

/** One standard-normal draw (Box-Muller, uses two uniforms, keeps no state). */
export function gaussian(rng: () => number): number {
  const u1 = 1 - rng(); // (0, 1]
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ── The synthetic world ──────────────────────────────────────────────────

export const IMAGE_WIDTH_PX = 1080;
export const IMAGE_HEIGHT_PX = 1440;
/** 26 mm-equivalent main camera: 26 / 43.27 x the image diagonal (1800 px). */
export const FOCAL_PX =
  (26 / 43.27) * Math.hypot(IMAGE_WIDTH_PX, IMAGE_HEIGHT_PX);
export const HAND_SIZES_MM = [160, 190, 220] as const;
export const PAPER = "a4" as const;

/**
 * A stylised flat right hand, MediaPipe's 21 landmarks, in units of the hand
 * length (landmark 0 to 12 = exactly 1). x right, y toward the fingertips.
 * Proportions are plausible, not measured: palm (0 to 9) 0.55, middle finger
 * 0.45, palm width (5 to 17) about 0.38.
 */
export const HAND_TEMPLATE: readonly Point2[] = [
  { x: 0, y: 0 }, // 0 wrist
  { x: -0.1, y: 0.1 }, // 1 thumb CMC
  { x: -0.19, y: 0.2 }, // 2 thumb MCP
  { x: -0.26, y: 0.29 }, // 3 thumb IP
  { x: -0.31, y: 0.37 }, // 4 thumb tip
  { x: -0.13, y: 0.54 }, // 5 index MCP
  { x: -0.14, y: 0.74 }, // 6 index PIP
  { x: -0.145, y: 0.86 }, // 7 index DIP
  { x: -0.15, y: 0.95 }, // 8 index tip
  { x: 0, y: 0.55 }, // 9 middle MCP
  { x: 0, y: 0.77 }, // 10 middle PIP
  { x: 0, y: 0.9 }, // 11 middle DIP
  { x: 0, y: 1 }, // 12 middle tip
  { x: 0.125, y: 0.53 }, // 13 ring MCP
  { x: 0.13, y: 0.73 }, // 14 ring PIP
  { x: 0.135, y: 0.85 }, // 15 ring DIP
  { x: 0.14, y: 0.94 }, // 16 ring tip
  { x: 0.25, y: 0.49 }, // 17 little MCP
  { x: 0.265, y: 0.64 }, // 18 little PIP
  { x: 0.27, y: 0.74 }, // 19 little DIP
  { x: 0.275, y: 0.82 }, // 20 little tip
];

/** One drawn scene: where the camera is and where the hand lies. Shared by every condition for the same index. */
export interface Scene {
  readonly index: number;
  /** Camera height above the sheet, mm. */
  readonly distanceMm: number;
  readonly tiltDeg: number;
  readonly tiltAzimuthRad: number;
  /** Where the optical axis meets the sheet, mm (sheet frame, y down). */
  readonly aimMm: Point2;
  readonly handLengthMm: number;
  /** Wrist position on the sheet, mm. */
  readonly wristMm: Point2;
  readonly handYawRad: number;
}

/** The hand's true joint-centre positions on the sheet plane (x, y in mm), for a scene. */
export function trueHandSheetMm(scene: Scene): Point2[] {
  const cos = Math.cos(scene.handYawRad);
  const sin = Math.sin(scene.handYawRad);
  return HAND_TEMPLATE.map((p) => {
    const u = p.x * scene.handLengthMm;
    const v = p.y * scene.handLengthMm;
    return {
      x: scene.wristMm.x + u * cos - v * sin,
      // Sheet y is down the page; fingertips point up the page.
      y: scene.wristMm.y - (u * sin + v * cos),
    };
  });
}

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

function matMul(a: Mat3, b: Mat3): Mat3 {
  const out: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) out[i][j] += a[i][k] * b[k][j];
  return out;
}

/** Rodrigues rotation matrix for a unit axis and an angle. */
function rotationAboutAxis(axis: Vec3, angle: number): Mat3 {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

/** The synthetic camera's ground truth, in camera-pose.ts's world frame (Xw right, Yw = -sheet y, Zw up toward the camera). */
export interface SyntheticCamera {
  readonly R: Mat3;
  readonly t: Vec3;
  readonly fPx: number;
}

/**
 * A camera `distanceMm` above the sheet, its optical axis aimed at `aimMm`
 * after tilting `tiltDeg` off straight-down about a horizontal axis at
 * `tiltAzimuthRad`. Straight down maps world +Xw to camera +X, +Yw to camera
 * -Y and +Zw to camera -Z (the convention camera-pose.ts documents), so image
 * x follows sheet x and image y follows sheet y.
 */
export function buildCamera(scene: Scene): SyntheticCamera {
  const down: Mat3 = [
    [1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
  ];
  const tilt = rotationAboutAxis(
    [Math.cos(scene.tiltAzimuthRad), Math.sin(scene.tiltAzimuthRad), 0],
    (scene.tiltDeg * Math.PI) / 180,
  );
  const R = matMul(down, tilt);
  // Optical axis in the world frame = Rᵀ · (0, 0, 1) = third row of R.
  const axis: Vec3 = [R[2][0], R[2][1], R[2][2]];
  const s = scene.distanceMm / -axis[2];
  const aimWorld: Vec3 = [scene.aimMm.x, -scene.aimMm.y, 0];
  const centre: Vec3 = [
    aimWorld[0] - s * axis[0],
    aimWorld[1] - s * axis[1],
    aimWorld[2] - s * axis[2],
  ];
  const t: Vec3 = [
    -(R[0][0] * centre[0] + R[0][1] * centre[1] + R[0][2] * centre[2]),
    -(R[1][0] * centre[0] + R[1][1] * centre[1] + R[1][2] * centre[2]),
    -(R[2][0] * centre[0] + R[2][1] * centre[1] + R[2][2] * centre[2]),
  ];
  return { R, t, fPx: FOCAL_PX };
}

/**
 * Project a point on the sheet (mm, y down) at a height above it into image
 * pixels, with radial distortion `k1` in normalised camera coordinates:
 * (xn, yn) -> (xn, yn) · (1 + k1 · (xn² + yn²)). Returns null when the point is
 * behind the camera.
 */
export function projectToPixel(
  camera: SyntheticCamera,
  sheetMm: Point2,
  heightMm: number,
  k1: number,
): Point2 | null {
  const w: Vec3 = [sheetMm.x, -sheetMm.y, heightMm];
  const { R, t } = camera;
  const xc = R[0][0] * w[0] + R[0][1] * w[1] + R[0][2] * w[2] + t[0];
  const yc = R[1][0] * w[0] + R[1][1] * w[1] + R[1][2] * w[2] + t[1];
  const zc = R[2][0] * w[0] + R[2][1] * w[1] + R[2][2] * w[2] + t[2];
  if (!(zc > 0)) return null;
  const xn = xc / zc;
  const yn = yc / zc;
  const factor = 1 + k1 * (xn * xn + yn * yn);
  const { cx, cy } = centrePrincipalPoint(IMAGE_WIDTH_PX, IMAGE_HEIGHT_PX);
  return {
    x: camera.fPx * xn * factor + cx,
    y: camera.fPx * yn * factor + cy,
  };
}

function paperCornersMm(): [Point2, Point2, Point2, Point2] {
  const { width, height } = PAPER_SIZES_MM[PAPER];
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

function inFrame(p: Point2 | null): boolean {
  return (
    p !== null &&
    p.x >= 0 &&
    p.x <= IMAGE_WIDTH_PX &&
    p.y >= 0 &&
    p.y <= IMAGE_HEIGHT_PX
  );
}

/**
 * Draw scene `index`. Distance 350 to 500 mm, tilt 0 to 10 degrees in a random
 * direction, the optical axis aimed within 20 mm of the sheet centre, hand
 * length cycling 160 / 190 / 220 mm, the hand within a few cm of the sheet
 * centre and yawed within 15 degrees. A draw whose paper corners or hand fall
 * outside the frame is redrawn (the same stream, so still deterministic).
 */
export function drawScene(seed: number, index: number): Scene {
  const rng = mulberry32(hashSeed(seed, "scene", index));
  const { width, height } = PAPER_SIZES_MM[PAPER];
  const handLengthMm = HAND_SIZES_MM[index % HAND_SIZES_MM.length];
  for (let attempt = 0; attempt < 1000; attempt++) {
    const scene: Scene = {
      index,
      distanceMm: 350 + 150 * rng(),
      tiltDeg: 10 * rng(),
      tiltAzimuthRad: 2 * Math.PI * rng(),
      aimMm: {
        x: width / 2 + (2 * rng() - 1) * 20,
        y: height / 2 + (2 * rng() - 1) * 20,
      },
      handLengthMm,
      wristMm: {
        x: width / 2 + (2 * rng() - 1) * 20,
        y: height / 2 + handLengthMm / 2 + (2 * rng() - 1) * 15,
      },
      handYawRad: ((2 * rng() - 1) * 15 * Math.PI) / 180,
    };
    const camera = buildCamera(scene);
    const heights = landmarkHeightsMm(handLengthMm);
    const corners = paperCornersMm().map((c) =>
      projectToPixel(camera, c, 0, 0),
    );
    const hand = trueHandSheetMm(scene).map((p, i) =>
      projectToPixel(camera, p, heights[i], 0),
    );
    if (corners.every(inFrame) && hand.every(inFrame)) return scene;
  }
  throw new Error(`drawScene: no in-frame scene for index ${index}.`);
}

// ── Perturbations ────────────────────────────────────────────────────────

/** A value that is either fixed or drawn uniformly from [lo, hi] per scan. */
export type Dist =
  | { readonly kind: "fixed"; readonly value: number }
  | { readonly kind: "uniform"; readonly lo: number; readonly hi: number };

export const fixed = (value: number): Dist => ({ kind: "fixed", value });
export const uniform = (lo: number, hi: number): Dist => ({
  kind: "uniform",
  lo,
  hi,
});

function sampleDist(dist: Dist, u: number): number {
  return dist.kind === "fixed" ? dist.value : dist.lo + (dist.hi - dist.lo) * u;
}

/** Where the focal length the pipeline uses comes from. */
export type FocalMode = "exif" | "homography";

export interface Perturbation {
  /** Paper-corner detection noise, px (1 sigma, per corner per axis). */
  readonly cornerSigmaPx: number;
  /** MediaPipe landmark noise, px (1 sigma, per landmark per axis). */
  readonly landmarkSigmaPx: number;
  /** `exif`: the pipeline is given true f x (1 + this); `homography`: no EXIF, f is estimated from the corners. */
  readonly focalMode: FocalMode;
  /** Relative error of the EXIF focal length (ignored for `homography`). */
  readonly focalRel: Dist;
  /** Every true joint height = assumed height x this scale. */
  readonly heightScale: Dist;
  /** Each joint's true height is also multiplied by 1 + half x (2u - 1), u uniform per joint. 0 = none. */
  readonly heightJitterHalf: number;
  /** The measured landmarks are joint centres; the literature value is this many mm longer (applied to both measures). */
  readonly definitionOffsetMm: number;
  /** Radial distortion k1 left uncorrected. */
  readonly k1: Dist;
  /** False = the control without parallax correction (`computeHandMeasurements`). */
  readonly parallaxCorrection: boolean;
}

export const NO_PERTURBATION: Perturbation = {
  cornerSigmaPx: 0,
  landmarkSigmaPx: 0,
  focalMode: "exif",
  focalRel: fixed(0),
  heightScale: fixed(1),
  heightJitterHalf: 0,
  definitionOffsetMm: 0,
  k1: fixed(0),
  parallaxCorrection: true,
};

export interface ScanError {
  /** measured - reference, mm. */
  readonly handLengthErrMm: number;
  readonly palmWidthErrMm: number;
  /** True when the pipeline parallax-corrected (false = it fell back to the flat projection). */
  readonly parallaxCorrected: boolean;
}

function dist2(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * One simulated scan of `scene` under `perturbation`. Returns null when the
 * pipeline refuses the scan (it throws, e.g. the contract's range check on an
 * implausible measurement), which the product would show as an error screen.
 *
 * Each noise source has its own stream seeded by (seed, source, scene index),
 * and every stream is consumed the same way whatever the perturbation is, so
 * two conditions that share a source see the identical noise draw
 * (common random numbers: the one-at-a-time rows and the joint row compare
 * cleanly).
 */
export function simulateScan(
  seed: number,
  scene: Scene,
  perturbation: Perturbation,
): ScanError | null {
  const i = scene.index;
  const rngCorner = mulberry32(hashSeed(seed, "corner", i));
  const rngLandmark = mulberry32(hashSeed(seed, "landmark", i));
  const rngFocal = mulberry32(hashSeed(seed, "focal", i));
  const rngScale = mulberry32(hashSeed(seed, "scale", i));
  const rngJitter = mulberry32(hashSeed(seed, "jitter", i));
  const rngK1 = mulberry32(hashSeed(seed, "k1", i));

  const camera = buildCamera(scene);
  const k1 = sampleDist(perturbation.k1, rngK1());
  const focalRel = sampleDist(perturbation.focalRel, rngFocal());
  const heightScale = sampleDist(perturbation.heightScale, rngScale());

  const trueSheet = trueHandSheetMm(scene);
  const baseHeights = landmarkHeightsMm(scene.handLengthMm);
  const trueHeights = baseHeights.map((h) => {
    const jitter = 1 + perturbation.heightJitterHalf * (2 * rngJitter() - 1);
    return h * heightScale * jitter;
  });

  const cornersTrue = paperCornersMm().map((c) =>
    projectToPixel(camera, c, 0, k1),
  );
  const landmarksTrue = trueSheet.map((p, j) =>
    projectToPixel(camera, p, trueHeights[j], k1),
  );
  if (
    cornersTrue.some((p) => p === null) ||
    landmarksTrue.some((p) => p === null)
  ) {
    return null;
  }
  const corners = (cornersTrue as Point2[]).map((p) => ({
    x: p.x + perturbation.cornerSigmaPx * gaussian(rngCorner),
    y: p.y + perturbation.cornerSigmaPx * gaussian(rngCorner),
  })) as [Point2, Point2, Point2, Point2];
  const landmarks = (landmarksTrue as Point2[]).map((p) => ({
    x: p.x + perturbation.landmarkSigmaPx * gaussian(rngLandmark),
    y: p.y + perturbation.landmarkSigmaPx * gaussian(rngLandmark),
  }));

  const trueLengthMm = dist2(trueSheet[0], trueSheet[12]);
  const truePalmWidthMm = dist2(trueSheet[5], trueSheet[17]);
  const offset = perturbation.definitionOffsetMm;

  try {
    const homography = buildPaperHomography(corners, PAPER);
    if (!perturbation.parallaxCorrection) {
      const m = computeHandMeasurements(landmarks, homography);
      return {
        handLengthErrMm: m.handLengthMm - (trueLengthMm + offset),
        palmWidthErrMm: m.palmWidthMm - (truePalmWidthMm + offset),
        parallaxCorrected: false,
      };
    }
    const result = computeCorrectedHandMeasurements(landmarks, homography, {
      exifFocalPx:
        perturbation.focalMode === "exif" ? camera.fPx * (1 + focalRel) : null,
      widthPx: IMAGE_WIDTH_PX,
      heightPx: IMAGE_HEIGHT_PX,
    });
    return {
      handLengthErrMm:
        result.measurements.handLengthMm - (trueLengthMm + offset),
      palmWidthErrMm:
        result.measurements.palmWidthMm - (truePalmWidthMm + offset),
      parallaxCorrected: result.parallaxCorrected,
    };
  } catch {
    return null;
  }
}

// ── Statistics ───────────────────────────────────────────────────────────

export interface ErrorStats {
  readonly n: number;
  /** Mean error, mm. */
  readonly bias: number;
  /** Sample standard deviation, mm. */
  readonly sd: number;
  /** 95th percentile of |error|, mm (linear interpolation). */
  readonly p95Abs: number;
  /** Root mean square error, mm (sqrt of bias² + variance). */
  readonly rms: number;
}

export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function errorStats(errors: readonly number[]): ErrorStats {
  const n = errors.length;
  if (n === 0) return { n, bias: NaN, sd: NaN, p95Abs: NaN, rms: NaN };
  const bias = errors.reduce((s, e) => s + e, 0) / n;
  const variance =
    n > 1 ? errors.reduce((s, e) => s + (e - bias) ** 2, 0) / (n - 1) : 0;
  const sorted = errors.map(Math.abs).sort((a, b) => a - b);
  const mse = errors.reduce((s, e) => s + e * e, 0) / n;
  return {
    n,
    bias,
    sd: Math.sqrt(variance),
    p95Abs: percentile(sorted, 0.95),
    rms: Math.sqrt(mse),
  };
}

/** Sample covariance of two paired series: [[var a, cov], [cov, var b]]. */
export function covariance2(
  a: readonly number[],
  b: readonly number[],
): [[number, number], [number, number]] {
  const n = a.length;
  if (n !== b.length) throw new RangeError("covariance2: unequal lengths.");
  if (n < 2)
    return [
      [NaN, NaN],
      [NaN, NaN],
    ];
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let i = 0; i < n; i++) {
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
    sab += (a[i] - ma) * (b[i] - mb);
  }
  return [
    [saa / (n - 1), sab / (n - 1)],
    [sab / (n - 1), sbb / (n - 1)],
  ];
}

export interface ConditionResult {
  readonly name: string;
  readonly n: number;
  /** Scans the pipeline refused (it threw). */
  readonly rejected: number;
  /** Share of accepted scans that were parallax-corrected. */
  readonly correctedFraction: number;
  readonly handLength: ErrorStats;
  readonly palmWidth: ErrorStats;
  /** Covariance of (handLength error, palmWidth error) over the accepted scans. */
  readonly covariance: [[number, number], [number, number]];
  /** The same errors split by whether the pipeline parallax-corrected (only mixed when no EXIF focal is given). */
  readonly bySource: {
    readonly corrected: { handLength: ErrorStats; palmWidth: ErrorStats };
    readonly flat: { handLength: ErrorStats; palmWidth: ErrorStats };
  };
  readonly byHandSize: Record<
    string,
    { handLength: ErrorStats; palmWidth: ErrorStats }
  >;
}

/** Run `n` scans (scenes 0..n-1, shared by every condition) under one perturbation. */
export function runCondition(
  seed: number,
  n: number,
  name: string,
  perturbation: Perturbation,
  scenes?: readonly Scene[],
): ConditionResult {
  const lengthErrors: number[] = [];
  const widthErrors: number[] = [];
  const bySize = new Map<number, { len: number[]; wid: number[] }>();
  const split = {
    corrected: { len: [] as number[], wid: [] as number[] },
    flat: { len: [] as number[], wid: [] as number[] },
  };
  let rejected = 0;
  let corrected = 0;
  for (let i = 0; i < n; i++) {
    const scene = scenes ? scenes[i] : drawScene(seed, i);
    const err = simulateScan(seed, scene, perturbation);
    if (err === null) {
      rejected++;
      continue;
    }
    if (err.parallaxCorrected) corrected++;
    const half = err.parallaxCorrected ? split.corrected : split.flat;
    half.len.push(err.handLengthErrMm);
    half.wid.push(err.palmWidthErrMm);
    lengthErrors.push(err.handLengthErrMm);
    widthErrors.push(err.palmWidthErrMm);
    const bucket = bySize.get(scene.handLengthMm) ?? { len: [], wid: [] };
    bucket.len.push(err.handLengthErrMm);
    bucket.wid.push(err.palmWidthErrMm);
    bySize.set(scene.handLengthMm, bucket);
  }
  const byHandSize: ConditionResult["byHandSize"] = {};
  for (const size of HAND_SIZES_MM) {
    const bucket = bySize.get(size) ?? { len: [], wid: [] };
    byHandSize[String(size)] = {
      handLength: errorStats(bucket.len),
      palmWidth: errorStats(bucket.wid),
    };
  }
  return {
    name,
    n,
    rejected,
    correctedFraction: lengthErrors.length
      ? corrected / lengthErrors.length
      : NaN,
    handLength: errorStats(lengthErrors),
    palmWidth: errorStats(widthErrors),
    covariance: covariance2(lengthErrors, widthErrors),
    bySource: {
      corrected: {
        handLength: errorStats(split.corrected.len),
        palmWidth: errorStats(split.corrected.wid),
      },
      flat: {
        handLength: errorStats(split.flat.len),
        palmWidth: errorStats(split.flat.wid),
      },
    },
    byHandSize,
  };
}

export function drawScenes(seed: number, n: number): Scene[] {
  return Array.from({ length: n }, (_, i) => drawScene(seed, i));
}

// ── Joint profiles and the variance decomposition ───────────────────────

export type SourceKey =
  | "corner"
  | "landmark"
  | "focal"
  | "heightScale"
  | "heightJitter"
  | "distortion";

export const SOURCE_LABELS: Record<SourceKey, string> = {
  corner: "紙角像素噪音",
  landmark: "landmark 像素噪音",
  focal: "focal 誤差 (EXIF)",
  heightScale: "關節高度整體縮放",
  heightJitter: "關節高度逐關節隨機",
  distortion: "徑向畸變 k1",
};

/** The distributions each source takes in one joint profile (all assumptions, none measured). */
export interface JointProfile {
  readonly name: string;
  readonly cornerSigmaPx: number;
  readonly landmarkSigmaPx: number;
  /** Focal error uniform in ±this fraction. */
  readonly focalHalf: number;
  readonly heightScale: { readonly lo: number; readonly hi: number };
  readonly heightJitterHalf: number;
  /** k1 uniform in ±this. */
  readonly k1Half: number;
}

export const JOINT_PROFILES: readonly JointProfile[] = [
  {
    name: "A 低",
    cornerSigmaPx: 0.5,
    landmarkSigmaPx: 1,
    focalHalf: 0.03,
    heightScale: { lo: 0.8, hi: 1.2 },
    heightJitterHalf: 0,
    k1Half: 0.01,
  },
  {
    name: "B 中",
    cornerSigmaPx: 1,
    landmarkSigmaPx: 2,
    focalHalf: 0.03,
    heightScale: { lo: 0.8, hi: 1.2 },
    heightJitterHalf: 0.3,
    k1Half: 0.02,
  },
  {
    name: "C 高",
    cornerSigmaPx: 2,
    landmarkSigmaPx: 4,
    focalHalf: 0.1,
    heightScale: { lo: 0.6, hi: 1.4 },
    heightJitterHalf: 0.3,
    k1Half: 0.05,
  },
];

/** The perturbation with only `source` switched on at the profile's level. */
export function singleSourcePerturbation(
  profile: JointProfile,
  source: SourceKey,
): Perturbation {
  switch (source) {
    case "corner":
      return { ...NO_PERTURBATION, cornerSigmaPx: profile.cornerSigmaPx };
    case "landmark":
      return { ...NO_PERTURBATION, landmarkSigmaPx: profile.landmarkSigmaPx };
    case "focal":
      return {
        ...NO_PERTURBATION,
        focalRel: uniform(-profile.focalHalf, profile.focalHalf),
      };
    case "heightScale":
      return {
        ...NO_PERTURBATION,
        heightScale: uniform(profile.heightScale.lo, profile.heightScale.hi),
      };
    case "heightJitter":
      return { ...NO_PERTURBATION, heightJitterHalf: profile.heightJitterHalf };
    case "distortion":
      return {
        ...NO_PERTURBATION,
        k1: uniform(-profile.k1Half, profile.k1Half),
      };
  }
}

/** Every source of the profile on at once (the definition offset stays out: it is a bias, not a spread). */
export function jointPerturbation(
  profile: JointProfile,
  focalMode: FocalMode = "exif",
): Perturbation {
  return {
    ...NO_PERTURBATION,
    cornerSigmaPx: profile.cornerSigmaPx,
    landmarkSigmaPx: profile.landmarkSigmaPx,
    focalMode,
    focalRel: uniform(-profile.focalHalf, profile.focalHalf),
    heightScale: uniform(profile.heightScale.lo, profile.heightScale.hi),
    heightJitterHalf: profile.heightJitterHalf,
    k1: uniform(-profile.k1Half, profile.k1Half),
  };
}

export interface VarianceShare {
  readonly source: SourceKey;
  /** SD of the error with only this source on, mm. */
  readonly sd: number;
  /** sd², mm². */
  readonly variance: number;
  /** variance / sum of the one-at-a-time variances. */
  readonly share: number;
}

export interface Decomposition {
  readonly shares: VarianceShare[];
  /** Sum of the one-at-a-time variances, mm². */
  readonly sumOfVariances: number;
  /** Variance with every source on, mm². */
  readonly jointVariance: number;
  /** sumOfVariances / jointVariance: 1 = additive, below 1 = the sources interact upward, above 1 = they partly cancel. */
  readonly additivityRatio: number;
}

/** Variance shares of one measure; `pick` selects handLength or palmWidth from a condition result. */
export function decompose(
  singles: ReadonlyArray<{ source: SourceKey; stats: ErrorStats }>,
  joint: ErrorStats,
): Decomposition {
  const variances = singles.map((s) => ({
    source: s.source,
    sd: s.stats.sd,
    variance: s.stats.sd ** 2,
  }));
  const sum = variances.reduce((acc, v) => acc + v.variance, 0);
  const jointVariance = joint.sd ** 2;
  return {
    shares: variances.map((v) => ({
      ...v,
      share: sum > 0 ? v.variance / sum : NaN,
    })),
    sumOfVariances: sum,
    jointVariance,
    additivityRatio: jointVariance > 0 ? sum / jointVariance : NaN,
  };
}
