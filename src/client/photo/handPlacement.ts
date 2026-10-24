/**
 * SHADOW MODE (V3.3 WP1a, 2026-10-25, 未拍板 candidate): where the hand lies on
 * the sheet, worked out from the 21 parallax-corrected landmarks in sheet mm.
 * Pure functions that nothing acts on yet: they block no photo, change no
 * measurement, no gate and no submitted millimetre. Design: F20
 * DESIGN-placement-guidance §1.1 and §5.1 (v33-program-2026-10-25).
 *
 * Frame (same as every homography in this app, `paper/homography.ts`): sheet
 * mm, origin at the sheet's top-left corner, x right, y DOWN, portrait, so the
 * two short edges are y = 0 ("top") and y = height ("bottom").
 *
 * Fields (all `null` when the input is not 21 finite points or the paper size
 * is unknown; nothing here throws):
 *   - `wristEdge`: the short edge nearest landmark 0 (WRIST). "near-bottom" when
 *     the wrist is in the lower half (a tie at the exact middle goes to the
 *     bottom), "near-top" otherwise, so a sheet turned upside down works too.
 *   - `wristToEdgeMm`: distance from landmark 0 to that edge, positive inside
 *     the sheet, negative when the wrist is past it.
 *   - `handAxisDeg`: signed angle, degrees in (−180, 180], from the direction
 *     pointing AWAY from `wristEdge` along the sheet's long side to the hand
 *     axis 0→9 (wrist → middle-finger MCP). 0 = fingers point straight at the
 *     far edge; positive = turned clockwise as seen on screen (sheet y down);
 *     about ±180 = fingers point at the wrist edge (hand the wrong way round).
 *   - `minSideMarginMm`: the smallest signed distance (positive inside) of
 *     landmarks 0 and 5–20 (thumb 1–4 excluded) to the left edge, the right edge
 *     and the FAR short edge. The wrist edge is left out on purpose: the wrist is
 *     meant to sit on it.
 *   - `thumbOutside`: thumb tip (landmark 4) outside the sheet rectangle (a
 *     point exactly on an edge counts as inside). Recorded only.
 *   - `palmOverHand`: |0→9| ÷ |0→12| (§2.3).
 *   - `distalOverProximal`: per finger (index, middle, ring, little) |DIP→TIP| ÷
 *     |MCP→PIP|; `null` as a whole if any finger has a zero-length proximal
 *     segment.
 *
 * The thresholds that would turn these into reminders live in `softHint.ts`.
 */
import { centrePrincipalPoint, type Intrinsics } from "../geometry/camera-pose";
import type { Homography, Point2 } from "../geometry/homography";
import {
  correctLandmarks,
  landmarkHeightsMm,
  REFERENCE_HAND_LENGTH_MM,
} from "../geometry/parallax";
import { PAPER_SIZES_MM, type PaperSize } from "@/lib/contracts/measurement";

export type WristEdge = "near-bottom" | "near-top";

export interface HandPlacement {
  readonly wristToEdgeMm: number | null;
  readonly wristEdge: WristEdge | null;
  readonly handAxisDeg: number | null;
  readonly minSideMarginMm: number | null;
  readonly thumbOutside: boolean | null;
  readonly palmOverHand: number | null;
  readonly distalOverProximal: readonly [number, number, number, number] | null;
}

export const EMPTY_HAND_PLACEMENT: HandPlacement = Object.freeze({
  wristToEdgeMm: null,
  wristEdge: null,
  handAxisDeg: null,
  minSideMarginMm: null,
  thumbOutside: null,
  palmOverHand: null,
  distalOverProximal: null,
});

const LANDMARK_COUNT = 21;
/** Below this a length counts as zero (mm). */
const MIN_LENGTH_MM = 1e-6;
/** Landmarks checked against the side and far edges: wrist + four fingers. */
const MARGIN_LANDMARKS: readonly number[] = [
  0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
];
const RAD_TO_DEG = 180 / Math.PI;

function isFinitePoint(p: unknown): p is Point2 {
  if (!p || typeof p !== "object") return false;
  const q = p as { x?: unknown; y?: unknown };
  return (
    typeof q.x === "number" &&
    typeof q.y === "number" &&
    Number.isFinite(q.x) &&
    Number.isFinite(q.y)
  );
}

/** True for exactly 21 points with finite x and y. */
export function isValidLandmarks21(
  points: unknown,
): points is readonly Point2[] {
  return (
    Array.isArray(points) &&
    points.length === LANDMARK_COUNT &&
    points.every(isFinitePoint)
  );
}

