/**
 * Pure geometry helpers for `detect.ts`'s paper-edge quad detection:
 * convex hull, hull-to-quad simplification, corner ordering, robust
 * (RANSAC + total-least-squares) line fitting, line intersection and a
 * side-coverage metric. No image data, no DOM — every function here takes
 * and returns plain points/numbers, so each is unit-testable on synthetic
 * point sets without a single pixel.
 *
 * `detectPaperQuad` (detect.ts) is the only caller; this module doesn't
 * know it's being used for paper.
 */
import type { Point2 } from "../geometry/homography";

// ── Small linear algebra / geometry primitives ──────────────────────────

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function cross(o: Point2, a: Point2, b: Point2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Convex hull via Andrew's monotone chain, O(n log n). Returns hull
 * vertices in counter-clockwise order (image px convention: x right,
 * y down — "counter-clockwise" here means by the standard cross-product
 * sign, which reads as clockwise when the y axis is flipped for display;
 * the winding direction doesn't matter to any caller in this module).
 * Duplicate points collapse; fewer than 3 distinct points returns them
 * as-is (no hull to compute).
 */
export function convexHull(points: readonly Point2[]): Point2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const unique: Point2[] = [];
  for (const p of pts) {
    const last = unique[unique.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) unique.push(p);
  }
  if (unique.length < 3) return unique;

  const lower: Point2[] = [];
  for (const p of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point2[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Reduce a convex polygon to exactly 4 vertices via Visvalingam–Whyatt:
 * repeatedly drop the vertex whose triangle with its two neighbours has
 * the smallest area, which removes the least geometrically significant
 * vertex first. Robust to the small extra hull vertices pixel noise adds
 * along an otherwise straight side. Returns `null` if `hull` has fewer
 * than 4 vertices (no quad to extract).
 */
export function simplifyToQuad(
  hull: readonly Point2[],
): [Point2, Point2, Point2, Point2] | null {
  if (hull.length < 4) return null;
  const ring = [...hull];
  while (ring.length > 4) {
    let minArea = Infinity;
    let minIdx = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i - 1 + ring.length) % ring.length];
      const b = ring[i];
      const c = ring[(i + 1) % ring.length];
      const area = Math.abs(cross(a, b, c)) / 2;
      if (area < minArea) {
        minArea = area;
        minIdx = i;
      }
    }
    ring.splice(minIdx, 1);
  }
  return [ring[0], ring[1], ring[2], ring[3]];
}

/**
 * Order 4 corners of a roughly-upright convex quad as TL, TR, BR, BL
 * (image px: x right, y down). Standard "sum/difference" heuristic: the
 * top-left corner minimises x+y, the bottom-right maximises it; the
 * top-right minimises y−x, the bottom-left maximises it. Correct for any
 * quad that isn't rotated more than ~45° from upright in-frame, which
 * covers a handheld top-down photo (the reprojection-style tilt gate
 * downstream constrains the shot further, but this function itself does
 * not depend on that).
 * (Superseded 2026-09-25 PR #59 review B2: the old min/max-of-sum/diff
 * heuristic below duplicated corners near a 45° rotation, since at 45° the
 * quad's diagonals align with the sum/diff axes — degenerate. This version
 * sorts by angle around the centroid, which is always a valid cyclic
 * traversal of a convex polygon's boundary regardless of rotation, then
 * picks whichever of the 4 (already correctly ordered) points is nearest
 * the image's top-left as the start — robust at every rotation, including
 * exactly 45°.)
 */
export function orderQuadCorners(
  quad: readonly [Point2, Point2, Point2, Point2],
): [Point2, Point2, Point2, Point2] {
  let cx = 0;
  let cy = 0;
  for (const p of quad) {
    cx += p.x;
    cy += p.y;
  }
  cx /= 4;
  cy /= 4;

  const withAngle = quad.map((p) => ({
    p,
    // Normalized to [0, 2π) so no pair straddles the atan2 wrap point.
    angle: (Math.atan2(p.y - cy, p.x - cx) + 2 * Math.PI) % (2 * Math.PI),
  }));
  withAngle.sort((a, b) => a.angle - b.angle);

  let startIdx = 0;
  let startScore = Infinity;
  for (let i = 0; i < 4; i++) {
    const score = withAngle[i].p.x + withAngle[i].p.y; // nearest image top-left
    if (score < startScore) {
      startScore = score;
      startIdx = i;
    }
  }

  return [0, 1, 2, 3].map((i) => withAngle[(startIdx + i) % 4].p) as [
    Point2,
    Point2,
    Point2,
    Point2,
  ];
}

/** A line in normal form: `nx·x + ny·y = c`, with (nx, ny) a unit vector. */
export interface NormalLine {
  readonly nx: number;
  readonly ny: number;
  readonly c: number;
}

export function lineFromTwoPoints(a: Point2, b: Point2): NormalLine | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const nx = -dy / len;
  const ny = dx / len;
  return { nx, ny, c: nx * a.x + ny * a.y };
}

