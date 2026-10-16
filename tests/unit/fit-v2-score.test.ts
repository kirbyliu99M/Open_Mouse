import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GripStyle } from "../../src/lib/contracts/fit";
import {
  DEFAULT_ENGINE,
  ENGINE_VERSION_V1,
} from "../../src/server/fit/coefficients";
import {
  BIAS_INPUT_FRAME_B,
  DEFAULT_PARAMS_V2,
  ENGINE_IS_PROVISIONAL,
  ENGINE_VERSION_V2,
  SIGMA_INPUT_B_WITH_EXIF,
  SIGMA_INPUT_FRAME_B,
  V1_EQUIVALENT_PARAMS_V2,
  type Matrix2,
} from "../../src/server/fit/coefficients-v2";
import { computePriors } from "../../src/server/fit/priors";
import { scoreFitV1 } from "../../src/server/fit/score-v1";
import {
  acceptableRange,
  buildGripContextV2,
  jointMatch,
  mouseInRange,
  resolveParams,
  scoreFitV2,
  toleranceOnlySigma,
  uncertaintyForGrip,
} from "../../src/server/fit/score-v2";
import { scoreFrontFlare, scoreThumb } from "../../src/server/fit/subscores-v2";
import {
  computeTargets,
  computeTargetsByGrip,
} from "../../src/server/fit/targets";
import { LENGTH_FACTOR } from "../../src/server/fit/coefficients";
import {
  describedCatalogue,
  goldenHands,
  mouse,
  seedCatalogue,
} from "./fit-v2-fixtures";

const prefs = { includeVertical: false } as const;
const claw = goldenHands.medium_claw;
const priors = computePriors(seedCatalogue);
const GRIPS: GripStyle[] = ["palm", "claw", "fingertip"];
const run = (
  hand = claw.measurements,
  catalogue = seedCatalogue,
  p: Parameters<typeof scoreFitV2>[2] = prefs,
  options: Parameters<typeof scoreFitV2>[5] = {},
) => scoreFitV2(hand, catalogue, p, "right", priors, options);

describe("fit-v2 scaffolding", () => {
  it("is labelled a provisional candidate", () => {
    expect(ENGINE_VERSION_V2).toBe("fit-v2-structure-candidate.0");
    expect(ENGINE_IS_PROVISIONAL).toBe(true);
    const r = run();
    expect(r.engineVersion).toBe(ENGINE_VERSION_V2);
    expect(r.isProvisional).toBe(true);
  });

  it("does not touch the default engine", () => {
    expect(DEFAULT_ENGINE).toBe("v1");
    expect(ENGINE_VERSION_V1).toBe("fit-v1-candidate.3");
    const engineSource = readFileSync(
      new URL("../../src/server/fit/engine.ts", import.meta.url),
      "utf8",
    );
    expect(engineSource).not.toMatch(/score-v2|coefficients-v2/);
  });

  it("defaults to the simulated frame (no EXIF) covariance and bias, not the EXIF comparison", () => {
    expect(DEFAULT_PARAMS_V2.sigmaInput).toEqual([
      [18.77, 4.82],
      [4.82, 6.09],
    ]);
    expect(DEFAULT_PARAMS_V2.sigmaInput).not.toEqual(SIGMA_INPUT_B_WITH_EXIF);
    expect(DEFAULT_PARAMS_V2.biasInput).toEqual([3.85, 1.32]);
    expect(V1_EQUIVALENT_PARAMS_V2.biasInput).toEqual([0, 0]);
    expect(DEFAULT_PARAMS_V2.asymmetry).toEqual({
      length: 1,
      gripWidth: 1,
      height: 1,
    });
  });

  it("rejects an invalid Sigma_input", () => {
    expect(() =>
      resolveParams({
        sigmaInput: [
          [1, 3],
          [3, 1],
        ],
      }),
    ).toThrow();
  });
});

