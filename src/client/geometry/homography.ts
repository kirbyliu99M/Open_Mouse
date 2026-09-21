/**
 * Planar homography estimation — image pixels → sheet millimetres.
 *
 * Pure client-side math, no dependencies. Implements the normalized DLT
 * (Hartley normalization + a linear least-squares solve with h33 = 1) per
 * docs/PLAN.md §M2: "js-aruco2 finds markers → homography rectifies the
 * image to the sheet plane in mm." Callers build correspondences from all 16
 * marker corners (src/client/sheet/layout.ts is the source of truth for the
 * mm side); this module only does the linear algebra.
 */

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

export interface PointCorrespondence {
  /** Detected image-pixel position. */
  readonly src: Point2;
  /** Known sheet-mm position. */
  readonly dst: Point2;
}

/** Row-major 3×3 projective matrix. Bottom-right entry need not be 1. */
export type Homography = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

const MIN_CORRESPONDENCES = 4;
/** Below this, a Gauss–Jordan pivot is treated as numerically zero. */
const SINGULAR_PIVOT_EPSILON = 1e-9;

/**
 * Estimate a homography from N ≥ 4 point correspondences using the
 * normalized Direct Linear Transform: normalize both point sets (Hartley),
 * solve the 8-unknown linear system for h33 = 1 by least squares (normal
 * equations), then denormalize.
 *
 * Throws a RangeError for fewer than 4 correspondences or for degenerate
 * input (e.g. collinear points), which makes the underlying normal-equations
 * matrix singular.
 */
export function estimateHomography(
  correspondences: readonly PointCorrespondence[],
): Homography {
  if (correspondences.length < MIN_CORRESPONDENCES) {
    throw new RangeError(
      `estimateHomography needs at least ${MIN_CORRESPONDENCES} point correspondences, got ${correspondences.length}.`,
    );
  }

  const srcPoints = correspondences.map((c) => c.src);
  const dstPoints = correspondences.map((c) => c.dst);

  const { normalized: srcNorm, transform: tSrc } = normalizePoints(srcPoints);
  const { normalized: dstNorm, transform: tDst } = normalizePoints(dstPoints);

  const hNorm = solveNormalizedHomography(srcNorm, dstNorm);
  const tDstInv = invert3x3(tDst);

  // H = T_dst^-1 · H_norm · T_src
  return multiply3x3(multiply3x3(tDstInv, hNorm), tSrc);
}

/** Apply a homography to a single point, dividing through by w. */
export function applyHomography(h: Homography, p: Point2): Point2 {
  const w = h[2][0] * p.x + h[2][1] * p.y + h[2][2];
  if (Math.abs(w) < 1e-12) {
    throw new RangeError(
      "applyHomography: point maps to infinity (w ≈ 0) under this homography.",
    );
  }
  return {
    x: (h[0][0] * p.x + h[0][1] * p.y + h[0][2]) / w,
    y: (h[1][0] * p.x + h[1][1] * p.y + h[1][2]) / w,
  };
}

/**
 * Mean Euclidean distance, in mm, between each correspondence's source point
 * mapped through the homography and its known destination point.
 */
export function reprojectionErrorMm(
  h: Homography,
  correspondences: readonly PointCorrespondence[],
): number {
  if (correspondences.length === 0) {
    throw new RangeError(
      "reprojectionErrorMm needs at least one correspondence.",
    );
  }
  const total = correspondences.reduce((sum, { src, dst }) => {
    const mapped = applyHomography(h, src);
    return sum + Math.hypot(mapped.x - dst.x, mapped.y - dst.y);
  }, 0);
  return total / correspondences.length;
}

// ── Hartley normalization ────────────────────────────────────────────────

/**
 * Translate the centroid to the origin and scale so the mean distance from
 * the origin is √2 (Hartley 1997). Returns the normalized points and the
 * 3×3 similarity transform that produced them, so the caller can invert it.
 */
function normalizePoints(points: readonly Point2[]): {
  normalized: Point2[];
  transform: Homography;
} {
  const n = points.length;
  const cx = points.reduce((s, p) => s + p.x, 0) / n;
  const cy = points.reduce((s, p) => s + p.y, 0) / n;
  const meanDist =
    points.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / n;

  if (meanDist < 1e-9) {
    throw new RangeError(
      "estimateHomography: point correspondences are degenerate (all points coincide).",
    );
  }

  const scale = Math.SQRT2 / meanDist;
  const transform: Homography = [
    [scale, 0, -scale * cx],
    [0, scale, -scale * cy],
    [0, 0, 1],
  ];
  const normalized = points.map((p) => applyHomography(transform, p));
  return { normalized, transform };
}

