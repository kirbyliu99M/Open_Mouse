import { describe, expect, it } from "vitest";
import {
  scoreFrontFlare,
  scoreGripWidth,
  scoreHeightHump,
  scoreLength,
  scoreThumb,
  scoreWeight,
} from "../../src/server/fit/subscores";
import type { CatalogueMouse } from "../../src/server/fit/types";

const baseMouse: CatalogueMouse = {
  slug: "acme-test",
  brand: "Acme",
  model: "Test",
  lengthMm: 120,
  widthMm: 65,
  heightMm: 40,
  weightG: 80,
  size: "medium",
  handCompatibility: "right",
  shape: "symmetrical",
  humpPlacement: null,
  frontFlare: null,
  sideCurvature: null,
  thumbRest: null,
  ringFingerRest: null,
};

const mouse = (patch: Partial<CatalogueMouse>): CatalogueMouse => ({
  ...baseMouse,
  ...patch,
});

describe("scoreLength", () => {
  it.each([
    // [lengthMm, targetMm, expectedScore, expectedCode] — sigma 6mm, ideal band |Δ|<=3
    [120, 120, 100, "length_ideal"],
    [123, 120, 88, "length_ideal"], //   Δ=3 exactly, at the ideal boundary
    [123.1, 120, 88, "length_long"], //  just past the ideal boundary (code flips, score ~same)
    [126, 120, 61, "length_long"], //    Δ=6=σ → exp(-0.5)=0.6065
    [117, 120, 88, "length_ideal"], //   Δ=-3 exactly, mirrored ideal boundary
    [114, 120, 61, "length_short"], //   Δ=-6=σ, mirrored
    [90, 120, 0, "length_short"], //     far below target
  ] as const)(
    "length=%s target=%s → score=%s code=%s",
    (lengthMm, targetMm, score, code) => {
      const r = scoreLength(mouse({ lengthMm }), targetMm);
      expect(r.score).toBe(score);
      expect(r.reason.code).toBe(code);
      expect(r.weight).toBe(0.3);
    },
  );
});

describe("scoreGripWidth", () => {
  it("uses the raw width and full weight when curvature is unknown", () => {
    const r = scoreGripWidth(mouse({ widthMm: 70, sideCurvature: null }), 70);
    expect(r.score).toBe(100);
    expect(r.weight).toBeCloseTo(0.125); // halved from 0.25
    expect(r.reason.code).toBe("width_ideal");
  });

  it.each([
    // [widthMm, curvature, thumbRestErgo, targetMm, expectedEffective]
    [70, "inward", false, 70, 68],
    [70, "inward_aggressive", false, 70, 66],
    [70, "outward", false, 70, 72],
    [70, "outward_aggressive", false, 70, 74],
    [70, "flat", true, 70, 58], // ergonomic + thumb rest: further -12
  ] as const)(
    "width=%s curvature=%s ergoThumbRest=%s → effective=%s",
    (widthMm, sideCurvature, ergo, targetMm, expectedEffective) => {
      const r = scoreGripWidth(
        mouse({
          widthMm,
          sideCurvature,
          shape: ergo ? "ergonomic" : "symmetrical",
          thumbRest: ergo ? true : null,
          ringFingerRest: null,
        }),
        targetMm,
      );
      expect(r.reason.params.effectiveWidthMm).toBe(expectedEffective);
      expect(r.weight).toBe(0.25); // curvature known → full weight
    },
  );
});

describe("scoreHeightHump", () => {
  describe("null hump — height-only score, reason names the height band", () => {
    it.each([
      // [heightMm, targetMm, expectedCode] — sigma 3mm, ideal band |Δ|<=1.5
      [34, 40, "height_low"], //   Δ=-6
      [38.5, 40, "height_ideal"], // Δ=-1.5, ideal boundary
      [40, 40, "height_ideal"], // Δ=0
      [41.5, 40, "height_ideal"], // Δ=1.5, ideal boundary
      [46, 40, "height_high"], //  Δ=6
    ] as const)("height=%s target=%s → %s", (heightMm, targetMm, code) => {
      const r = scoreHeightHump(
        mouse({ heightMm, humpPlacement: null }),
        targetMm,
        "palm",
      );
      expect(r.reason.code).toBe(code);
      expect(r.reason.params).toEqual({
        deltaMm: heightMm - targetMm,
        targetMm,
      });
      expect(r.weight).toBe(0.2);
    });
  });

  it.each([
    // [grip, humpPlacement, levelsOff, code] — height fixed at target
    // (Δ=0, heightScore=100): levelsOff=0 ties the hump score at 100 too,
    // and ties favor the hump code (see subscores.ts); levelsOff>0 makes
    // the hump score strictly the lower (weaker) one.
    ["palm", "back_moderate", 0, "hump_matches_grip"],
    ["palm", "back_aggressive", 0, "hump_matches_grip"],
    ["palm", "back_minimal", 1, "hump_mismatch_grip"],
    ["palm", "center", 2, "hump_mismatch_grip"],
    ["claw", "back_minimal", 0, "hump_matches_grip"],
    ["claw", "back_moderate", 0, "hump_matches_grip"],
    ["claw", "center", 1, "hump_mismatch_grip"],
    ["claw", "back_aggressive", 1, "hump_mismatch_grip"],
    ["fingertip", "center", 0, "hump_matches_grip"],
    ["fingertip", "back_minimal", 1, "hump_mismatch_grip"],
    ["fingertip", "back_moderate", 2, "hump_mismatch_grip"],
    ["fingertip", "back_aggressive", 3, "hump_mismatch_grip"],
  ] as const)(
    "grip=%s hump=%s → %s levels off, %s",
    (grip, humpPlacement, levelsOff, code) => {
      const r = scoreHeightHump(
        mouse({ heightMm: 40, humpPlacement }),
        40,
        grip,
      );
      expect(r.reason.code).toBe(code);
      expect(r.reason.params.humpLevelsOff).toBe(levelsOff);
      // height component is perfect (Δ=0 → 100); hump component per the
      // multiplier table — combine 0.6·height + 0.4·hump.
      const humpMultiplier = [1, 0.85, 0.6, 0.4][levelsOff];
      expect(r.score).toBe(Math.round(0.6 * 100 + 0.4 * 100 * humpMultiplier));
    },
  );

  it("names the weaker component when hump matches but height misses badly", () => {
    // claw, back_minimal → levelsOff 0, humpScore 100. Height way off (Δ=-6
    // → heightScore 61) is the weaker part, so it wins the reason even
    // though the hump placement matches.
    const r = scoreHeightHump(
      mouse({ heightMm: 34, humpPlacement: "back_minimal" }),
      40,
      "claw",
    );
    expect(r.reason.code).toBe("height_low");
  });

  it("names the weaker component when hump matches but height is only slightly off", () => {
    // claw, back_minimal → levelsOff 0, humpScore 100. Height Δ=1 → 95,
    // still within the ideal band but strictly below the hump score.
    const r = scoreHeightHump(
      mouse({ heightMm: 41, humpPlacement: "back_minimal" }),
      40,
      "claw",
    );
    expect(r.reason.code).toBe("height_ideal");
  });
});

