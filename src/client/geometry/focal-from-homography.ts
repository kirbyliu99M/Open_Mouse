/**
 * Single-view focal length estimate from the sheet homography, for photos
 * with no usable EXIF focal length. Assumes square pixels, zero skew and
 * the principal point at the image centre (issue #16's stated model) — the
 * same intrinsics model `camera-pose.ts` uses.
 *
 * Derivation (Zhang 2000 §3.1's calibration constraints, specialised to a
 * single view and a single unknown, f): for H_world, the WORLD-frame
 * sheet-mm → image-px homography (see camera-pose.ts's header for the
 * world-frame convention), M := K⁻¹·H_world = λ·[r1 r2 t] for the same
 * unknown scale λ that `recoverCameraPose` resolves. Because r1 and r2 are
 * two columns of a rotation matrix, they're orthonormal: r1·r2 = 0 and
 * |r1| = |r2|. Both constraints are invariant to λ (it cancels), so each
 * gives an equation purely in H_world's entries and the unknown f:
 *
 *   r1·r2 = 0        ⇒  f² = −(a1·a2 + b1·b2) / (h31·h32)
 *   |r1|² = |r2|²    ⇒  f² = [(a1²+b1²) − (a2²+b2²)] / (h32² − h31²)
 *
 * where column j of H_world is (h1j, h2j, h3j), aj = h1j − cx·h3j,
 * bj = h2j − cy·h3j (i.e. aj, bj, h3j are exactly the first two rows and
 * the third row of M, scaled by f — see K⁻¹'s structure). Both estimates
 * are averaged when they agree; when they don't (or either denominator is
 * small relative to the matrix), the view is near fronto-parallel — h31
 * and h32 are *exactly* zero for a perfectly fronto-parallel camera (its
 * rotation is the identity restricted to the sheet plane), so both
 * denominators vanish together and f is not observable from a single
 * planar view. That is the "ill-conditioned" case issue #16 asks to detect
 * explicitly rather than silently return a garbage f for.
 */
import { homographyToWorldFrame } from "./camera-pose";
import type { Homography } from "./homography";

export interface PrincipalPoint {
  readonly cx: number;
  readonly cy: number;
}

export interface FocalEstimate {
  readonly fPx: number;
  /**
   * False for a near-fronto-parallel (ill-conditioned) view: the estimate
   * is returned for diagnostics, but callers should not use it — see
   * `parallax.ts`'s focal policy ("no correction" when neither EXIF nor a
   * well-conditioned homography estimate is available).
   */
  readonly reliable: boolean;
}

/**
 * Below this, the perspective (bottom-row) terms h31, h32 are too small
 * relative to the matrix's own scale to trust — the ratio is dimensionless
 * and invariant to H_world's arbitrary overall scale (every term below
 * scales the same way under H_world → k·H_world, so the ratio doesn't).
 * Empirically calibrated against tests/unit/focal-from-homography.test.ts's
 * synthetic cameras (swept over fPx ∈ [3000, 4500] px and distance ∈
 * [300, 600] mm, this codebase's realistic top-down-shot range): this ratio
 * grows ~linearly with tilt angle and is essentially independent of camera
 * distance, reaching ≈4.5×10⁻⁵ at the issue's 15° reliability floor even in
 * the worst-case (highest-fPx) configuration tested, and ≈4×10⁻⁶ at 1°. This
 * threshold sits almost an order of magnitude below the 15° value and well
 * above the ~1° value, so it clears the stated floor with comfortable
 * margin while still catching a genuinely near-fronto-parallel shot (where
 * it is ~10⁻¹⁹, pure floating-point noise).
 */
const MIN_CONDITIONING_RATIO = 1e-5;

/** Maximum relative disagreement between the two f² estimates to still call the result reliable. */
const MAX_RELATIVE_DISAGREEMENT = 0.2;

/**
 * Estimate the focal length (pixels) from the image px → sheet mm
 * homography alone. Returns null when no candidate estimate is even
 * computable (both denominators exactly zero, or a resulting f² ≤ 0);
 * otherwise returns a best-effort `fPx` with `reliable` reporting whether
 * the near-fronto-parallel degeneracy was detected.
 */
export function estimateFocalFromHomography(
  imageToSheetMm: Homography,
  principalPoint: PrincipalPoint,
): FocalEstimate | null {
  const h = homographyToWorldFrame(imageToSheetMm);
  const { cx, cy } = principalPoint;

  const h31 = h[2][0];
  const h32 = h[2][1];
  const a1 = h[0][0] - cx * h31;
  const b1 = h[1][0] - cy * h31;
  const a2 = h[0][1] - cx * h32;
  const b2 = h[1][1] - cy * h32;

  const denomDot = h31 * h32;
  const denomDiff = h32 * h32 - h31 * h31;

  // Dimensionless scale of the matrix entries in play, for the relative
  // conditioning check below.
  const magnitude = Math.hypot(a1, b1, a2, b2, h31, h32);
  if (magnitude < 1e-15) {
    return null;
  }

  const f2FromDot =
    Math.abs(denomDot) / (magnitude * magnitude) > 1e-12
      ? -(a1 * a2 + b1 * b2) / denomDot
      : null;
  const f2FromDiff =
    Math.abs(denomDiff) / (magnitude * magnitude) > 1e-12
      ? (a1 * a1 + b1 * b1 - (a2 * a2 + b2 * b2)) / denomDiff
      : null;

  const candidates = [f2FromDot, f2FromDiff].filter(
    (f2): f2 is number => f2 !== null && Number.isFinite(f2) && f2 > 0,
  );
  if (candidates.length === 0) {
    return null;
  }

  const f2 = candidates.reduce((sum, v) => sum + v, 0) / candidates.length;
  const fPx = Math.sqrt(f2);

  // Conditioning: how far the perspective (bottom-row) terms are from the
  // fronto-parallel degeneracy (h31 = h32 = 0), relative to the matrix's
  // own scale.
  const conditioning = Math.hypot(h31, h32) / magnitude;

  const reliable =
    conditioning >= MIN_CONDITIONING_RATIO &&
    f2FromDot !== null &&
    f2FromDiff !== null &&
    Math.abs(f2FromDot - f2FromDiff) / f2 <= MAX_RELATIVE_DISAGREEMENT;

  return { fPx, reliable };
}
