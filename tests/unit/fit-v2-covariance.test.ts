import { describe, expect, it } from "vitest";
import {
  GRIP_WIDTH_FACTOR,
  HEIGHT_FACTOR,
  LENGTH_FACTOR,
} from "../../src/server/fit/coefficients";
import {
  SIGMA_INPUT_B_NO_EXIF,
  SIGMA_INPUT_B_WITH_EXIF,
  type Matrix2,
} from "../../src/server/fit/coefficients-v2";
import {
  assertCovariance,
  cholesky2,
  drawInputError,
  inverse3,
  mulberry32,
  normalSampler,
  quadForm,
  targetCovariance,
  targetJacobian,
  type Matrix3,
} from "../../src/server/fit/covariance-v2";

describe("Sigma_target = J Sigma_input J^T", () => {
  it("J follows the v1 target factors", () => {
    expect(targetJacobian("claw")).toEqual([
      [LENGTH_FACTOR.claw, 0],
      [0, GRIP_WIDTH_FACTOR],
      [HEIGHT_FACTOR.claw, 0],
    ]);
  });

  it("length and height share handLength, so their errors are correlated", () => {
    const cov = targetCovariance(SIGMA_INPUT_B_WITH_EXIF, "palm");
    const varL = SIGMA_INPUT_B_WITH_EXIF[0][0];
    expect(cov[0][0]).toBeCloseTo(LENGTH_FACTOR.palm ** 2 * varL, 12);
    expect(cov[2][2]).toBeCloseTo(HEIGHT_FACTOR.palm ** 2 * varL, 12);
    // Cov(length, height) = a b Var(handLength): a correlation of exactly 1.
    expect(cov[0][2]).toBeCloseTo(
      LENGTH_FACTOR.palm * HEIGHT_FACTOR.palm * varL,
      12,
    );
    expect(cov[0][2] / Math.sqrt(cov[0][0] * cov[2][2])).toBeCloseTo(1, 12);
  });

  it("the width target meets the length and height targets only through Cov(handLength, palmWidth)", () => {
    const cov = targetCovariance(SIGMA_INPUT_B_WITH_EXIF, "claw");
    const c = SIGMA_INPUT_B_WITH_EXIF[0][1];
    expect(cov[1][1]).toBeCloseTo(
      GRIP_WIDTH_FACTOR ** 2 * SIGMA_INPUT_B_WITH_EXIF[1][1],
      12,
    );
    expect(cov[0][1]).toBeCloseTo(
      LENGTH_FACTOR.claw * GRIP_WIDTH_FACTOR * c,
      12,
    );
    expect(cov[2][1]).toBeCloseTo(
      HEIGHT_FACTOR.claw * GRIP_WIDTH_FACTOR * c,
      12,
    );
  });

  it("is symmetric and rank 2 for both default profiles", () => {
    for (const s of [SIGMA_INPUT_B_WITH_EXIF, SIGMA_INPUT_B_NO_EXIF]) {
      const cov = targetCovariance(s, "fingertip");
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          expect(cov[i][j]).toBeCloseTo(cov[j][i], 12);
        }
      }
      // Three targets from two inputs: the determinant is 0 (up to float noise).
      const det =
        cov[0][0] * (cov[1][1] * cov[2][2] - cov[1][2] * cov[2][1]) -
        cov[0][1] * (cov[1][0] * cov[2][2] - cov[1][2] * cov[2][0]) +
        cov[0][2] * (cov[1][0] * cov[2][1] - cov[1][1] * cov[2][0]);
      expect(Math.abs(det)).toBeLessThan(1e-9);
    }
  });
});

describe("assertCovariance and cholesky2", () => {
  it("rejects asymmetric, negative-variance and non-PSD matrices", () => {
    expect(() =>
      assertCovariance([
        [1, 0.5],
        [0.4, 1],
      ]),
    ).toThrow(/symmetric/);
    expect(() =>
      assertCovariance([
        [-1, 0],
        [0, 1],
      ]),
    ).toThrow(/positive semi-definite/);
    expect(() =>
      assertCovariance([
        [1, 2],
        [2, 1],
      ]),
    ).toThrow(/positive semi-definite/);
    expect(() =>
      assertCovariance([
        [Number.NaN, 0],
        [0, 1],
      ]),
    ).toThrow(/finite/);
  });

  it("L L^T reproduces the matrix", () => {
    const L = cholesky2(SIGMA_INPUT_B_NO_EXIF);
    expect(L[0][1]).toBe(0);
    expect(L[0][0] * L[0][0]).toBeCloseTo(SIGMA_INPUT_B_NO_EXIF[0][0], 12);
    expect(L[1][0] * L[0][0]).toBeCloseTo(SIGMA_INPUT_B_NO_EXIF[1][0], 12);
    expect(L[1][0] ** 2 + L[1][1] ** 2).toBeCloseTo(
      SIGMA_INPUT_B_NO_EXIF[1][1],
      12,
    );
  });

  it("tolerates a zero matrix (no measurement noise)", () => {
    expect(
      cholesky2([
        [0, 0],
        [0, 0],
      ]),
    ).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
});

describe("inverse3 and quadForm", () => {
  it("M inverse(M) is the identity", () => {
    const m: Matrix3 = [
      [4, 1, 0.5],
      [1, 3, 0.2],
      [0.5, 0.2, 2],
    ];
    const inv = inverse3(m);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += m[i][k] * inv[k][j];
        expect(s).toBeCloseTo(i === j ? 1 : 0, 12);
      }
    }
  });

  it("throws on a singular matrix", () => {
    expect(() =>
      inverse3([
        [1, 2, 3],
        [2, 4, 6],
        [1, 1, 1],
      ]),
    ).toThrow(/singular/);
  });

  it("quadForm of a diagonal matrix is the weighted sum of squares", () => {
    expect(
      quadForm(
        [
          [2, 0, 0],
          [0, 3, 0],
          [0, 0, 4],
        ],
        [1, 2, 3],
      ),
    ).toBe(2 + 12 + 36);
  });
});

describe("seeded sampler", () => {
  it("is deterministic and seed-dependent", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const xs = [a(), a(), a()];
    expect(xs).toEqual([b(), b(), b()]);
    expect(xs).not.toEqual([c(), c(), c()]);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("draws errors whose sample covariance matches Sigma_input", () => {
    const sigma: Matrix2 = SIGMA_INPUT_B_NO_EXIF;
    const chol = cholesky2(sigma);
    const normal = normalSampler(mulberry32(12345));
    const n = 40000;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      const [x, y] = drawInputError(chol, normal);
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
    expect(sx / n).toBeCloseTo(0, 1);
    expect(sy / n).toBeCloseTo(0, 1);
    expect(sxx / n).toBeCloseTo(sigma[0][0], 0);
    expect(syy / n).toBeCloseTo(sigma[1][1], 0);
    expect(sxy / n).toBeCloseTo(sigma[0][1], 0);
  });
});
