/**
 * Rectified-aspect orientation/sanity check (2026-09-25 PR #59 review,
 * blockers B1 and B3).
 *
 * B1: `orderQuadCorners` labels corners by IMAGE geometry (angle around the
 * centroid, nearest-top-left start) — it has no idea whether the paper is
 * portrait, landscape, or rotated 46°, so its "TL→TR" side is not
 * necessarily the paper's physical WIDTH. `buildPaperHomography`
 * previously always mapped TL→TR to the short (210mm) side regardless —
 * correct only for an upright portrait photo, ~41% wrong (and passing
 * every gate) once the paper is landscape or rotated past 45°.
 *
 * B3: a merged/distorted bright region (a shadow band that halves the
 * sheet, a second white object touching the paper) can still produce a
 * *convex* quadrilateral that clears the old, generous 0.35–2.8× aspect
 * slack — that slack was checking raw pixel side-length ratios, which
 * don't account for perspective and don't reject a non-rectangular
 * (non-parallelogram) quad at all.
 *
 * Both are fixed by the same underlying computation: a rectangle's two
 * edge directions are ORTHOGONAL in 3D, and a homography built assuming
 * the WRONG width/height for the correspondence targets violates that
 * orthogonality (and the equal-column-norm constraint that a rotation
 * matrix's first two columns also satisfy) by an amount that reveals
 * exactly how wrong the assumption was — this is the same math
 * `focal-from-homography.ts` already uses to recover an unknown focal
 * length from a homography of KNOWN aspect ratio, just run the other way:
 * here the aspect ratio is what's unknown (one of exactly two candidates,
 * modulo the focal length being known/assumed).
 *
 * Given a (real EXIF, or assumed-FOV) focal length: build the homography
 * TWICE, once assuming the paper's short side runs along TL→TR and once
 * assuming its long side does; score each by how close its two
 * (orthogonality, equal-norm) residuals are to zero; the smaller residual
 * wins the orientation call, and it ALSO gives a quantitative rectified
 * aspect estimate to gate on (±tolerance) — a non-rectangular merged blob
 * fails to look like a good rectangle in EITHER orientation and is
 * rejected outright.
 */
import { homographyToWorldFrame } from "../geometry/camera-pose";
import {
  estimateHomography,
  type Homography,
  type Point2,
  type PointCorrespondence,
} from "../geometry/homography";

/** Assumed horizontal field of view when no EXIF focal length is available — a generic phone's main (1×) camera. */
export const ASSUMED_FOV_DEG = 70;

/** `focalPx` for a frame of `widthPx`, from an assumed horizontal FOV. Pure trig — `f = (w/2) / tan(FOV/2)`. */
export function assumedFocalPxFromFov(
  widthPx: number,
  fovDeg: number = ASSUMED_FOV_DEG,
): number {
  const halfFovRad = (fovDeg * Math.PI) / 360;
  return widthPx / 2 / Math.tan(halfFovRad);
}

function buildHypothesisHomography(
  corners: readonly [Point2, Point2, Point2, Point2],
  widthMm: number,
  heightMm: number,
): Homography | null {
  const dst: readonly Point2[] = [
    { x: 0, y: 0 },
    { x: widthMm, y: 0 },
    { x: widthMm, y: heightMm },
    { x: 0, y: heightMm },
  ];
  const correspondences: PointCorrespondence[] = corners.map((src, i) => ({
    src,
    dst: dst[i],
  }));
  try {
    return estimateHomography(correspondences);
  } catch {
    return null; // degenerate correspondences (e.g. near-collinear corners) — not our problem to throw over.
  }
}

interface ResidualResult {
  /** 0 for a perfect rectangle at this focal length; grows with how far it isn't. */
  readonly residual: number;
  /** Multiply the hypothesis's own assumed (width/height) by this to get the rectified estimate. */
  readonly aspectMultiplier: number;
}

/**
 * How far a homography (built under some assumed width/height) is from
 * having come from a genuine 3D rectangle, at the given focal length:
 * combines the orthogonality-of-edge-directions residual (cosine of the
 * angle between them, 0 when perpendicular) and the equal-column-norm
 * residual (0 when the two edge directions have equal "unit" scale, as a
 * rotation matrix's columns must) into one dimensionless score.
 */
function rectangleResidual(
  homography: Homography,
  principalPoint: Point2,
  focalPx: number,
): ResidualResult | null {
  const w = homographyToWorldFrame(homography);
  const { x: cx, y: cy } = principalPoint;
  const h31 = w[2][0];
  const h32 = w[2][1];
  const a1 = w[0][0] - cx * h31;
  const b1 = w[1][0] - cy * h31;
  const a2 = w[0][1] - cx * h32;
  const b2 = w[1][1] - cy * h32;

  const r1norm = Math.hypot(a1, b1, focalPx * h31);
  const r2norm = Math.hypot(a2, b2, focalPx * h32);
  if (!(r1norm > 1e-9) || !(r2norm > 1e-9)) return null;

  const dot = a1 * a2 + b1 * b2 + focalPx * focalPx * h31 * h32;
  const cosAngle = dot / (r1norm * r2norm); // 0 when r1 ⟂ r2
  const relNormDiff = (r1norm - r2norm) / ((r1norm + r2norm) / 2); // 0 when |r1| = |r2|

  return {
    residual: Math.hypot(cosAngle, relNormDiff),
    aspectMultiplier: r1norm / r2norm,
  };
}

export interface OrientationResult {
  /** `true`: the quad's TL→TR side (as given) is the paper's LONG side — caller must cyclically rotate the corners by 1 before use. */
  readonly rotateBy1: boolean;
  /** The winning hypothesis's residual — 0 is a perfect rectangle, larger is worse. Callers reject above some threshold. */
  readonly residual: number;
  /** Rectified width/height estimate for the winning orientation (width along the corrected TL→TR side). */
  readonly rectifiedAspect: number;
}

/**
 * Resolve which of the quad's two axes is the paper's width, and how
 * rectangle-like the quad is at all, at the given (real or assumed) focal
 * length. Returns `null` only when neither hypothesis's homography could
 * even be built (degenerate corners) — every other case (including "this
 * doesn't look like a rectangle") is a normal, non-null result with a high
 * `residual` for the caller's own tolerance check.
 */
export function resolveOrientation(
  corners: readonly [Point2, Point2, Point2, Point2],
  shortMm: number,
  longMm: number,
  principalPoint: Point2,
  focalPx: number,
): OrientationResult | null {
  const hShort = buildHypothesisHomography(corners, shortMm, longMm);
  const hLong = buildHypothesisHomography(corners, longMm, shortMm);

  const rShort = hShort
    ? rectangleResidual(hShort, principalPoint, focalPx)
    : null;
  const rLong = hLong
    ? rectangleResidual(hLong, principalPoint, focalPx)
    : null;

  if (!rShort && !rLong) return null;

  const shortIsBetter = rShort && (!rLong || rShort.residual <= rLong.residual);
  const winner = shortIsBetter ? rShort! : rLong!;
  const rotateBy1 = !shortIsBetter;
  const assumedAspect = rotateBy1 ? longMm / shortMm : shortMm / longMm;

  return {
    rotateBy1,
    residual: winner.residual,
    rectifiedAspect: assumedAspect * winner.aspectMultiplier,
  };
}
