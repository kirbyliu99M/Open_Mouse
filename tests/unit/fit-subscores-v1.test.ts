import { describe, expect, it } from "vitest";
import { SIDE_CURVATURES } from "../../src/lib/contracts/descriptors";
import { GRIP_STYLES } from "../../src/lib/contracts/fit";
import {
  BASE_WEIGHTS,
  CURVATURE_ADJUSTMENT_MM,
  THUMB_REST_ERGONOMIC_ADJUSTMENT_MM,
} from "../../src/server/fit/coefficients";
import {
  SIGMA_EFF,
  gaussianRaw,
  scoreGripWidthV1,
  scoreHeightHumpV1,
  scoreLengthV1,
  scoreWeightV1,
} from "../../src/server/fit/subscores-v1";
import type { CatalogueMouse } from "../../src/server/fit/types";

const base: CatalogueMouse = {
  slug: "acme-alpha",
  brand: "Acme",
  model: "Alpha",
  lengthMm: 118,
  widthMm: 66,
  heightMm: 38,
  weightG: 80,
  size: "medium",
  handCompatibility: null,
  shape: null,
  humpPlacement: null,
  frontFlare: null,
  sideCurvature: null,
  thumbRest: null,
  ringFingerRest: null,
};
const mouse = (patch: Partial<CatalogueMouse>): CatalogueMouse => ({
  ...base,
  ...patch,
});