describe("1. Sigma_input is an input", () => {
  it("a larger Sigma_input widens sigma_eff and the reported target covariance", () => {
    const tight = run(claw.measurements, seedCatalogue, prefs, {
      params: { sigmaInput: SIGMA_INPUT_B_WITH_EXIF },
    });
    const loose = run(claw.measurements, seedCatalogue, prefs, {
      params: {
        sigmaInput: [
          [36, 0],
          [0, 16],
        ],
      },
    });
    const t = tight.uncertainty.claw;
    const l = loose.uncertainty.claw;
    expect(l?.sigmaEff.length.lo).toBeGreaterThan(
      t?.sigmaEff.length.lo as number,
    );
    expect(l?.targetCovariance[0][0]).toBeGreaterThan(
      t?.targetCovariance[0][0] as number,
    );
  });
});

describe("2. tolerance and measurement noise are kept and reported apart", () => {
  const params = resolveParams();
  const u = uncertaintyForGrip(params, "palm");

  it("reports both, and sigma_eff is their quadrature sum", () => {
    expect(u.tolerance).toEqual({ length: 6, gripWidth: 5, height: 3 });
    expect(u.measurementSd.length).toBeCloseTo(
      Math.sqrt(u.targetCovariance[0][0]),
      12,
    );
    expect(u.sigmaEff.length.lo).toBeCloseTo(
      Math.sqrt(u.tolerance.length ** 2 + u.measurementSd.length ** 2),
      12,
    );
    expect(u.sigmaEff.height.hi).toBeCloseTo(
      Math.sqrt(u.tolerance.height ** 2 + u.measurementSd.height ** 2),
      12,
    );
  });

  it("changing the tolerance does not change the measurement part", () => {
    const wide = uncertaintyForGrip(
      resolveParams({ tolerance: { length: 9, gripWidth: 5, height: 3 } }),
      "palm",
    );
    expect(wide.targetCovariance).toEqual(u.targetCovariance);
    expect(wide.measurementSd).toEqual(u.measurementSd);
    expect(wide.sigmaEff.length.lo).toBeGreaterThan(u.sigmaEff.length.lo);
  });

  it("with zero measurement noise sigma_eff is the tolerance alone", () => {
    const zero: Matrix2 = [
      [0, 0],
      [0, 0],
    ];
    const z = uncertaintyForGrip(resolveParams({ sigmaInput: zero }), "claw");
    expect(z.sigmaEff.length).toEqual({ lo: 6, hi: 6 });
    expect(toleranceOnlySigma(params).gripWidth).toEqual({ lo: 5, hi: 5 });
  });

  it("is exposed per grip in play on the response", () => {
    const r = run();
    expect(Object.keys(r.uncertainty).sort()).toEqual([
      "claw",
      "fingertip",
      "palm",
    ]);
    const stated = run(claw.measurements, seedCatalogue, {
      ...prefs,
      gripStyle: "claw",
    });
    expect(Object.keys(stated.uncertainty)).toEqual(["claw"]);
  });
});

describe("correlation cannot change the marginal total, only joint quantities", () => {
  const diagonalOnly: Matrix2 = [
    [SIGMA_INPUT_FRAME_B[0][0], 0],
    [0, SIGMA_INPUT_FRAME_B[1][1]],
  ];

  it("totals are identical with and without Cov(handLength, palmWidth)", () => {
    const withCov = run();
    const without = run(claw.measurements, seedCatalogue, prefs, {
      params: { sigmaInput: diagonalOnly },
    });
    expect(withCov.results.map((e) => e.totalRaw)).toEqual(
      without.results.map((e) => e.totalRaw),
    );
  });

  it("the joint match does change with the correlation", () => {
    const corr = uncertaintyForGrip(resolveParams(), "claw");
    const indep = uncertaintyForGrip(
      resolveParams({ sigmaInput: diagonalOnly }),
      "claw",
    );
    const d: [number, number, number] = [4, 0, 4];
    expect(jointMatch(d, corr)).not.toBeCloseTo(jointMatch(d, indep), 6);
    // Length and height errors move together, so same-sign deltas are more plausible.
    expect(jointMatch([4, 0, 4], corr)).toBeGreaterThan(
      jointMatch([4, 0, -4], corr),
    );
  });

  it("with a diagonal Sigma_target the joint match is the product of 1-D Gaussians", () => {
    const u = uncertaintyForGrip(
      resolveParams({
        sigmaInput: [
          [0, 0],
          [0, 4],
        ],
      }),
      "palm",
    );
    // No hand-length error: the length and height targets are exact.
    const sw = u.sigmaEff.gripWidth.lo;
    const want =
      100 * Math.exp(-0.5 * ((3 / 6) ** 2 + (2 / sw) ** 2 + (1 / 3) ** 2));
    expect(jointMatch([3, 2, 1], u)).toBeCloseTo(want, 9);
  });
});