function dist(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Placement metrics of one hand. `pointsMm` are the 21 parallax-corrected
 * landmarks in sheet mm (MediaPipe order); `paperSize` picks the sheet's
 * width and height from the contract's `PAPER_SIZES_MM`.
 */
export function computeHandPlacement(
  pointsMm: readonly Point2[] | null | undefined,
  paperSize: PaperSize,
): HandPlacement {
  if (!isValidLandmarks21(pointsMm)) return EMPTY_HAND_PLACEMENT;
  const sheet = (
    PAPER_SIZES_MM as Record<
      string,
      { width: number; height: number } | undefined
    >
  )[paperSize];
  if (!sheet) return EMPTY_HAND_PLACEMENT;
  const W = sheet.width;
  const H = sheet.height;
  const p = pointsMm;
  const wrist = p[0];

  // Wrist edge: whichever short edge the wrist is nearer to.
  const nearBottom = wrist.y >= H / 2;
  const wristEdge: WristEdge = nearBottom ? "near-bottom" : "near-top";
  const wristToEdgeMm = nearBottom ? H - wrist.y : wrist.y;

  // Hand axis against the direction away from the wrist edge: (0,−1) for the
  // bottom edge, (0,+1) for the top edge. Signed angle a→v is
  // atan2(a × v, a · v); with y down, a positive cross product is clockwise on
  // screen.
  const vx = p[9].x - wrist.x;
  const vy = p[9].y - wrist.y;
  let handAxisDeg: number | null = null;
  if (Math.hypot(vx, vy) > MIN_LENGTH_MM) {
    const ay = nearBottom ? -1 : 1; // ax = 0
    const cross = -ay * vx; // ax*vy − ay*vx
    const dot = ay * vy; // ax*vx + ay*vy
    handAxisDeg = Math.atan2(cross, dot) * RAD_TO_DEG;
    if (handAxisDeg === -180) handAxisDeg = 180;
  }

  // Margins to left, right and the far short edge (positive inside).
  let minSideMarginMm = Infinity;
  for (const i of MARGIN_LANDMARKS) {
    const q = p[i];
    const far = nearBottom ? q.y : H - q.y;
    minSideMarginMm = Math.min(minSideMarginMm, q.x, W - q.x, far);
  }

  const tip = p[4];
  const thumbOutside = tip.x < 0 || tip.x > W || tip.y < 0 || tip.y > H;

  const hand = dist(p[0], p[12]);
  const palmOverHand = hand > MIN_LENGTH_MM ? dist(p[0], p[9]) / hand : null;

  const ratios: number[] = [];
  for (let f = 0; f < 4; f++) {
    const mcp = 5 + 4 * f;
    const proximal = dist(p[mcp], p[mcp + 1]);
    if (!(proximal > MIN_LENGTH_MM)) break;
    ratios.push(dist(p[mcp + 2], p[mcp + 3]) / proximal);
  }
  const distalOverProximal =
    ratios.length === 4
      ? ([ratios[0], ratios[1], ratios[2], ratios[3]] as const)
      : null;

  return {
    wristToEdgeMm,
    wristEdge,
    handAxisDeg,
    minSideMarginMm,
    thumbOutside,
    palmOverHand,
    distalOverProximal,
  };
}

export interface PlacementCorrectionOptions {
  /**
   * Hand length the landmark heights are scaled to (`landmarkHeightsMm`).
   * Defaults to the 190 mm reference; the design (§1.2) estimates the
   * difference against the measured length at < 0.1 mm (推估, not measured).
   */
  readonly handLengthMm?: number;
}

/**
 * Image px → parallax-corrected sheet mm for the placement metrics: a thin,
 * never-throwing wrapper around `parallax.ts`'s `correctLandmarks` (one pass,
 * heights from `landmarkHeightsMm`). Returns `null` for anything that is not
 * 21 finite points, a non-positive focal length, or a homography/pose that
 * `correctLandmarks` rejects. The photo pipeline already has corrected points
 * (`correctLandmarksByHandLength`) and should pass those straight to
 * `computeHandPlacement` instead; this is for the live loop.
 */
export function placementPointsMm(
  landmarksPx: readonly Point2[] | null | undefined,
  homographyPxToMm: Homography,
  intrinsics: Intrinsics,
  options: PlacementCorrectionOptions = {},
): Point2[] | null {
  if (!isValidLandmarks21(landmarksPx)) return null;
  const L = options.handLengthMm ?? REFERENCE_HAND_LENGTH_MM;
  if (!(Number.isFinite(L) && L > 0)) return null;
  if (
    !(Number.isFinite(intrinsics.fPx) && intrinsics.fPx > 0) ||
    !Number.isFinite(intrinsics.cx) ||
    !Number.isFinite(intrinsics.cy)
  ) {
    return null;
  }
  try {
    const out = correctLandmarks(
      landmarksPx,
      homographyPxToMm,
      intrinsics,
      landmarkHeightsMm(L),
    );
    return isValidLandmarks21(out) ? out : null;
  } catch {
    return null;
  }
}

/** Intrinsics with the principal point at the frame centre (a convenience for the live loop). */
export function centredIntrinsics(
  fPx: number,
  widthPx: number,
  heightPx: number,
): Intrinsics {
  return { fPx, ...centrePrincipalPoint(widthPx, heightPx) };
}