describe("gaussianRaw", () => {
  it("is exactly 100 at zero delta and unrounded elsewhere", () => {
    expect(gaussianRaw(0, 5)).toBe(100);
    const atOneSigma = gaussianRaw(5, 5);
    expect(atOneSigma).toBeCloseTo(100 * Math.exp(-0.5), 12);
    expect(Number.isInteger(atOneSigma)).toBe(false);
  });

  it("is symmetric in the sign of the delta", () => {
    expect(gaussianRaw(-3.7, 4)).toBe(gaussianRaw(3.7, 4));
  });

  it("stays within 0 to 100 and decays to 0 far away", () => {
    for (const d of [0, 0.1, 1, 10, 100, 1e6]) {
      const v = gaussianRaw(d, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(gaussianRaw(1e6, 3)).toBe(0);
    expect(gaussianRaw(30, 3)).toBeLessThan(1e-9);
  });

  it("is 100 for any delta when sigma is infinite", () => {
    expect(gaussianRaw(5, Infinity)).toBe(100);
  });

  it("falls with the delta", () => {
    expect(gaussianRaw(1, 3)).toBeGreaterThan(gaussianRaw(2, 3));
  });
});

describe("scoreLengthV1", () => {
  it("scores the delta with the grip's sigma_eff, unrounded, and names the direction", () => {
    const m = mouse({ lengthMm: 124 });
    const r = scoreLengthV1(m, 114.7, "claw");
    expect(r.score).toBeCloseTo(
      gaussianRaw(124 - 114.7, SIGMA_EFF.length("claw")),
      12,
    );
    expect(r.weight).toBe(BASE_WEIGHTS.length);
    expect(r.reason.params.deltaMm).toBeCloseTo(9.3, 12);
    expect(r.reason.code).toBe("length_long");
    expect(
      scoreLengthV1(mouse({ lengthMm: 105 }), 114.7, "claw").reason.code,
    ).toBe("length_short");
    expect(
      scoreLengthV1(mouse({ lengthMm: 114.7 }), 114.7, "claw"),
    ).toMatchObject({
      score: 100,
      reason: { code: "length_ideal" },
    });
  });
});

describe("scoreGripWidthV1", () => {
  const target = 66;
  const sigma = SIGMA_EFF.gripWidth();

  it.each(SIDE_CURVATURES)(
    "curvature %s adds its table adjustment to the width",
    (curvature) => {
      const adj = CURVATURE_ADJUSTMENT_MM[curvature];
      const r = scoreGripWidthV1(
        mouse({ widthMm: 66, sideCurvature: curvature }),
        target,
      );
      expect(r.reason.params.curvatureAdjMm).toBe(adj);
      expect(r.reason.params.effectiveWidthMm).toBe(66 + adj);
      expect(r.reason.params.deltaMm).toBe(adj);
      expect(r.score).toBeCloseTo(gaussianRaw(adj, sigma), 12);
    },
  );

  it("the curvature table is not all zero (guards the table-driven test above)", () => {
    expect(SIDE_CURVATURES.some((c) => CURVATURE_ADJUSTMENT_MM[c] !== 0)).toBe(
      true,
    );
  });

  it("an inward-aggressive mouse 4 mm wider than the target scores 100", () => {
    const r = scoreGripWidthV1(
      mouse({ widthMm: 70, sideCurvature: "inward_aggressive" }),
      target,
    );
    expect(r.score).toBe(100);
    expect(r.reason.code).toBe("width_ideal");
  });

  it("an ergonomic mouse with a thumb rest loses 12 mm of effective width", () => {
    const r = scoreGripWidthV1(
      mouse({
        widthMm: 78,
        shape: "ergonomic",
        thumbRest: true,
        ringFingerRest: null,
        sideCurvature: "flat",
      }),
      target,
    );
    expect(THUMB_REST_ERGONOMIC_ADJUSTMENT_MM).toBe(-12);
    expect(r.reason.params.ergonomicThumbAdjMm).toBe(-12);
    expect(r.reason.params.effectiveWidthMm).toBe(66);
    expect(r.score).toBe(100);
  });

  it.each([
    ["symmetrical, thumb rest", { shape: "symmetrical", thumbRest: true }],
    ["ergonomic, no thumb rest", { shape: "ergonomic", thumbRest: false }],
    ["ergonomic, thumb rest unknown", { shape: "ergonomic", thumbRest: null }],
    ["hybrid, thumb rest", { shape: "hybrid", thumbRest: true }],
  ] as const)("no thumb-rest adjustment for %s", (_n, patch) => {
    const r = scoreGripWidthV1(
      mouse({ widthMm: 66, sideCurvature: "flat", ...patch }),
      target,
    );
    expect(r.reason.params.ergonomicThumbAdjMm).toBe(0);
    expect(r.reason.params.effectiveWidthMm).toBe(66);
  });

  it("halves the weight only while sideCurvature is null", () => {
    expect(
      scoreGripWidthV1(mouse({ sideCurvature: null }), target).weight,
    ).toBe(BASE_WEIGHTS.gripWidth / 2);
    for (const c of SIDE_CURVATURES) {
      expect(scoreGripWidthV1(mouse({ sideCurvature: c }), target).weight).toBe(
        BASE_WEIGHTS.gripWidth,
      );
    }
  });

  it("names narrow, ideal and wide by the sigma_eff band", () => {
    const code = (w: number) =>
      scoreGripWidthV1(mouse({ widthMm: w, sideCurvature: "flat" }), target)
        .reason.code;
    expect(code(66)).toBe("width_ideal");
    expect(code(66 - sigma)).toBe("width_narrow");
    expect(code(66 + sigma)).toBe("width_wide");
    expect(code(66 + 0.5 * sigma - 0.01)).toBe("width_ideal");
  });
});

describe("scoreHeightHumpV1", () => {
  // HUMP_PLACEMENTS order: center, back_minimal, back_moderate, back_aggressive.
  // Best placements: palm back_moderate/back_aggressive, claw back_minimal/
  // back_moderate, fingertip center. Multipliers by levels off: 1, 0.85, 0.6, 0.4.
  const target = 38;

  it("without a hump it is the unrounded height score and names the height band", () => {
    const m = mouse({ heightMm: 40, humpPlacement: null });
    const r = scoreHeightHumpV1(m, target, "claw");
    expect(r.score).toBeCloseTo(gaussianRaw(2, SIGMA_EFF.height("claw")), 12);
    expect(Number.isInteger(r.score)).toBe(false);
    expect(r.reason.code).toBe("height_high");
    expect(r.reason.params.humpLevelsOff).toBeUndefined();
    expect(r.weight).toBe(BASE_WEIGHTS.heightHump);
  });

  it.each([
    ["palm", "back_moderate", 0, 100],
    ["palm", "back_aggressive", 0, 100],
    ["palm", "back_minimal", 1, 85],
    ["palm", "center", 2, 60],
    ["claw", "back_minimal", 0, 100],
    ["claw", "back_moderate", 0, 100],
    ["claw", "center", 1, 85],
    ["claw", "back_aggressive", 1, 85],
    ["fingertip", "center", 0, 100],
    ["fingertip", "back_minimal", 1, 85],
    ["fingertip", "back_moderate", 2, 60],
    ["fingertip", "back_aggressive", 3, 40],
  ] as const)(
    "%s with %s hump is %s levels off and blends 0.6 height + 0.4 x %s",
    (grip, hump, levelsOff, humpScore) => {
      // Height exactly on target: the height part is 100.
      const exact = scoreHeightHumpV1(
        mouse({ heightMm: target, humpPlacement: hump }),
        target,
        grip,
      );
      expect(exact.reason.params.humpLevelsOff).toBe(levelsOff);
      expect(exact.score).toBeCloseTo(0.6 * 100 + 0.4 * humpScore, 12);

      // Height off by 2 mm: the blend uses the real (unrounded) height score.
      const off = scoreHeightHumpV1(
        mouse({ heightMm: target + 2, humpPlacement: hump }),
        target,
        grip,
      );
      const h = gaussianRaw(2, SIGMA_EFF.height(grip));
      expect(off.score).toBeCloseTo(0.6 * h + 0.4 * humpScore, 12);
    },
  );

  it("reports the weaker component's code", () => {
    // Hump mismatch (palm, center: 60) with perfect height → hump code.
    expect(
      scoreHeightHumpV1(
        mouse({ heightMm: target, humpPlacement: "center" }),
        target,
        "palm",
      ).reason.code,
    ).toBe("hump_mismatch_grip");
    // Hump match with a height 3 sigma low → height code.
    const low = target - 3 * SIGMA_EFF.height("palm");
    expect(
      scoreHeightHumpV1(
        mouse({ heightMm: low, humpPlacement: "back_moderate" }),
        target,
        "palm",
      ).reason.code,
    ).toBe("height_low");
    const high = target + 3 * SIGMA_EFF.height("palm");
    expect(
      scoreHeightHumpV1(
        mouse({ heightMm: high, humpPlacement: "back_moderate" }),
        target,
        "palm",
      ).reason.code,
    ).toBe("height_high");
  });

  it.each(GRIP_STYLES)(
    "a hump-matched mouse within 0.3 mm of the height target reports hump_matches_grip (%s)",
    (grip) => {
      const best = {
        palm: "back_moderate",
        claw: "back_minimal",
        fingertip: "center",
      } as const;
      for (const dh of [0, 0.1, -0.1, 0.3, -0.3]) {
        const r = scoreHeightHumpV1(
          mouse({ heightMm: target + dh, humpPlacement: best[grip] }),
          target,
          grip,
        );
        expect(r.reason.code).toBe("hump_matches_grip");
      }
    },
  );
});

describe("scoreWeightV1", () => {
  const prefs = { includeVertical: false, weightG: { min: 60, max: 80 } };

  it("no preference: null and no_preference", () => {
    expect(scoreWeightV1(mouse({}), { includeVertical: false })).toEqual({
      score: null,
      weight: BASE_WEIGHTS.weight,
      reason: { code: "no_preference", params: {} },
    });
  });

  it("a preference but no catalogue weight: null and descriptor_unknown", () => {
    expect(scoreWeightV1(mouse({ weightG: null }), prefs)).toEqual({
      score: null,
      weight: BASE_WEIGHTS.weight,
      reason: { code: "descriptor_unknown", params: {} },
    });
  });

  it.each([60, 70, 80])("%s g is in range: 100 and weight_in_range", (g) => {
    expect(scoreWeightV1(mouse({ weightG: g }), prefs)).toEqual({
      score: 100,
      weight: BASE_WEIGHTS.weight,
      reason: { code: "weight_in_range", params: { minG: 60, maxG: 80 } },
    });
  });

  it("heavier than the range decays as a Gaussian with sigma 10 g, unrounded", () => {
    const r = scoreWeightV1(mouse({ weightG: 95 }), prefs);
    expect(r.score).toBeCloseTo(gaussianRaw(15, 10), 12);
    expect(r.score).toBeLessThan(100);
    expect(r.score).toBeGreaterThan(0);
    expect(r.reason).toEqual({
      code: "weight_heavier",
      params: { deltaG: 15, minG: 60, maxG: 80 },
    });
    expect(scoreWeightV1(mouse({ weightG: 90 }), prefs).score).toBeCloseTo(
      100 * Math.exp(-0.5),
      12,
    );
  });

  it("lighter than the range decays the same way", () => {
    const r = scoreWeightV1(mouse({ weightG: 45 }), prefs);
    expect(r.score).toBeCloseTo(gaussianRaw(15, 10), 12);
    expect(r.reason).toEqual({
      code: "weight_lighter",
      params: { deltaG: 15, minG: 60, maxG: 80 },
    });
  });
});