describe("3. acceptable range: symmetric only by default", () => {
  const params = resolveParams();
  const targets = computeTargets(185, 76, "claw");
  const u = uncertaintyForGrip(params, "claw");

  it("is target -c sigma_lo ... target +c sigma_hi, c from the threshold", () => {
    const r = acceptableRange(targets, u.sigmaEff, 60);
    const c = Math.sqrt(-2 * Math.log(0.6));
    expect(r.length.lo).toBeCloseTo(
      targets.lengthMm - c * u.sigmaEff.length.lo,
      9,
    );
    expect(r.length.hi).toBeCloseTo(
      targets.lengthMm + c * u.sigmaEff.length.hi,
      9,
    );
    expect(r.length.hi - targets.lengthMm).toBeCloseTo(
      targets.lengthMm - r.length.lo,
      9,
    );
  });

  it("a mouse at the edge scores exactly the threshold", () => {
    const r = acceptableRange(targets, u.sigmaEff, 60);
    const edge = mouse({
      lengthMm: r.length.hi,
      widthMm: targets.gripWidthMm,
      heightMm: targets.heightMm,
    });
    const res = scoreFitV2(
      { handLengthMm: 185, palmLengthMm: 104, palmWidthMm: 76 },
      [edge],
      { ...prefs, gripStyle: "claw" },
      "right",
      priors,
      { params: { biasInput: [0, 0] } },
    );
    expect(res.results[0].subscoresByGrip.claw?.length.score).toBeCloseTo(
      60,
      9,
    );
  });

  it("a higher threshold gives a narrower range; bad thresholds throw", () => {
    const wide = acceptableRange(targets, u.sigmaEff, 40);
    const narrow = acceptableRange(targets, u.sigmaEff, 80);
    expect(narrow.height.hi - narrow.height.lo).toBeLessThan(
      wide.height.hi - wide.height.lo,
    );
    expect(() => acceptableRange(targets, u.sigmaEff, 0)).toThrow();
    expect(() => acceptableRange(targets, u.sigmaEff, 101)).toThrow();
  });

  it("asymmetry 2 widens only the upper side of its own dimension", () => {
    const asym = uncertaintyForGrip(
      resolveParams({ asymmetry: { length: 2, gripWidth: 1, height: 1 } }),
      "claw",
    );
    const rs = acceptableRange(targets, u.sigmaEff, 60);
    const ra = acceptableRange(targets, asym.sigmaEff, 60);
    expect(ra.length.lo).toBeCloseTo(rs.length.lo, 12);
    expect(ra.length.hi).toBeGreaterThan(rs.length.hi);
    expect(ra.height).toEqual(rs.height);
    expect(ra.gripWidth).toEqual(rs.gripWidth);
  });

  it("asymmetry changes the score on its own side only", () => {
    const hand = { handLengthMm: 185, palmLengthMm: 104, palmWidthMm: 76 };
    const exact = {
      widthMm: targets.gripWidthMm,
      heightMm: targets.heightMm,
    };
    const longer = mouse({
      slug: "long",
      lengthMm: targets.lengthMm + 8,
      ...exact,
    });
    const shorter = mouse({
      slug: "short",
      lengthMm: targets.lengthMm - 8,
      ...exact,
    });
    const score = (asym: number, m: typeof longer) =>
      scoreFitV2(hand, [m], { ...prefs, gripStyle: "claw" }, "right", priors, {
        params: { asymmetry: { length: asym, gripWidth: 1, height: 1 } },
      }).results[0].subscoresByGrip.claw?.length.score as number;
    expect(score(2, longer)).toBeGreaterThan(score(1, longer));
    expect(score(2, shorter)).toBeCloseTo(score(1, shorter), 12);
  });

  it("scoreFitV2 reports ranges per grip and consistent per-mouse flags", () => {
    const r = run(claw.measurements, describedCatalogue);
    expect(Object.keys(r.ranges).sort()).toEqual(["claw", "fingertip", "palm"]);
    for (const e of r.results) {
      const m = describedCatalogue.find((x) => x.slug === e.mouse.slug);
      for (const g of GRIPS) {
        const ranges = r.ranges[g];
        if (!m || !ranges) throw new Error("missing range or mouse");
        expect(e.inRange[g]).toEqual(mouseInRange(m, ranges));
      }
      expect(e.inRangeAnyGrip).toBe(
        Object.values(e.inRange).some((x) => x?.all),
      );
    }
    // A 128 x 70 x 46 mm mouse is far above a 185 mm hand's claw height target.
    const tall = r.results.find((e) => e.mouse.slug === "a-tall");
    expect(tall?.inRange.claw?.height).toBe(false);
  });

  it("in-range reads the effective width, not the listed width", () => {
    const r = acceptableRange(targets, u.sigmaEff, 60);
    // Listed 86 mm is outside, but an ergonomic thumb-rest mouse loses 15 mm of it.
    const ergo = mouse({ widthMm: 86, shape: "ergonomic", thumbRest: true });
    expect(ergo.widthMm).toBeGreaterThan(r.gripWidth.hi);
    expect(mouseInRange(ergo, r).gripWidth).toBe(true);
  });
});