export function signedDistance(line: NormalLine, p: Point2): number {
  return line.nx * p.x + line.ny * p.y - line.c;
}

/** Intersection of two non-parallel lines, or `null` if (near-)parallel. */
export function intersectLines(a: NormalLine, b: NormalLine): Point2 | null {
  const det = a.nx * b.ny - b.nx * a.ny;
  if (Math.abs(det) < 1e-9) return null;
  return {
    x: (a.c * b.ny - b.c * a.ny) / det,
    y: (a.nx * b.c - b.nx * a.c) / det,
  };
}

/**
 * Total-least-squares (orthogonal regression) line through `points`:
 * minimises perpendicular distance rather than vertical residual, so it
 * is unbiased for lines at any orientation. Closed-form via the 2×2
 * covariance matrix's dominant eigenvector. Throws for fewer than 2
 * points or points that are all coincident.
 */
export function totalLeastSquaresLine(points: readonly Point2[]): NormalLine {
  if (points.length < 2) {
    throw new RangeError("totalLeastSquaresLine needs at least 2 points.");
  }
  const n = points.length;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  // Eigen-decompose [[sxx, sxy], [sxy, syy]]; direction = eigenvector of
  // the LARGER eigenvalue (the line's own direction of maximum spread).
  const trace = sxx + syy;
  const diff = sxx - syy;
  const disc = Math.sqrt(diff * diff + 4 * sxy * sxy);
  const lambdaMax = (trace + disc) / 2;

  let dirX: number;
  let dirY: number;
  if (Math.abs(sxy) > 1e-12) {
    dirX = sxy;
    dirY = lambdaMax - sxx;
  } else if (sxx >= syy) {
    dirX = 1;
    dirY = 0;
  } else {
    dirX = 0;
    dirY = 1;
  }
  const dirLen = Math.hypot(dirX, dirY);
  if (dirLen < 1e-12) {
    // Degenerate (all points coincide) — fall back to an arbitrary
    // horizontal line through the centroid rather than throwing, since
    // callers treat "no usable line" via inlier-count checks upstream.
    return { nx: 0, ny: 1, c: my };
  }
  dirX /= dirLen;
  dirY /= dirLen;
  const nx = -dirY;
  const ny = dirX;
  return { nx, ny, c: nx * mx + ny * my };
}

// ── Deterministic PRNG ───────────────────────────────────────────────────

/**
 * mulberry32 — a tiny, fast, deterministic PRNG. `detectPaperQuad` must be
 * deterministic (same `ImageData` in, same result out), so its RANSAC step
 * seeds this with a fixed constant rather than `Math.random()`.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const RANSAC_SEED = 0xc0ffee;

// ── RANSAC line fit ──────────────────────────────────────────────────────

export interface SideFit {
  readonly line: NormalLine;
  readonly inliers: readonly Point2[];
  readonly meanResidualPx: number;
}

export interface RansacLineOptions {
  readonly iterations?: number;
  readonly inlierThresholdPx?: number;
  readonly minPoints?: number;
  readonly rng?: () => number;
}

const DEFAULT_RANSAC_ITERATIONS = 80;
const DEFAULT_INLIER_THRESHOLD_PX = 2;
const DEFAULT_MIN_POINTS = 5;

/**
 * Robustly fit a line to `points`, which may contain gross outliers (e.g.
 * a hand crossing the paper's edge): sample random point pairs, keep the
 * pair whose line has the most points within `inlierThresholdPx`, then
 * refine with a total-least-squares fit over just those inliers. Returns
 * `null` if fewer than `minPoints` points are available or the best
 * candidate still has too few inliers.
 */
