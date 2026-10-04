/**
 * Which part of the photo to outline in amber on the retake screen
 * (docs/design/scan-v2-2026-09-30/README.md, "Retake": "the problem area
 * outlined in amber"). Only an area the pipeline really located is outlined:
 * the bounding box of the hand's landmarks for a hand problem, of the paper's
 * corners for a paper problem. Where nothing was located ("we couldn't find a
 * hand", a blurry photo, a failed download) nothing is outlined; a box drawn
 * on a guess would point at the wrong spot.
 */
import { boundingRect, padRect } from "./photoLayout";
import type { Point, Rect } from "./quad";

const HAND_PROBLEMS: ReadonlySet<string> = new Set([
  "FINGER_NOT_STRAIGHT",
  "LOW_LANDMARK_CONFIDENCE",
  "HAND_TILTED",
  "HAND_OUT_OF_BOUNDS",
  "HANDEDNESS_MISMATCH",
  "MEASUREMENT_OUT_OF_RANGE",
]);

const PAPER_PROBLEMS: ReadonlySet<string> = new Set([
  "PAPER_EDGE_HIDDEN",
  "PAPER_CURLED",
  "PAPER_CORNER_HIDDEN",
  "REPROJECTION_ERROR",
  "CARD_SCALE_MISMATCH",
]);

export interface LocatedOverlay {
  readonly landmarksPx: readonly Point[] | null;
  readonly paperCorners?: readonly Point[] | null;
}

/** The problem's area in the overlay's own pixels, or `null` when it was not located. */
export function problemAreaFor(
  code: string | undefined,
  overlay: LocatedOverlay | null,
  paddingPx: number,
): Rect | null {
  if (!code || !overlay) return null;
  let points: readonly Point[] | null | undefined = null;
  if (HAND_PROBLEMS.has(code)) points = overlay.landmarksPx;
  else if (PAPER_PROBLEMS.has(code)) points = overlay.paperCorners;
  if (!points || points.length === 0) return null;
  const box = boundingRect(points);
  return box ? padRect(box, paddingPx) : null;
}