describe("5. grip is not inferred from hand size", () => {
  it("with no stated grip: equal thirds, gripUnknown true, palm length ignored", () => {
    const a = run({ handLengthMm: 185, palmLengthMm: 90, palmWidthMm: 76 });
    const b = run({ handLengthMm: 185, palmLengthMm: 125, palmWidthMm: 76 });
    expect(a.gripUnknown).toBe(true);
    expect(a.gripStyle.mode).toBe("equal");
    expect(a.gripStyle.used).toBeNull();
    for (const g of GRIPS)
      expect(a.gripStyle.weights[g]).toBeCloseTo(1 / 3, 12);
    expect(b.results.map((e) => [e.mouse.slug, e.totalRaw])).toEqual(
      a.results.map((e) => [e.mouse.slug, e.totalRaw]),
    );
  });

  it("the total is the plain mean of the three grips' totals", () => {
    const hand = claw.measurements;
    const all = run(hand, describedCatalogue);
    const perGrip = GRIPS.map(
      (g) =>
        new Map(
          run(hand, describedCatalogue, { ...prefs, gripStyle: g }).results.map(
            (e) => [e.mouse.slug, e.totalRaw] as const,
          ),
        ),
    );
    for (const e of all.results) {
      const want =
        perGrip.reduce((s, m) => s + (m.get(e.mouse.slug) as number), 0) / 3;
      expect(e.totalRaw).toBeCloseTo(want, 9);
    }
  });

  it("a stated grip behaves as v1 (weight 1, gripUnknown false)", () => {
    const p = { ...prefs, gripStyle: "palm" } as const;
    const r = run(claw.measurements, seedCatalogue, p, {
      params: V1_EQUIVALENT_PARAMS_V2,
    });
    expect(r.gripUnknown).toBe(false);
    expect(r.gripStyle.mode).toBe("stated");
    expect(r.gripStyle.used).toBe("palm");
    expect(r.gripStyle.weights).toEqual({ palm: 1, claw: 0, fingertip: 0 });
    const v1 = scoreFitV1(claw.measurements, seedCatalogue, p, "right", priors);
    expect(r.results.map((e) => e.total)).toEqual(
      v1.results.map((e) => e.total),
    );
  });

  it("v1_ratio mode exists only on request and reads the palm ratio", () => {
    const ctx = buildGripContextV2(
      { handLengthMm: 205, palmLengthMm: 124, palmWidthMm: 88 },
      prefs,
      resolveParams({ gripUnknownMode: "v1_ratio" }),
    );
    expect(ctx.gripUnknown).toBe(true);
    expect(ctx.weights.palm).toBeGreaterThan(0.8);
    expect(resolveParams().gripUnknownMode).toBe("equal");
  });
});

