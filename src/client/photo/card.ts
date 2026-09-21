/**
 * Bank card 4-corner detection — the independent scale cross-check's other
 * half (see `src/client/geometry/card-scale.ts` for what the corners are
 * used for once found).
 *
 * Automatic path: reuses `js-aruco2`'s own `CV` helper (grayscale →
 * adaptive threshold → contour tracing → polygon approximation), the exact
 * pipeline `AR.Detector` runs to find marker *candidates* before it tries
 * to decode them as markers — a card is just a quadrilateral candidate we
 * score by how closely its aspect ratio matches ISO/IEC 7810 ID-1
 * (85.6 × 53.98 mm) instead of decoding a marker bit pattern out of it.
 * "A robust approach is fine" (issue #10) — this is heuristic, not exact,
 * which is why issue #10 also requires (and `src/app/scan/` provides) a
 * manual 4-corner drag fallback regardless of whether this finds anything.
 *
 * Like `markers.ts`, the untyped CJS `CV` surface is typed locally to this
 * adapter rather than widening a shared ambient declaration.
 */
import cvModule from "js-aruco2/src/cv.js";
import { ID1_CARD_MM } from "../../lib/contracts/measurement";
import type { Point2 } from "../geometry/homography";
import type { CardCorners } from "../geometry/card-scale";

interface CvImageLike {
  width: number;
  height: number;
  data: Uint8ClampedArray | number[];
}

interface CvImageConstructor {
  new (width?: number, height?: number, data?: Uint8ClampedArray): CvImageLike;
}

interface CvRuntime {
  readonly Image: CvImageConstructor;
  grayscale(src: CvImageLike, dst: CvImageLike): CvImageLike;
  adaptiveThreshold(
    src: CvImageLike,
    dst: CvImageLike,
    kernelSize: number,
    threshold: number,
  ): CvImageLike;
  findContours(src: CvImageLike, binary: number[]): Point2[][];
  approxPolyDP(contour: readonly Point2[], epsilon: number): Point2[];
  isContourConvex(contour: readonly Point2[]): boolean;
  minEdgeLength(poly: readonly Point2[]): number;
}

const CV = (cvModule as unknown as { CV: CvRuntime }).CV;

const CANDIDATE_MIN_CONTOUR_FRACTION = 0.01; // of image width, same as AR.Detector
const CANDIDATE_APPROX_EPSILON_FRACTION = 0.05;
const CANDIDATE_MIN_EDGE_PX = 10;

/**
 * Find every convex quadrilateral in the photo that could plausibly be a
 * card or marker. Impure (walks pixel data via js-aruco2's `CV`) —
 * `selectBestCardCandidate` below is the pure, unit-testable half.
 */
export function findQuadCandidates(imageData: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): Point2[][] {
  const src = new CV.Image(imageData.width, imageData.height, imageData.data);
  const grey = new CV.Image();
  const thres = new CV.Image();
  CV.grayscale(src, grey);
  CV.adaptiveThreshold(grey, thres, 2, 7);

  const binary: number[] = [];
  const contours = CV.findContours(thres, binary);

  const candidates: Point2[][] = [];
  const minSize = imageData.width * CANDIDATE_MIN_CONTOUR_FRACTION;
  for (const contour of contours) {
    if (contour.length < minSize) continue;
    const poly = CV.approxPolyDP(
      contour,
      contour.length * CANDIDATE_APPROX_EPSILON_FRACTION,
    );
    if (
      poly.length === 4 &&
      CV.isContourConvex(poly) &&
      CV.minEdgeLength(poly) >= CANDIDATE_MIN_EDGE_PX
    ) {
      candidates.push(poly);
    }
  }
  return candidates;
}

const ID1_RATIO =
  Math.max(ID1_CARD_MM.width, ID1_CARD_MM.height) /
  Math.min(ID1_CARD_MM.width, ID1_CARD_MM.height);

/**
 * How far a quad's aspect ratio is from ID-1's, or `null` if it's too
 * degenerate to score (near-zero edge). Pure.
 */
export function scoreQuadAsCard(quad: readonly Point2[]): number | null {
  if (quad.length !== 4) return null;
  const edgeLengths = [0, 1, 2, 3].map((i) => {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    return Math.hypot(a.x - b.x, a.y - b.y);
  });
  if (edgeLengths.some((len) => len < 1e-6)) return null;

  const sorted = [...edgeLengths].sort((a, b) => a - b);
  const shortAvg = (sorted[0] + sorted[1]) / 2;
  const longAvg = (sorted[2] + sorted[3]) / 2;
  if (shortAvg < 1e-6) return null;

  const ratio = longAvg / shortAvg;
  return Math.abs(ratio - ID1_RATIO);
}

/** Aspect-ratio deviation tolerance for accepting a quad as "the card". */
export const CARD_SCORE_TOLERANCE = 0.15;

/**
 * Pick the best card-shaped candidate, or `null` if none is close enough
 * to ID-1's aspect ratio to trust automatically. Pure — every input is a
 * plain array of 4-point polygons, so this is unit-testable with synthetic
 * quads (a real card's four corners, a square, a sliver) without any image
 * data.
 */
export function selectBestCardCandidate(
  candidates: readonly (readonly Point2[])[],
  tolerance: number = CARD_SCORE_TOLERANCE,
): CardCorners | null {
  let best: { quad: readonly Point2[]; score: number } | null = null;
  for (const quad of candidates) {
    const score = scoreQuadAsCard(quad);
    if (score === null || score > tolerance) continue;
    if (best === null || score < best.score) {
      best = { quad, score };
    }
  }
  if (best === null) return null;
  return best.quad as unknown as CardCorners;
}

/** Convenience: run detection + selection over a decoded photo in one call. */
export function detectCardCorners(imageData: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): CardCorners | null {
  const candidates = findQuadCandidates(imageData);
  return selectBestCardCandidate(candidates);
}