describe("scoreFrontFlare", () => {
  it("is null with descriptor_unknown when unclassified", () => {
    const r = scoreFrontFlare(mouse({ frontFlare: null }), "claw");
    expect(r.score).toBeNull();
    expect(r.reason).toEqual({ code: "descriptor_unknown", params: {} });
  });

  it.each([
    // [grip, frontFlare, expectedScore, expectedCode]
    ["claw", "outward_slight", 100, "flare_supports_fingers"],
    ["claw", "outward_moderate", 95, "flare_supports_fingers"],
    ["claw", "outward_aggressive", 85, "flare_supports_fingers"],
    ["claw", "flat", 80, "flare_neutral"],
    ["claw", "inward_slight", 60, "flare_crowds_fingers"],
    ["claw", "inward_aggressive", 60, "flare_crowds_fingers"],
    ["fingertip", "outward_slight", 100, "flare_supports_fingers"],
    ["fingertip", "inward_moderate", 60, "flare_crowds_fingers"],
    ["palm", "outward_aggressive", 80, "flare_neutral"],
    ["palm", "inward_slight", 80, "flare_neutral"],
    ["palm", "inward_aggressive", 60, "flare_crowds_fingers"],
  ] as const)(
    "grip=%s flare=%s → score=%s code=%s",
    (grip, frontFlare, score, code) => {
      const r = scoreFrontFlare(mouse({ frontFlare }), grip);
      expect(r.score).toBe(score);
      expect(r.reason.code).toBe(code);
    },
  );
});

describe("scoreThumb", () => {
  it("is null with descriptor_unknown when unclassified", () => {
    const r = scoreThumb(mouse({ thumbRest: null }), "palm");
    expect(r.score).toBeNull();
    expect(r.reason).toEqual({ code: "descriptor_unknown", params: {} });
  });

  it.each([
    // [grip, thumbRest, expectedScore, expectedCode]
    ["palm", true, 100, "thumb_rest_supports"],
    // A palm grip would normally rest the thumb on a rest: its absence is a
    // tradeoff (`thumb_rest_missing`), not neutral. The score stays 75.
    ["palm", false, 75, "thumb_rest_missing"],
    ["claw", true, 65, "thumb_rest_unneeded"],
    ["claw", false, 85, "thumb_neutral"],
    ["fingertip", true, 65, "thumb_rest_unneeded"],
    ["fingertip", false, 85, "thumb_neutral"],
  ] as const)(
    "grip=%s thumbRest=%s → score=%s code=%s",
    (grip, thumbRest, score, code) => {
      const r = scoreThumb(mouse({ thumbRest }), grip);
      expect(r.score).toBe(score);
      expect(r.reason.code).toBe(code);
    },
  );
});

describe("scoreWeight", () => {
  it("is null with no_preference when the user gave no preference", () => {
    const r = scoreWeight(mouse({ weightG: 80 }), {
      includeVertical: false,
    });
    expect(r.score).toBeNull();
    expect(r.reason).toEqual({ code: "no_preference", params: {} });
  });

  it("is null with descriptor_unknown when the mouse has no weight on file", () => {
    const r = scoreWeight(mouse({ weightG: null }), {
      includeVertical: false,
      weightG: { min: 60, max: 90 },
    });
    expect(r.score).toBeNull();
    expect(r.reason).toEqual({ code: "descriptor_unknown", params: {} });
  });

  it.each([
    // [weightG, min, max, expectedScore, expectedCode]
    [75, 60, 90, 100, "weight_in_range"],
    [60, 60, 90, 100, "weight_in_range"], // inclusive at min
    [90, 60, 90, 100, "weight_in_range"], // inclusive at max
    [50, 60, 90, 61, "weight_lighter"], // Δ=10=σ → exp(-0.5)≈0.6065
    [100, 60, 90, 61, "weight_heavier"],
  ] as const)(
    "weight=%s range=[%s,%s] → score=%s code=%s",
    (weightG, min, max, score, code) => {
      const r = scoreWeight(mouse({ weightG }), {
        includeVertical: false,
        weightG: { min, max },
      });
      expect(r.score).toBe(score);
      expect(r.reason.code).toBe(code);
    },
  );
});