/**
 * Solve for the 8 unknowns of a homography (row-major h11..h32, h33 = 1)
 * given normalized correspondences, via the normal equations of the
 * standard DLT linear system.
 */
function solveNormalizedHomography(
  src: readonly Point2[],
  dst: readonly Point2[],
): Homography {
  const rows: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < src.length; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    // h11*x + h12*y + h13*1                            - u*h31*x - u*h32*y = u
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    //                            h21*x + h22*y + h23*1 - v*h31*x - v*h32*y = v
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const ata = multiplyATA(rows);
  const atb = multiplyATb(rows, b);
  const h = solveLinearSystem(ata, atb);

  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

// ── Small dense linear algebra (no external dependency) ─────────────────

function multiplyATA(a: readonly number[][]): number[][] {
  const cols = a[0].length;
  const result: number[][] = Array.from({ length: cols }, () =>
    new Array<number>(cols).fill(0),
  );
  for (const row of a) {
    for (let i = 0; i < cols; i++) {
      if (row[i] === 0) continue;
      for (let j = 0; j < cols; j++) {
        result[i][j] += row[i] * row[j];
      }
    }
  }
  return result;
}

function multiplyATb(a: readonly number[][], b: readonly number[]): number[] {
  const cols = a[0].length;
  const result = new Array<number>(cols).fill(0);
  for (let r = 0; r < a.length; r++) {
    const row = a[r];
    const bi = b[r];
    for (let i = 0; i < cols; i++) {
      result[i] += row[i] * bi;
    }
  }
  return result;
}

/**
 * Solve A·x = b by Gauss–Jordan elimination with partial pivoting. Throws a
 * RangeError if A is numerically singular (e.g. built from collinear input
 * points).
 */
function solveLinearSystem(
  a: readonly number[][],
  b: readonly number[],
): number[] {
  const n = a.length;
  const m: number[][] = a.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotVal = Math.abs(m[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m[r][col]);
      if (v > pivotVal) {
        pivotVal = v;
        pivotRow = r;
      }
    }
    if (pivotVal < SINGULAR_PIVOT_EPSILON) {
      throw new RangeError(
        "estimateHomography: point correspondences are degenerate (e.g. collinear) — cannot estimate a homography.",
      );
    }
    if (pivotRow !== col) {
      [m[col], m[pivotRow]] = [m[pivotRow], m[col]];
    }
    const pivot = m[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r][col] / pivot;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        m[r][c] -= factor * m[col][c];
      }
    }
  }

  return m.map((row, i) => row[n] / row[i]);
}

/**
 * Multiply two row-major 3×3 matrices. Exported (beyond this module's own
 * DLT solve) so camera-pose.ts / focal-from-homography.ts can reuse the
 * same tested 3×3 linear algebra instead of re-implementing it — this
 * function has no dependency on the "homography" semantics of its
 * arguments, it just multiplies matrices.
 */
export function multiply3x3(a: Homography, b: Homography): Homography {
  const result: number[][] = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[i][k] * b[k][j];
      result[i][j] = sum;
    }
  }
  return result as unknown as Homography;
}

/**
 * Invert a row-major 3×3 matrix (via the adjugate). Exported for reuse by
 * camera-pose.ts, which needs a general 3×3 inverse for K and for flipping
 * this module's image-px→sheet-mm homography around to sheet-mm→image-px.
 */
export function invert3x3(m: Homography): Homography {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-15) {
    throw new RangeError("invert3x3: matrix is singular (determinant ≈ 0).");
  }
  const invDet = 1 / det;
  return [
    [
      (e * i - f * h) * invDet,
      (c * h - b * i) * invDet,
      (b * f - c * e) * invDet,
    ],
    [
      (f * g - d * i) * invDet,
      (a * i - c * g) * invDet,
      (c * d - a * f) * invDet,
    ],
    [
      (d * h - e * g) * invDet,
      (b * g - a * h) * invDet,
      (a * e - b * d) * invDet,
    ],
  ];
}