export function fitLineRansac(
  points: readonly Point2[],
  options: RansacLineOptions = {},
): SideFit | null {
  const iterations = options.iterations ?? DEFAULT_RANSAC_ITERATIONS;
  const inlierThresholdPx =
    options.inlierThresholdPx ?? DEFAULT_INLIER_THRESHOLD_PX;
  const minPoints = options.minPoints ?? DEFAULT_MIN_POINTS;
  const rng = options.rng ?? mulberry32(RANSAC_SEED);

  if (points.length < minPoints) return null;

  let best: NormalLine | null = null;
  let bestCount = -1;
  for (let it = 0; it < iterations; it++) {
    const i = Math.floor(rng() * points.length) % points.length;
    let j = Math.floor(rng() * points.length) % points.length;
    if (j === i) j = (j + 1) % points.length;
    const line = lineFromTwoPoints(points[i], points[j]);
    if (!line) continue;
    let count = 0;
    for (const p of points) {
      if (Math.abs(signedDistance(line, p)) <= inlierThresholdPx) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = line;
    }
  }
  if (!best) return null;

  const inliers = points.filter(
    (p) => Math.abs(signedDistance(best as NormalLine, p)) <= inlierThresholdPx,
  );
  if (inliers.length < minPoints) return null;

  const refined = totalLeastSquaresLine(inliers);
  const finalInliers = points.filter(
    (p) => Math.abs(signedDistance(refined, p)) <= inlierThresholdPx,
  );
  if (finalInliers.length < minPoints) return null;
  const refinedAgain = totalLeastSquaresLine(finalInliers);

  let residualSum = 0;
  for (const p of finalInliers) {
    residualSum += Math.abs(signedDistance(refinedAgain, p));
  }
  return {
    line: refinedAgain,
    inliers: finalInliers,
    meanResidualPx: residualSum / finalInliers.length,
  };
}

export interface ReportingStats {
  readonly points: readonly Point2[];
  readonly meanResidualPx: number;
}

/**
 * Re-measure `bucketPoints` (a side's FULL candidate set, before RANSAC
 * dropped anything) against an already-fitted `line`, keeping only points
 * within `thresholdPx` — deliberately more generous than the RANSAC
 * threshold that found the line's position/orientation. That fit has to
 * stay tight to reliably ignore a hand/wrist occluder's boundary (which
 * usually misses the true line by tens of px); a real curled/lifted sheet
 * bows the WHOLE side by a much smaller, continuous amount, and reporting
 * only the fit's own inliers would cap the visible residual at the fit's
 * own threshold — never large enough to cross `PAPER_EDGE_LIMITS`
 * regardless of how curled the paper really is. This second, looser pass
 * is what lets a moderate, side-wide bow show up as elevated residual
 * instead of being silently absorbed.
 */
export function computeReportingStats(
  bucketPoints: readonly Point2[],
  line: NormalLine,
  thresholdPx: number,
): ReportingStats {
  const points = bucketPoints.filter(
    (p) => Math.abs(signedDistance(line, p)) <= thresholdPx,
  );
  if (points.length === 0) return { points, meanResidualPx: 0 };
  let sum = 0;
  for (const p of points) sum += Math.abs(signedDistance(line, p));
  return { points, meanResidualPx: sum / points.length };
}

/**
 * Fraction of the segment `[segStart, segEnd]` actually covered by
 * `points`: the segment is divided into `bins` equal-length buckets and a
 * bucket counts as covered if any point's projection lands inside it.
 * Using a span (max − min projection) instead would read as full coverage
 * even with a gap hidden in the middle (e.g. a wrist crossing the edge),
 * which is exactly the case this metric has to catch.
 */
export function computeSideCoverage(
  points: readonly Point2[],
  segStart: Point2,
  segEnd: Point2,
  bins = 40,
): number {
  const dx = segEnd.x - segStart.x;
  const dy = segEnd.y - segStart.y;
  const segLenSq = dx * dx + dy * dy;
  if (segLenSq < 1e-9) return 0;
  const covered = new Uint8Array(bins);
  for (const p of points) {
    const t = ((p.x - segStart.x) * dx + (p.y - segStart.y) * dy) / segLenSq;
    if (t < 0 || t > 1) continue;
    const bin = clamp(Math.floor(t * bins), 0, bins - 1);
    covered[bin] = 1;
  }
  let count = 0;
  for (let i = 0; i < bins; i++) count += covered[i];
  return count / bins;
}

/** Signed polygon area via the shoelace formula (always ≥ 0 here since callers only need magnitude). */
export function polygonArea(points: readonly Point2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** `true` if the 4 points (in order) form a convex polygon. */
export function isConvexQuad(
  quad: readonly [Point2, Point2, Point2, Point2],
): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cr = cross(a, b, c);
    if (Math.abs(cr) < 1e-9) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}