describe("6. no new mouse-geometry coefficient", () => {
  it("flare and thumb are v1's own functions, re-exported", () => {
    const m = mouse({ frontFlare: "outward_slight", thumbRest: true });
    expect(scoreFrontFlare(m, "claw").score).toBe(100);
    expect(scoreThumb(m, "palm").score).toBe(100);
  });

  it("coefficients-v2 defines no geometry table", () => {
    const src = readFileSync(
      new URL("../../src/server/fit/coefficients-v2.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/THUMB_SCORE|HUMP_|CURVATURE|FACTOR/);
  });
});

describe("bias is subtracted before the targets, the covariance is propagated around the corrected input", () => {
  const bias: [number, number] = [4, 1.5];
  const measured = claw.measurements;
  const corrected = {
    ...measured,
    handLengthMm: measured.handLengthMm - bias[0],
    palmWidthMm: measured.palmWidthMm - bias[1],
  };

  it("reports the corrected input and computes every target from it", () => {
    const r = run(measured, seedCatalogue, prefs, {
      params: { biasInput: bias },
    });
    expect(r.correctedInput).toEqual({
      handLengthMm: corrected.handLengthMm,
      palmWidthMm: corrected.palmWidthMm,
    });
    expect(r.targetsByGrip).toEqual(
      computeTargetsByGrip(
        corrected.handLengthMm,
        corrected.palmWidthMm,
        undefined,
      ),
    );
    const none = run(measured, seedCatalogue, prefs, {
      params: { biasInput: [0, 0] },
    });
    expect(
      none.targetsByGrip.claw.lengthMm - r.targetsByGrip.claw.lengthMm,
    ).toBeCloseTo(LENGTH_FACTOR.claw * bias[0], 9);
  });

  it("correcting by b is exactly feeding the corrected hand with no correction", () => {
    const a = run(measured, seedCatalogue, prefs, {
      params: { biasInput: bias },
    });
    const b = run(corrected, seedCatalogue, prefs, {
      params: { biasInput: [0, 0] },
    });
    expect(a.results.map((e) => [e.mouse.slug, e.totalRaw])).toEqual(
      b.results.map((e) => [e.mouse.slug, e.totalRaw]),
    );
  });

  it("does not touch the covariance: tolerance and measurement noise stay as given", () => {
    const a = run(measured, seedCatalogue, prefs, {
      params: { biasInput: bias },
    });
    const b = run(measured, seedCatalogue, prefs, {
      params: { biasInput: [0, 0] },
    });
    expect(a.uncertainty).toEqual(b.uncertainty);
  });

  it("the default bias really moves the scores (it is not a no-op)", () => {
    const withDefault = run();
    const off = run(measured, seedCatalogue, prefs, {
      params: { biasInput: [0, 0] },
    });
    expect(withDefault.params.biasInput).toEqual(BIAS_INPUT_FRAME_B);
    expect(withDefault.results.map((e) => e.totalRaw)).not.toEqual(
      off.results.map((e) => e.totalRaw),
    );
  });

  it("rejects a bias that is not finite or that leaves a non-positive measurement", () => {
    expect(() => resolveParams({ biasInput: [Number.NaN, 0] })).toThrow(
      /finite/,
    );
    expect(() =>
      run(measured, seedCatalogue, prefs, {
        params: { biasInput: [measured.handLengthMm, 0] },
      }),
    ).toThrow(/non-positive/);
  });
});
