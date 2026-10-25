/**
 * V3.2 F17 (candidate, 未拍板; Kirby's preview 7: "The auto detector still
 * needs to refine, it went to my window"): which bright region is the sheet
 * when there is more than one. The detector's own rule is the largest bright
 * region (`detect.ts`); a window, a lamp-lit wall or a white desk can be
 * larger than the sheet. The hand lies ON the sheet, so when the hand's
 * landmarks are known the region whose outline holds the palm is the sheet.
 *
 * The palm is MediaPipe's wrist (0) and the four knuckles (5, 9, 13, 17). A
 * region holds it when at least `PALM_CHOICE.minPointsInside` of the five
 * lie inside the region's rough quad (the convex outline the detector's
 * failure guess uses, F10): four, so a wrist resting on the sheet's edge, or
 * just off it, does not lose the sheet.
 *
 * With no landmarks the detector does not call this, so nothing it finds
 * changes. Pure; never throws.
 */
import type { Point2 } from "../geometry/homography";

/** The palm's MediaPipe landmarks: the wrist and the four knuckles. */
export const PALM_LANDMARK_INDICES = [0, 5, 9, 13, 17] as const;

/** The named limits of the choice (candidate). */
export const PALM_CHOICE = {
  /** Of the five palm points, at least this many inside a region's quad. */
  minPointsInside: 4,
} as const;

/** The five palm points of a 21-landmark hand, or `null` when it has not got them all as finite numbers. */
export function palmPointsOf(
  landmarks: readonly Point2[] | null | undefined,
): Point2[] | null {
  if (!landmarks || landmarks.length < 21) return null;
  const points = PALM_LANDMARK_INDICES.map((i) => landmarks[i]);
  if (!points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)))
    return null;
  return points.map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Whether `p` is inside the convex quadrilateral `quad` (either winding; on
 * an edge counts as inside). A quad that is not convex or not finite holds
 * nothing.
 */
export function pointInConvexQuad(
  p: Point2,
  quad: readonly [Point2, Point2, Point2, Point2],
): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (!Number.isFinite(cross)) return false;
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** How many of `points` are inside `quad` (0 for no quad). */
export function pointsInside(
  quad: readonly [Point2, Point2, Point2, Point2] | null,
  points: readonly Point2[],
): number {
  if (!quad) return 0;
  return points.filter((p) => pointInConvexQuad(p, quad)).length;
}

/** One bright region the detector could take for the sheet. */
export interface PaperCandidate {
  /** The detector's label for it. */
  readonly label: number;
  /** Its size in pixels. */
  readonly area: number;
  /** Its rough quad (convex outline), or `null` where none could be made. */
  readonly quad: readonly [Point2, Point2, Point2, Point2] | null;
}

/**
 * Why a region was taken (the local attempt log says it):
 * - `only_candidate`: there was one sizeable region, so nothing to choose;
 * - `largest_holds_palm`: the largest region holds the palm (as before);
 * - `palm`: a smaller region holds the palm and the largest does not (the
 *   window case): the smaller one is taken;
 * - `no_candidate_holds_palm`: no region holds it; the largest, as before.
 */
export type PaperChoiceReason =
  "only_candidate" | "largest_holds_palm" | "palm" | "no_candidate_holds_palm";

export interface PaperChoice {
  readonly label: number;
  readonly reason: PaperChoiceReason;
  /** How many sizeable regions there were. */
  readonly candidates: number;
  /** Palm points inside the region taken, and inside the largest one. */
  readonly palmInside: number;
  readonly largestPalmInside: number;
}

/**
 * The region to take for the sheet: the largest, unless it does not hold the
 * palm and another region does, in which case the largest of those that do.
 * `null` for no candidates. Ties in area go to the lower label, as the
 * detector's own largest-region loop does. Pure.
 */
export function choosePaperCandidate(
  candidates: readonly PaperCandidate[],
  palm: readonly Point2[],
  limits: { readonly minPointsInside: number } = PALM_CHOICE,
): PaperChoice | null {
  if (candidates.length === 0) return null;
  const byArea = [...candidates].sort(
    (a, b) => b.area - a.area || a.label - b.label,
  );
  const largest = byArea[0];
  const largestPalmInside = pointsInside(largest.quad, palm);
  const base = { candidates: candidates.length, largestPalmInside };
  if (candidates.length === 1)
    return {
      ...base,
      label: largest.label,
      reason: "only_candidate",
      palmInside: largestPalmInside,
    };
  if (largestPalmInside >= limits.minPointsInside)
    return {
      ...base,
      label: largest.label,
      reason: "largest_holds_palm",
      palmInside: largestPalmInside,
    };
  for (const c of byArea.slice(1)) {
    const inside = pointsInside(c.quad, palm);
    if (inside >= limits.minPointsInside)
      return { ...base, label: c.label, reason: "palm", palmInside: inside };
  }
  return {
    ...base,
    label: largest.label,
    reason: "no_candidate_holds_palm",
    palmInside: largestPalmInside,
  };
}
