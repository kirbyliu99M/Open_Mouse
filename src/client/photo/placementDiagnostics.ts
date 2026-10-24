/**
 * SHADOW MODE (V3.3 WP1b, 2026-10-25, 未拍板 candidate): the placement and
 * flatness readings of one analysed photo, for the local attempt log only.
 * Design: F20 DESIGN-placement-guidance §5.1 (v33-program-2026-10-25) and
 * PROGRAM.md's rulings on WP1a. Nothing here changes a measurement, a gate,
 * what the screen shows or what analytics sends: it is worked out beside the
 * result from points the measurement already used, and every function returns
 * `null` (never throws) for input it cannot use.
 *
 * What is recorded (summary numbers only: no landmark, no world point, no
 * pixel leaves this module as a list):
 *   - `placement`: `computeHandPlacement` (handPlacement.ts) on the SAME
 *     parallax-corrected sheet-mm landmarks the measurement used (the
 *     uncorrected homography projection when the scan was not corrected).
 *   - `world`: `computeHandWorld` (handWorld.ts) on MediaPipe's world
 *     landmarks, with the camera rotation `recoverCameraPose(H, K).R` when the
 *     scan had a focal length (else `null`, so `palmTiltDeg` is `null`).
 *   - `zWristMinusMcp`: MediaPipe's image-landmark z of the wrist (0) minus
 *     the mean z of the four finger knuckles (5, 9, 13, 17), in MediaPipe's
 *     own units (relative depth, about image-width scale). AGY R1 (文獻, not
 *     verified here): the image z jumps from frame to frame, so this is a
 *     research number, nothing more.
 *   - `camDistMm` / `camOffsetMm`: from the same pose, the camera's height
 *     above the sheet plane, and how far its foot point on the sheet is from
 *     the sheet's centre (mm). `null` without a pose.
 *   - `frameEdge`: PROGRAM.md ruling 3, "the hand too near the edge of the
 *     PICTURE" (not the sheet): the smallest distance of a non-thumb landmark
 *     (0, 5-20) to the analysed image's border, in px and as a fraction of the
 *     image's short side; negative when a landmark is outside the picture.
 *   - `shadowRing` (research, §5.1, optional): the median luma of a ring just
 *     outside the hand (and arm) mask, divided by the median luma of the rest
 *     of the sheet; see `computeShadowRing`. Only a number; no judgement.
 *
 * `paper.widthFraction` (diagnostics.ts `paperSizeFractions`) and the
 * design's 紙占寬 ("fill", the live `computeQuadWidthFraction` of cues.ts):
 * both are the mean of the sheet's top and bottom side lengths (TL-TR and
 * BL-BR) over the width of the picture the detector looked at (the photo's
 * analysed, possibly cropped, image; the live loop's on-screen sample). Same
 * definition, so the photo's fill is `paper.widthFraction` and is not stored
 * twice (WP1a ruling 5, checked in WP1b).
 */
import {
  centrePrincipalPoint,
  recoverCameraPose,
  type CameraPose,
} from "../geometry/camera-pose";
import {
  applyHomography,
  type Homography,
  type Point2,
} from "../geometry/homography";
import { correctLandmarks } from "../geometry/parallax";
import {
  buildHandMask,
  HAND_MASK,
  isCoveredByHand,
  type HandMask,
} from "../paper/handMask";
import { PAPER_SIZES_MM, type PaperSize } from "@/lib/contracts/measurement";
import {
  computeHandPlacement,
  EMPTY_HAND_PLACEMENT,
  isValidLandmarks21,
  type HandPlacement,
} from "./handPlacement";
import {
  computeHandWorld,
  EMPTY_HAND_WORLD,
  type HandWorldMetrics,
  type Point3,
} from "./handWorld";

/** Landmarks checked against the picture's border: wrist + four fingers (thumb 1-4 left out). */
const NON_THUMB: readonly number[] = [
  0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
];
const MCPS: readonly number[] = [5, 9, 13, 17];

export interface FrameEdgeDistance {
  /** Smallest distance of a non-thumb landmark to the picture's border, px (negative = outside). */
  readonly minPx: number;
  /** `minPx` over the picture's short side. */
  readonly fractionOfShortSide: number;
}

