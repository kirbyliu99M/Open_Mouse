import type { GripStyle } from "../../lib/contracts/fit";
import {
  GRIP_WIDTH_FACTOR,
  HEIGHT_FACTOR,
  LENGTH_FACTOR,
} from "./coefficients";
import type { Matrix2 } from "./coefficients-v2";

/**
 * Small linear algebra for the fit-v2 prototype: the target Jacobian, the
 * target covariance, a 2x2 Cholesky, a 3x3 inverse and a seeded normal
 * sampler. Pure; no dependency.
 *
 * Order everywhere: input = (handLength, palmWidth); target = (length,
 * gripWidth, height).
 */

export type Matrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];
export type Vector3 = readonly [number, number, number];

/**
 * J, the 3x2 Jacobian of the targets with respect to the input, for one grip.
 * The targets are linear in the input (targets.ts), so J is exact:
 *
 *   length    = LENGTH_FACTOR[g] * handLength
 *   gripWidth = GRIP_WIDTH_FACTOR * palmWidth
 *   height    = HEIGHT_FACTOR[g] * handLength   (+ a constant shift, no effect on J)
 *
 * Length and height both read handLength, so their errors are perfectly
 * correlated; v1 treated them as independent.
 */
export function targetJacobian(
  grip: GripStyle,
): readonly [
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
] {
  return [
    [LENGTH_FACTOR[grip], 0],
    [0, GRIP_WIDTH_FACTOR],
    [HEIGHT_FACTOR[grip], 0],
  ];
}

/** Σ_target = J Σ_input Jᵀ (3x3, mm^2). */
export function targetCovariance(
  sigmaInput: Matrix2,
  grip: GripStyle,
): Matrix3 {
  const J = targetJacobian(grip);
  // (J Σ)[i][j]
  const js = J.map((row) => [
    row[0] * sigmaInput[0][0] + row[1] * sigmaInput[1][0],
    row[0] * sigmaInput[0][1] + row[1] * sigmaInput[1][1],
  ]);
  const cell = (i: number, j: number) =>
    js[i][0] * J[j][0] + js[i][1] * J[j][1];
  return [
    [cell(0, 0), cell(0, 1), cell(0, 2)],
    [cell(1, 0), cell(1, 1), cell(1, 2)],
    [cell(2, 0), cell(2, 1), cell(2, 2)],
  ];
}

/** Throws unless `m` is symmetric positive semi-definite (a valid covariance). */
export function assertCovariance(m: Matrix2, label = "sigmaInput"): void {
  const [[a, b], [c, d]] = m;
  const finite = [a, b, c, d].every(Number.isFinite);
  if (!finite) throw new Error(`${label} must be finite`);
  if (Math.abs(b - c) > 1e-12) throw new Error(`${label} must be symmetric`);
  if (a < 0 || d < 0 || a * d - b * b < -1e-12) {
    throw new Error(`${label} must be positive semi-definite`);
  }
}

/** Lower-triangular L with L Lᵀ = m (m a 2x2 PSD matrix; tolerates a zero pivot). */
export function cholesky2(m: Matrix2): Matrix2 {
  assertCovariance(m);
  const l11 = Math.sqrt(m[0][0]);
  const l21 = l11 > 0 ? m[1][0] / l11 : 0;
  const l22 = Math.sqrt(Math.max(0, m[1][1] - l21 * l21));
  return [
    [l11, 0],
    [l21, l22],
  ];
}

/** Inverse of a 3x3 matrix through its adjugate. Throws when it is singular. */
export function inverse3(m: Matrix3): Matrix3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-300)) throw new Error("matrix is singular");
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/** vᵀ M v. */
export function quadForm(m: Matrix3, v: Vector3): number {
  let s = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) s += v[r] * m[r][c] * v[c];
  }
  return s;
}

/** mulberry32: a small seeded PRNG, uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draws (Box-Muller) from a uniform source. */
export function normalSampler(uniform: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const z = spare;
      spare = null;
      return z;
    }
    // 1 - u keeps the log argument in (0, 1].
    const u1 = 1 - uniform();
    const u2 = uniform();
    const r = Math.sqrt(-2 * Math.log(u1));
    spare = r * Math.sin(2 * Math.PI * u2);
    return r * Math.cos(2 * Math.PI * u2);
  };
}

/** One draw of a zero-mean error with covariance Σ_input: L z. */
export function drawInputError(
  chol: Matrix2,
  normal: () => number,
): [number, number] {
  const z1 = normal();
  const z2 = normal();
  return [chol[0][0] * z1, chol[1][0] * z1 + chol[1][1] * z2];
}