/**
 * How near the hand comes to the edge of the analysed picture (PROGRAM.md
 * WP1a ruling 3). `null` unless 21 finite landmarks and a positive size.
 * Pure.
 */
export function frameEdgeDistance(
  landmarksPx: readonly Point2[] | null | undefined,
  width: number,
  height: number,
): FrameEdgeDistance | null {
  if (!isValidLandmarks21(landmarksPx)) return null;
  if (!(Number.isFinite(width) && width > 0)) return null;
  if (!(Number.isFinite(height) && height > 0)) return null;
  let minPx = Infinity;
  for (const i of NON_THUMB) {
    const p = landmarksPx[i];
    minPx = Math.min(minPx, p.x, p.y, width - p.x, height - p.y);
  }
  return { minPx, fractionOfShortSide: minPx / Math.min(width, height) };
}

/**
 * Wrist z minus the mean of the four knuckles' z (MediaPipe image-landmark
 * depth). `null` unless 21 finite values. Pure.
 */
export function zWristMinusMcp(
  z: readonly number[] | null | undefined,
): number | null {
  if (!Array.isArray(z) || z.length !== 21) return null;
  if (!z.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  let sum = 0;
  for (const i of MCPS) sum += z[i];
  return z[0] - sum / MCPS.length;
}

export interface CameraPlacement {
  /** The camera's height above the sheet plane, mm. */
  readonly camDistMm: number;
  /** Distance from the camera's foot point on the sheet to the sheet's centre, mm. */
  readonly camOffsetMm: number;
}

/**
 * The camera's height and its offset from the sheet's centre, from a pose of
 * `camera-pose.ts` (world frame: Xw = sheet x, Yw = −sheet y). `null` for an
 * unknown paper size or a non-finite pose. Pure.
 */
export function cameraPlacement(
  pose: Pick<CameraPose, "cameraCentreWorld" | "cameraHeightMm"> | null,
  paperSize: PaperSize,
): CameraPlacement | null {
  if (!pose) return null;
  const sheet = (
    PAPER_SIZES_MM as Record<
      string,
      { width: number; height: number } | undefined
    >
  )[paperSize];
  if (!sheet) return null;
  const [cx, cy] = pose.cameraCentreWorld;
  const h = pose.cameraHeightMm;
  if (![cx, cy, h].every(Number.isFinite)) return null;
  // The sheet's centre in the world frame: (W/2, −H/2).
  const camOffsetMm = Math.hypot(cx - sheet.width / 2, cy + sheet.height / 2);
  return { camDistMm: h, camOffsetMm };
}

// ── shadowRing ───────────────────────────────────────────────────────────

/**
 * The ring's sizes, in palm widths (index knuckle 5 to little knuckle 17),
 * like the F19 hand mask (handMask.ts) they are built from. Candidates (未拍板);
 * WP2's "pencil under the wrist" scans are what this number is for.
 *   - `innerPalmWidths` 0.35: F19's own margin, about the hand's skin outline
 *     plus a little (handMask.ts: about 23-28 mm, 模擬).
 *   - `ringPalmWidths` 0.15: how wide the ring is outside that (about 10-12 mm,
 *     模擬), where a contact shadow, or the gap of a lifted hand, would show.
 *   - `paperClearPalmWidths` 0.8: the sheet reference leaves out everything
 *     within this margin of the hand and arm, so the ring's own shadow is not
 *     in it.
 *   - `targetLongEdgePx` 640: pixels are read on a grid whose step makes the
 *     analysed picture about this long (the live loop's sample size), to keep
 *     the cost small; the step is 1 for a picture already that small.
 *   - `minPixels` 50: fewer ring or sheet pixels than this → `null`.
 */
export const SHADOW_RING = Object.freeze({
  innerPalmWidths: HAND_MASK.marginPalmWidths,
  ringPalmWidths: 0.15,
  paperClearPalmWidths: 0.8,
  targetLongEdgePx: 640,
  minPixels: 50,
});

export interface ShadowRingFrame {
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface ShadowRingResult {
  /** Ring median luma ÷ sheet median luma. */
  readonly ratio: number;
  readonly ringPixels: number;
  readonly paperPixels: number;
  /** The grid step used, px. */
  readonly step: number;
}

function maskWithMargin(
  landmarks: readonly Point2[],
  width: number,
  height: number,
  marginPalmWidths: number,
): HandMask | null {
  return buildHandMask(landmarks, width, height, {
    ...HAND_MASK,
    marginPalmWidths,
  });
}

/** Whether `p` is inside the convex quad `q` (either winding; on an edge counts as inside). */
function insideQuad(q: readonly Point2[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function medianOfHistogram(hist: Uint32Array, count: number): number {
  // Lower median (the value at rank ceil(n/2)).
  const target = Math.ceil(count / 2);
  let seen = 0;
  for (let v = 0; v < hist.length; v++) {
    seen += hist[v];
    if (seen >= target) return v;
  }
  return hist.length - 1;
}

/**
 * The research `shadowRing` (§5.1): inside the sheet quad `cornersPx`, the
 * median luma (Rec. 601, 0-255) of the pixels in a ring just outside the hand
 * and arm mask (between `innerPalmWidths` and `innerPalmWidths +
 * ringPalmWidths`) over the median luma of the sheet's pixels further than
 * `paperClearPalmWidths` from the hand and arm. Below 1 = the ring is darker
 * than the sheet. Pixels are read on a grid (`targetLongEdgePx`). `null`
 * without 21 finite landmarks, four finite corners, a frame whose data
 * matches its size, enough pixels on both sides, or a sheet median of 0.
 * Pure; it reads the frame and writes nothing.
 */
export function computeShadowRing(
  frame: ShadowRingFrame | null | undefined,
  cornersPx: readonly Point2[] | null | undefined,
  landmarksPx: readonly Point2[] | null | undefined,
  limits: typeof SHADOW_RING = SHADOW_RING,
): ShadowRingResult | null {
  if (!frame || !isValidLandmarks21(landmarksPx)) return null;
  const { width, height, data } = frame;
  if (!(Number.isInteger(width) && width > 0)) return null;
  if (!(Number.isInteger(height) && height > 0)) return null;
  if (!data || data.length < width * height * 4) return null;
  if (
    !Array.isArray(cornersPx) ||
    cornersPx.length !== 4 ||
    !cornersPx.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  )
    return null;
  const inner = maskWithMargin(
    landmarksPx,
    width,
    height,
    limits.innerPalmWidths,
  );
  const outer = maskWithMargin(
    landmarksPx,
    width,
    height,
    limits.innerPalmWidths + limits.ringPalmWidths,
  );
  const clear = maskWithMargin(
    landmarksPx,
    width,
    height,
    limits.paperClearPalmWidths,
  );
  if (!inner || !outer || !clear) return null;

  const step = Math.max(
    1,
    Math.round(Math.max(width, height) / limits.targetLongEdgePx),
  );
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cornersPx) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  const x0 = Math.max(0, Math.floor(minX));
  const y0 = Math.max(0, Math.floor(minY));
  const x1 = Math.min(width - 1, Math.ceil(maxX));
  const y1 = Math.min(height - 1, Math.ceil(maxY));

  const ringHist = new Uint32Array(256);
  const paperHist = new Uint32Array(256);
  let ringPixels = 0;
  let paperPixels = 0;
  for (let y = y0; y <= y1; y += step) {
    const cy = y + 0.5;
    for (let x = x0; x <= x1; x += step) {
      const cx = x + 0.5;
      if (!insideQuad(cornersPx, cx, cy)) continue;
      const p = { x: cx, y: cy };
      if (isCoveredByHand(p, inner)) continue;
      const i = (y * width + x) * 4;
      const luma = Math.round(
        0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2],
      );
      const v = luma < 0 ? 0 : luma > 255 ? 255 : luma;
      if (isCoveredByHand(p, outer)) {
        ringHist[v] += 1;
        ringPixels += 1;
      } else if (!isCoveredByHand(p, clear)) {
        paperHist[v] += 1;
        paperPixels += 1;
      }
    }
  }
  if (ringPixels < limits.minPixels || paperPixels < limits.minPixels)
    return null;
  const paperMedian = medianOfHistogram(paperHist, paperPixels);
  if (!(paperMedian > 0)) return null;
  return {
    ratio: medianOfHistogram(ringHist, ringPixels) / paperMedian,
    ringPixels,
    paperPixels,
    step,
  };
}

// ── The photo's whole record ─────────────────────────────────────────────

export interface PlacementDiagnostics {
  readonly placement: HandPlacement;
  readonly world: HandWorldMetrics;
  /** Whether `placement` was read off parallax-corrected points (else the plain homography projection). */
  readonly corrected: boolean;
  readonly zWristMinusMcp: number | null;
  readonly camDistMm: number | null;
  readonly camOffsetMm: number | null;
  readonly frameEdge: FrameEdgeDistance | null;
  /** `computeShadowRing(...).ratio`, or `null`; filled in by the pipeline, which holds the pixels. */
  readonly shadowRing: number | null;
  /** How long `computeShadowRing` took, ms (measured with performance.now); `null` where it did not run. */
  readonly shadowRingMs: number | null;
}

export interface PlacementInput {
  /** The 21 landmarks in the analysed image's px (what the measurement used). */
  readonly landmarksPx: readonly Point2[];
  readonly homography: Homography;
  readonly paperSize: PaperSize;
  /** The analysed image's size (the principal point is its centre). */
  readonly analysed: { readonly width: number; readonly height: number };
  /**
   * The correction the measurement made: its focal length and the 21 heights
   * it back-projected at, or `null`s when it was not corrected.
   */
  readonly fPx: number | null;
  readonly heightsMm: readonly number[] | null;
  readonly worldLandmarks?: readonly Point3[] | null;
  readonly landmarkZ?: readonly number[] | null;
}

/**
 * The record for one photo, without `shadowRing` (the pipeline adds it).
 * `correctLandmarks` with the measurement's own focal length, principal point
 * and heights gives exactly the points the measurement was read off
 * (`computeCorrectedHandMeasurements` makes the same call). Never throws:
 * any part that fails is `null`, and nothing here is returned to the scan.
 */
export function buildPlacementDiagnostics(
  input: PlacementInput,
): PlacementDiagnostics {
  const { width, height } = input.analysed;
  let pose: CameraPose | null = null;
  let pointsMm: Point2[] | null = null;
  let corrected = false;
  try {
    if (
      input.fPx !== null &&
      Number.isFinite(input.fPx) &&
      input.fPx > 0 &&
      width > 0 &&
      height > 0
    ) {
      const intrinsics = {
        fPx: input.fPx,
        ...centrePrincipalPoint(width, height),
      };
      pose = recoverCameraPose(input.homography, intrinsics);
      if (input.heightsMm && input.heightsMm.length === 21) {
        pointsMm = correctLandmarks(
          input.landmarksPx,
          input.homography,
          intrinsics,
          input.heightsMm,
        );
        corrected = true;
      }
    }
  } catch {
    pose = null;
    pointsMm = null;
    corrected = false;
  }
  if (!pointsMm) {
    try {
      pointsMm = input.landmarksPx.map((p) =>
        applyHomography(input.homography, p),
      );
    } catch {
      pointsMm = null;
    }
  }
  let placement: HandPlacement = EMPTY_HAND_PLACEMENT;
  let world: HandWorldMetrics = EMPTY_HAND_WORLD;
  try {
    placement = computeHandPlacement(pointsMm, input.paperSize);
  } catch {
    placement = EMPTY_HAND_PLACEMENT;
  }
  try {
    world = computeHandWorld(input.worldLandmarks ?? null, pose?.R ?? null);
  } catch {
    world = EMPTY_HAND_WORLD;
  }
  const cam = cameraPlacement(pose, input.paperSize);
  return {
    placement,
    world,
    corrected: corrected && placement !== EMPTY_HAND_PLACEMENT,
    zWristMinusMcp: zWristMinusMcp(input.landmarkZ ?? null),
    camDistMm: cam?.camDistMm ?? null,
    camOffsetMm: cam?.camOffsetMm ?? null,
    frameEdge: frameEdgeDistance(input.landmarksPx, width, height),
    shadowRing: null,
    shadowRingMs: null,
  };
}
