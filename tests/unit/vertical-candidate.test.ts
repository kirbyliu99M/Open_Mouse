import { describe, expect, it } from "vitest";
import { excludeReason } from "../../src/server/fit/exclusions";
import type { CatalogueMouse } from "../../src/server/fit/types";
import {
  isVerticalFormFactor,
  scoreVerticalCandidate,
  sectionMeanMm,
  type VerticalCandidateResult,
  type VerticalHandInput,
  type VerticalMouseInput,
} from "../../src/server/fit/vertical-candidate";
import {
  PALM_THICKNESS_LEVELS,
  PALM_THICKNESS_ORDINAL,
  PALM_THICKNESS_SCALE_PLACEHOLDER,
  THICKNESS_PRIOR_STEP,
  VERTICAL_CONFIG_A,
  VERTICAL_CONFIG_B,
  VERTICAL_WIRING_A_PRIOR,
  VERTICAL_WIRING_B_REVERSED,
  VERTICAL_WIRING_B_SECTION,
  VERTICAL_WIRING_C_NONE,
  makeSectionWiring,
  type PalmThicknessLevel,
  type SectionQuantity,
  type VerticalCandidateConfig,
} from "../../src/server/fit/vertical-candidate-constants";
import {
  VERTICAL_SECTIONS,
  VERTICAL_SECTION_STATIONS,
  sectionsForModel,
  type VerticalSectionStation,
} from "../../src/server/fit/vertical-candidate-sections";

// Catalogue sizes (src/db/seed/logitech.json). Weight is not scored.
const LIFT: VerticalMouseInput = { lengthMm: 108, widthMm: 70, heightMm: 71 };
const MX: VerticalMouseInput = { lengthMm: 120, widthMm: 79, heightMm: 78.5 };
const HORIZONTAL: VerticalMouseInput = {
  lengthMm: 120,
  widthMm: 65,
  heightMm: 40,
};

/** The hand for which every mapping-A target equals the mouse exactly. */
function handForMouse(m: VerticalMouseInput): VerticalHandInput {
  const { targets } = VERTICAL_CONFIG_A;
  return {
    handLengthMm: m.lengthMm / targets.length.factor,
    palmWidthMm: m.heightMm / targets.height.factor,
  };
}

/** A vertical mouse whose width also hits the proxy target for `handForMouse`. */
const PERFECT: VerticalMouseInput = (() => {
  const base = { lengthMm: 108, widthMm: 0, heightMm: 70 };
  const hand = handForMouse(base);
  return {
    ...base,
    widthMm: hand.palmWidthMm * VERTICAL_CONFIG_A.targets.widthProxy.factor,
  };
})();

function applicable(r: VerticalCandidateResult) {
  if (!r.applicable) throw new Error(`expected applicable, got ${r.reason}`);
  return r;
}

describe("applicability", () => {
  it("refuses a horizontal mouse instead of scoring it", () => {
    const r = scoreVerticalCandidate(handForMouse(LIFT), HORIZONTAL);
    expect(r).toEqual({
      applicable: false,
      status: "candidate",
      reason: "not_vertical_form_factor",
    });
  });

  it("scores the two catalogue vertical mice", () => {
    expect(scoreVerticalCandidate(handForMouse(LIFT), LIFT).applicable).toBe(
      true,
    );
    expect(scoreVerticalCandidate(handForMouse(MX), MX).applicable).toBe(true);
  });

  it("uses height ÷ length strictly above 0.55, like excludeReason", () => {
    const at = { lengthMm: 100, widthMm: 70, heightMm: 55 }; // ratio 0.55
    const above = { lengthMm: 100, widthMm: 70, heightMm: 55.1 };
    expect(isVerticalFormFactor(at)).toBe(false);
    expect(isVerticalFormFactor(above)).toBe(true);
    expect(scoreVerticalCandidate(handForMouse(at), at)).toMatchObject({
      applicable: false,
      reason: "not_vertical_form_factor",
    });
    expect(scoreVerticalCandidate(handForMouse(above), above).applicable).toBe(
      true,
    );
  });

  it("agrees with excludeReason on which mice are vertical", () => {
    const row = (m: VerticalMouseInput): CatalogueMouse => ({
      ...m,
      weightG: 125,
      slug: "x",
      brand: "x",
      model: "x",
      size: "medium",
      handCompatibility: null,
      shape: null,
      humpPlacement: null,
      frontFlare: null,
      sideCurvature: null,
      thumbRest: null,
    });
    for (const m of [LIFT, MX, HORIZONTAL]) {
      const excluded =
        excludeReason(row(m), "right", { includeVertical: false }) ===
        "vertical_form_factor";
      expect(isVerticalFormFactor(m)).toBe(excluded);
    }
  });

  it.each([
    ["hand length NaN", { handLengthMm: NaN, palmWidthMm: 84 }, LIFT],
    ["hand length zero", { handLengthMm: 0, palmWidthMm: 84 }, LIFT],
    ["palm width negative", { handLengthMm: 180, palmWidthMm: -1 }, LIFT],
    ["palm width infinite", { handLengthMm: 180, palmWidthMm: Infinity }, LIFT],
    [
      "mouse length zero",
      { handLengthMm: 180, palmWidthMm: 84 },
      { ...LIFT, lengthMm: 0 },
    ],
    [
      "mouse height NaN",
      { handLengthMm: 180, palmWidthMm: 84 },
      { ...LIFT, heightMm: NaN },
    ],
  ] as [string, VerticalHandInput, VerticalMouseInput][])(
    "refuses invalid input: %s",
    (_name, hand, mouse) => {
      expect(scoreVerticalCandidate(hand, mouse)).toEqual({
        applicable: false,
        status: "candidate",
        reason: "invalid_input",
      });
    },
  );
});

describe("scores", () => {
  it("gives 100 everywhere when every target is hit", () => {
    const r = applicable(
      scoreVerticalCandidate(handForMouse(PERFECT), PERFECT),
    );
    expect(r.subscores.length.score).toBe(100);
    expect(r.subscores.height.score).toBe(100);
    expect(r.subscores.widthProxy.score).toBe(100);
    expect(r.total).toBe(100);
    expect(r.subscores.length.deltaMm).toBeCloseTo(0, 9);
  });

  it("derives targets from the configured source and factor", () => {
    const hand = { handLengthMm: 180, palmWidthMm: 80 };
    const r = applicable(scoreVerticalCandidate(hand, LIFT));
    expect(r.subscores.length.targetMm).toBeCloseTo(108, 9); // 180 × 0.60
    expect(r.subscores.height.targetMm).toBeCloseTo(72, 9); // 80 × 0.90
    expect(r.subscores.widthProxy.targetMm).toBeCloseTo(70.4, 9); // 80 × 0.88
  });

  it("scores a known offset with the Gaussian form (one sigma → 61)", () => {
    // length target 108; mouse 108 vs hand giving target 100 → delta 8 = sigma.
    const hand = { handLengthMm: 100 / 0.6, palmWidthMm: 71 / 0.9 };
    const r = applicable(scoreVerticalCandidate(hand, LIFT));
    expect(r.subscores.length.deltaMm).toBeCloseTo(8, 9);
    expect(r.subscores.length.score).toBe(61);
    expect(r.subscores.length.scoreUnrounded).toBeCloseTo(
      100 * Math.exp(-0.5),
      9,
    );
  });

  it("pins the height and width-proxy sigmas (one sigma off → 61)", () => {
    // palm width 80 → height target 72, width-proxy target 70.4.
    const heightOff = applicable(
      scoreVerticalCandidate(
        { handLengthMm: 180, palmWidthMm: (71 - 5) / 0.9 },
        LIFT,
      ),
    );
    expect(heightOff.subscores.height.deltaMm).toBeCloseTo(5, 9);
    expect(heightOff.subscores.height.score).toBe(61);
    const widthOff = applicable(
      scoreVerticalCandidate(
        { handLengthMm: 180, palmWidthMm: (70 - 6) / 0.88 },
        LIFT,
      ),
    );
    expect(widthOff.subscores.widthProxy.deltaMm).toBeCloseTo(6, 9);
    expect(widthOff.subscores.widthProxy.score).toBe(61);
  });

  it("normalises by the weight sum, so weights need not add to 1", () => {
    const hand = { handLengthMm: 170, palmWidthMm: 80 };
    const scaled: VerticalCandidateConfig = {
      ...VERTICAL_CONFIG_A,
      weights: { length: 8, height: 8, widthProxy: 4 },
    };
    const a = applicable(scoreVerticalCandidate(hand, MX));
    const b = applicable(scoreVerticalCandidate(hand, MX, scaled));
    expect(b.totalUnrounded).toBeCloseTo(a.totalUnrounded, 9);
  });

  it("rounds the total to nearest, not down", () => {
    let sawFractionAtLeastHalf = false;
    for (let l = 150; l <= 210; l += 1.3) {
      const r = applicable(
        scoreVerticalCandidate({ handLengthMm: l, palmWidthMm: 0.47 * l }, MX),
      );
      expect(r.total).toBe(Math.round(r.totalUnrounded));
      if (r.totalUnrounded - Math.floor(r.totalUnrounded) >= 0.5) {
        sawFractionAtLeastHalf = true;
        expect(r.total).toBe(Math.floor(r.totalUnrounded) + 1);
      }
    }
    expect(sawFractionAtLeastHalf).toBe(true);
  });

  it("total is the weighted mean of the unrounded sub-scores", () => {
    const hand = { handLengthMm: 175, palmWidthMm: 80 };
    const r = applicable(scoreVerticalCandidate(hand, MX));
    const { length, height, widthProxy } = r.subscores;
    const expected =
      (length.scoreUnrounded * length.weight +
        height.scoreUnrounded * height.weight +
        widthProxy.scoreUnrounded * widthProxy.weight) /
      (length.weight + height.weight + widthProxy.weight);
    expect(r.totalUnrounded).toBeCloseTo(expected, 9);
    expect(r.total).toBe(Math.round(expected));
  });

  it("weights sum to 1 in the default config", () => {
    const w = VERTICAL_CONFIG_A.weights;
    expect(w.length + w.height + w.widthProxy).toBeCloseTo(1, 12);
  });

  it("stays within 0–100 for absurdly far hands", () => {
    for (const hand of [
      { handLengthMm: 100, palmWidthMm: 50 },
      { handLengthMm: 280, palmWidthMm: 150 },
    ]) {
      const r = applicable(scoreVerticalCandidate(hand, LIFT));
      for (const s of Object.values(r.subscores)) {
        expect(s.score).toBeGreaterThanOrEqual(0);
        expect(s.score).toBeLessThanOrEqual(100);
      }
      expect(r.total).toBeGreaterThanOrEqual(0);
      expect(r.total).toBeLessThanOrEqual(100);
    }
    const far = applicable(
      scoreVerticalCandidate({ handLengthMm: 280, palmWidthMm: 150 }, LIFT),
    );
    expect(far.total).toBe(0);
  });
});

describe("monotonicity and symmetry", () => {
  const sweep = (from: number, to: number, step: number) => {
    const out: number[] = [];
    for (let x = from; x <= to + 1e-9; x += step) out.push(x);
    return out;
  };
  const totalAt = (l: number) =>
    applicable(
      scoreVerticalCandidate({ handLengthMm: l, palmWidthMm: 0.47 * l }, LIFT),
    );

  it("a hand's length sub-score rises toward the target and falls after it", () => {
    const targetLength = 108 / 0.6; // hand length at which length delta = 0
    const below = sweep(120, targetLength, 2).map(
      (l) => totalAt(l).subscores.length.scoreUnrounded,
    );
    const above = sweep(targetLength, 240, 2).map(
      (l) => totalAt(l).subscores.length.scoreUnrounded,
    );
    for (let i = 1; i < below.length; i++) {
      expect(below[i]).toBeGreaterThan(below[i - 1]!);
    }
    for (let i = 1; i < above.length; i++) {
      expect(above[i]).toBeLessThan(above[i - 1]!);
    }
  });

  it("the height sub-score rises toward the target palm width and falls after it", () => {
    const peak = 71 / 0.9;
    const at = (pw: number) =>
      applicable(
        scoreVerticalCandidate({ handLengthMm: 180, palmWidthMm: pw }, LIFT),
      ).subscores.height.scoreUnrounded;
    const below = sweep(55, peak, 1).map(at);
    const above = sweep(peak, 100, 1).map(at);
    for (let i = 1; i < below.length; i++) {
      expect(below[i]).toBeGreaterThan(below[i - 1]!);
    }
    for (let i = 1; i < above.length; i++) {
      expect(above[i]).toBeLessThan(above[i - 1]!);
    }
  });

  it("equal distances either side of the target score the same", () => {
    const l0 = 108 / 0.6;
    for (const dMm of [3, 8, 15]) {
      const lo = totalAt(l0 - dMm / 0.6).subscores.length;
      const hi = totalAt(l0 + dMm / 0.6).subscores.length;
      expect(lo.deltaMm).toBeCloseTo(dMm, 9);
      expect(hi.deltaMm).toBeCloseTo(-dMm, 9);
      expect(lo.scoreUnrounded).toBeCloseTo(hi.scoreUnrounded, 9);
    }
  });

  it("the total peaks where the targets are met, not elsewhere", () => {
    const peak = applicable(
      scoreVerticalCandidate(handForMouse(PERFECT), PERFECT),
    ).totalUnrounded;
    const base = handForMouse(PERFECT);
    for (const [dl, dw] of [
      [5, 0],
      [-5, 0],
      [0, 5],
      [0, -5],
    ] as const) {
      const r = applicable(
        scoreVerticalCandidate(
          {
            handLengthMm: base.handLengthMm + dl,
            palmWidthMm: base.palmWidthMm + dw,
          },
          PERFECT,
        ),
      );
      expect(r.totalUnrounded).toBeLessThan(peak);
    }
  });

  it("is ordered: a smaller hand prefers Lift, a larger hand prefers MX (S1 assumption)", () => {
    const at = (l: number, m: VerticalMouseInput) =>
      applicable(
        scoreVerticalCandidate({ handLengthMm: l, palmWidthMm: 0.47 * l }, m),
      ).totalUnrounded;
    expect(at(160, LIFT)).toBeGreaterThan(at(160, MX));
    expect(at(200, MX)).toBeGreaterThan(at(200, LIFT));
  });
});

describe("reason codes", () => {
  // length sigma 8 → close band is |delta| <= 4.
  const lengthReason = (deltaMm: number) =>
    applicable(
      scoreVerticalCandidate(
        { handLengthMm: (108 - deltaMm) / 0.6, palmWidthMm: 71 / 0.9 },
        LIFT,
      ),
    ).subscores.length.reason;

  it("names closeness by the sign and size of the offset", () => {
    expect(lengthReason(0)).toBe("vertical_length_close");
    expect(lengthReason(3.9)).toBe("vertical_length_close");
    expect(lengthReason(-3.9)).toBe("vertical_length_close");
    expect(lengthReason(4.1)).toBe("vertical_length_long");
    expect(lengthReason(-4.1)).toBe("vertical_length_short");
  });

  it("says only size closeness: no health or comfort wording in any code", () => {
    const codes: string[] = [];
    for (const hand of [
      { handLengthMm: 150, palmWidthMm: 60 },
      { handLengthMm: 180, palmWidthMm: 80 },
      { handLengthMm: 220, palmWidthMm: 110 },
    ]) {
      for (const m of [LIFT, MX]) {
        const r = applicable(scoreVerticalCandidate(hand, m));
        for (const s of Object.values(r.subscores)) codes.push(s.reason);
      }
    }
    for (const code of codes) {
      expect(code).toMatch(/^vertical_(length|height|width_proxy)_/);
      expect(code).not.toMatch(/wrist|pain|strain|comfort|health|ergonomic/i);
    }
  });
});

describe("purity and configuration", () => {
  it("is deterministic and does not mutate its inputs", () => {
    const hand = Object.freeze({ handLengthMm: 182.3, palmWidthMm: 84.1 });
    const mouse = Object.freeze({ ...MX });
    const a = scoreVerticalCandidate(hand, mouse);
    const b = scoreVerticalCandidate(hand, mouse);
    expect(a).toEqual(b);
    expect(hand).toEqual({ handLengthMm: 182.3, palmWidthMm: 84.1 });
  });

  it("ignores palm length and finger lengths (not used by the candidate)", () => {
    const a = scoreVerticalCandidate(
      { handLengthMm: 180, palmWidthMm: 84 },
      LIFT,
    );
    const b = scoreVerticalCandidate(
      { handLengthMm: 180, palmWidthMm: 84, palmLengthMm: 60 },
      LIFT,
    );
    expect(b).toEqual(a);
  });

  it("every output is marked candidate", () => {
    expect(scoreVerticalCandidate(handForMouse(LIFT), LIFT).status).toBe(
      "candidate",
    );
    expect(scoreVerticalCandidate(handForMouse(LIFT), HORIZONTAL).status).toBe(
      "candidate",
    );
  });

  it("actually reads the config (a different mapping gives a different answer)", () => {
    const hand = { handLengthMm: 180, palmWidthMm: 84 };
    const a = applicable(scoreVerticalCandidate(hand, MX, VERTICAL_CONFIG_A));
    const b = applicable(scoreVerticalCandidate(hand, MX, VERTICAL_CONFIG_B));
    expect(b.subscores.height.targetMm).toBeCloseTo(72, 9); // 180 × 0.40
    expect(a.subscores.height.targetMm).toBeCloseTo(75.6, 9); // 84 × 0.90
    expect(b.totalUnrounded).not.toBeCloseTo(a.totalUnrounded, 3);
  });

  it("a wider sigma flattens the score; a heavier weight moves the total", () => {
    const hand = { handLengthMm: 170, palmWidthMm: 80 };
    const wide: VerticalCandidateConfig = {
      ...VERTICAL_CONFIG_A,
      sigmaMm: { length: 16, height: 10, widthProxy: 12 },
    };
    const base = applicable(scoreVerticalCandidate(hand, MX));
    const flat = applicable(scoreVerticalCandidate(hand, MX, wide));
    expect(flat.subscores.length.score).toBeGreaterThan(
      base.subscores.length.score,
    );
    const lengthOnly: VerticalCandidateConfig = {
      ...VERTICAL_CONFIG_A,
      weights: { length: 1, height: 0, widthProxy: 0 },
    };
    const solo = applicable(scoreVerticalCandidate(hand, MX, lengthOnly));
    expect(solo.totalUnrounded).toBeCloseTo(
      solo.subscores.length.scoreUnrounded,
      9,
    );
  });
});

// ── phase 2: palm thickness (未拍板) ──────────────────────────────────────

const LIFT_S: VerticalMouseInput = {
  ...LIFT,
  sections: sectionsForModel("Lift Vertical"),
};
const MX_S: VerticalMouseInput = {
  ...MX,
  sections: sectionsForModel("MX Vertical"),
};
const HAND: VerticalHandInput = { handLengthMm: 182.3, palmWidthMm: 84.1 };
const withLevel = (
  hand: VerticalHandInput,
  palmThickness: PalmThicknessLevel,
): VerticalHandInput => ({ ...hand, palmThickness });
const ALL_CONFIGS: [string, VerticalCandidateConfig][] = [
  ["C none", VERTICAL_WIRING_C_NONE],
  ["A prior", VERTICAL_WIRING_A_PRIOR],
  ["B section", VERTICAL_WIRING_B_SECTION],
  ["B reversed", VERTICAL_WIRING_B_REVERSED],
];

describe("thickness missing = phase 1, bit for bit", () => {
  // Numbers printed by the phase-1 code at the commit before this change
  // (src/server/fit/vertical-candidate.ts @ 2edcc4c), compared with toBe.
  const golden: [number, number, "LIFT" | "MX", number, number][] = [
    [182.3, 84.1, "LIFT", 81.17325144180663, 80.00252414495665],
    [182.3, 84.1, "MX", 64.8779303388711, 70.7433250145298],
    [160, 75.2, "LIFT", 61.3964558361681, 81.61991569650388],
    [160, 75.2, "MX", 6.329210469585958, 10.186601690904705],
    [200, 94, "LIFT", 16.089726341369932, 10.56947559414886],
    [200, 94, "MX", 75.50740604587476, 82.51418236230212],
  ];

  it.each(ALL_CONFIGS)(
    "%s: no level gives exactly the phase-1 numbers",
    (_name, config) => {
      for (const [l, pw, which, total, widthScore] of golden) {
        const mouse = which === "LIFT" ? LIFT_S : MX_S;
        const r = applicable(
          scoreVerticalCandidate(
            { handLengthMm: l, palmWidthMm: pw },
            mouse,
            config,
          ),
        );
        expect(r.totalUnrounded).toBe(total);
        expect(r.subscores.widthProxy.scoreUnrounded).toBe(widthScore);
        expect("thickness" in r).toBe(false);
      }
    },
  );

  it.each(ALL_CONFIGS)(
    "%s: the result equals the default-config result strictly (same keys, same values)",
    (_name, config) => {
      for (const m of [LIFT, MX, LIFT_S, MX_S]) {
        expect(scoreVerticalCandidate(HAND, m, config)).toStrictEqual(
          scoreVerticalCandidate(HAND, m),
        );
      }
    },
  );

  it("wiring none (and the default config) ignores a level that is given", () => {
    for (const level of PALM_THICKNESS_LEVELS) {
      for (const config of [VERTICAL_CONFIG_A, VERTICAL_WIRING_C_NONE]) {
        expect(
          scoreVerticalCandidate(withLevel(HAND, level), MX_S, config),
        ).toStrictEqual(scoreVerticalCandidate(HAND, MX_S, config));
      }
    }
  });

  it("an explicit undefined level behaves as missing", () => {
    const explicit = { ...HAND, palmThickness: undefined };
    for (const [, config] of ALL_CONFIGS) {
      expect(scoreVerticalCandidate(explicit, MX_S, config)).toStrictEqual(
        scoreVerticalCandidate(HAND, MX_S, config),
      );
    }
  });

  it("wiring B with no level needs no section data", () => {
    const r = scoreVerticalCandidate(HAND, MX, VERTICAL_WIRING_B_SECTION);
    expect(r).toStrictEqual(scoreVerticalCandidate(HAND, MX));
  });
});

describe("invalid thickness input", () => {
  it.each([
    ["unknown word", "heavy"],
    ["empty string", ""],
    ["wrong case", "Thick"],
    ["number", 1],
    ["null", null],
    ["object", { level: "thick" }],
  ] as [string, unknown][])("refuses %s under every config", (_n, bad) => {
    const hand = {
      ...HAND,
      palmThickness: bad,
    } as unknown as VerticalHandInput;
    for (const [, config] of ALL_CONFIGS) {
      expect(scoreVerticalCandidate(hand, MX_S, config)).toEqual({
        applicable: false,
        status: "candidate",
        reason: "invalid_input",
      });
    }
  });

  it("accepts exactly the three levels", () => {
    expect([...PALM_THICKNESS_LEVELS]).toEqual(["thin", "medium", "thick"]);
    for (const level of PALM_THICKNESS_LEVELS) {
      for (const [, config] of ALL_CONFIGS) {
        expect(
          scoreVerticalCandidate(withLevel(HAND, level), MX_S, config)
            .applicable,
        ).toBe(true);
      }
    }
  });

  it("a bad level is refused even for a mouse that is not vertical", () => {
    const hand = {
      ...HAND,
      palmThickness: "x",
    } as unknown as VerticalHandInput;
    expect(scoreVerticalCandidate(hand, HORIZONTAL)).toMatchObject({
      reason: "invalid_input",
    });
  });
});

describe("level placeholders", () => {
  it("ordinals are -1 / 0 / +1 and scales 0.85 / 1 / 1.15 (placeholders)", () => {
    expect(PALM_THICKNESS_ORDINAL).toEqual({ thin: -1, medium: 0, thick: 1 });
    expect(PALM_THICKNESS_SCALE_PLACEHOLDER).toEqual({
      thin: 0.85,
      medium: 1,
      thick: 1.15,
    });
    expect(THICKNESS_PRIOR_STEP).toBe(0.05);
  });
});

describe("wiring A: direction prior", () => {
  const at = (level: PalmThicknessLevel, mouse = MX) =>
    applicable(
      scoreVerticalCandidate(
        withLevel(HAND, level),
        mouse,
        VERTICAL_WIRING_A_PRIOR,
      ),
    );

  it("scales every target by 1 − step × ordinal: thick smaller, thin larger", () => {
    const base = applicable(scoreVerticalCandidate(HAND, MX));
    for (const level of PALM_THICKNESS_LEVELS) {
      const scale = 1 - THICKNESS_PRIOR_STEP * PALM_THICKNESS_ORDINAL[level];
      const r = at(level);
      expect(r.thickness).toMatchObject({
        level,
        wiring: "prior",
        targetScale: scale,
      });
      for (const key of ["length", "height", "widthProxy"] as const) {
        expect(r.subscores[key].targetMm).toBeCloseTo(
          base.subscores[key].targetMm * scale,
          9,
        );
      }
    }
    expect(at("thick").subscores.length.targetMm).toBeLessThan(
      at("medium").subscores.length.targetMm,
    );
    expect(at("thin").subscores.length.targetMm).toBeGreaterThan(
      at("medium").subscores.length.targetMm,
    );
  });

  it("medium gives the phase-1 scores (metadata aside)", () => {
    const base = applicable(scoreVerticalCandidate(HAND, MX));
    const med = at("medium");
    expect(med.totalUnrounded).toBe(base.totalUnrounded);
    expect(med.subscores).toStrictEqual(base.subscores);
  });

  it("deltas move one way: thin < medium < thick (mouse − target)", () => {
    for (const mouse of [LIFT, MX]) {
      for (const key of ["length", "height", "widthProxy"] as const) {
        const [thin, med, thick] = PALM_THICKNESS_LEVELS.map(
          (l) => at(l, mouse).subscores[key].deltaMm,
        );
        expect(thin!).toBeLessThan(med!);
        expect(med!).toBeLessThan(thick!);
      }
    }
  });

  it("the larger mouse takes over at a shorter hand when the palm is thin (crossover order)", () => {
    const cross = (level: PalmThicknessLevel): number => {
      let prev: number | null = null;
      for (let l = 120; l <= 260; l += 0.25) {
        const hand = withLevel(
          { handLengthMm: l, palmWidthMm: 0.47 * l },
          level,
        );
        const d =
          applicable(scoreVerticalCandidate(hand, MX, VERTICAL_WIRING_A_PRIOR))
            .totalUnrounded -
          applicable(
            scoreVerticalCandidate(hand, LIFT, VERTICAL_WIRING_A_PRIOR),
          ).totalUnrounded;
        if (prev !== null && Math.sign(prev) !== Math.sign(d)) return l;
        prev = d;
      }
      throw new Error("no crossover");
    };
    const [thin, med, thick] = PALM_THICKNESS_LEVELS.map(cross);
    expect(thin!).toBeLessThan(med!);
    expect(med!).toBeLessThan(thick!);
  });

  it("is monotone in the step: a bigger step moves the length target further", () => {
    const target = (step: number) =>
      applicable(
        scoreVerticalCandidate(withLevel(HAND, "thick"), MX, {
          ...VERTICAL_CONFIG_A,
          thickness: { kind: "prior", stepPerOrdinal: step },
        }),
      ).subscores.length.targetMm;
    expect(target(0.1)).toBeLessThan(target(0.05));
    expect(target(0.05)).toBeLessThan(target(0.01));
    expect(target(0)).toBeCloseTo(
      applicable(scoreVerticalCandidate(HAND, MX)).subscores.length.targetMm,
      9,
    );
  });

  it("needs no section data", () => {
    expect(
      scoreVerticalCandidate(
        withLevel(HAND, "thick"),
        LIFT,
        VERTICAL_WIRING_A_PRIOR,
      ).applicable,
    ).toBe(true);
  });
});

describe("sectionMeanMm", () => {
  const st = (ny: number, k: number): VerticalSectionStation => ({
    ny,
    widthMm: 10 * k + 1,
    heightMm: 10 * k + 2,
    outerGirthMm: 10 * k + 3,
    minFeretMm: 10 * k + 4,
    maxFeretMm: 10 * k + 5,
    minRectLongMm: 10 * k + 6,
    minRectShortMm: 10 * k + 7,
  });
  const sections = [st(0.4, 1), st(0.5, 2), st(0.6, 3), st(0.7, 4)];

  it("averages the chosen field over the chosen stations only", () => {
    expect(
      sectionMeanMm(sections, VERTICAL_SECTION_STATIONS, "minFeretMm"),
    ).toBeCloseTo(29, 9); // 14, 24, 34, 44
    expect(sectionMeanMm(sections, [0.5, 0.6], "minFeretMm")).toBeCloseTo(
      29,
      9,
    ); // 24, 34
    expect(sectionMeanMm(sections, [0.4], "minFeretMm")).toBe(14);
    expect(sectionMeanMm(sections, [0.7], "minFeretMm")).toBe(44);
  });

  it.each([
    ["minFeretMm", 14],
    ["minRectShortMm", 17],
    ["outerGirthMm", 13],
    ["widthAxisMm", 11],
  ] as [SectionQuantity, number][])(
    "reads the right field for %s",
    (quantity, expected) => {
      expect(sectionMeanMm(sections, [0.4], quantity)).toBe(expected);
    },
  );

  it("returns null for anything unusable", () => {
    expect(sectionMeanMm(undefined, [0.4], "minFeretMm")).toBeNull();
    expect(sectionMeanMm(sections, [], "minFeretMm")).toBeNull();
    expect(sectionMeanMm(sections, [0.45], "minFeretMm")).toBeNull();
    expect(
      sectionMeanMm([{ ...st(0.4, 1), minFeretMm: NaN }], [0.4], "minFeretMm"),
    ).toBeNull();
    expect(
      sectionMeanMm([{ ...st(0.4, 1), minFeretMm: 0 }], [0.4], "minFeretMm"),
    ).toBeNull();
  });
});

describe("wiring B: cross-section correspondence", () => {
  const at = (
    level: PalmThicknessLevel,
    mouse: VerticalMouseInput = MX_S,
    config: VerticalCandidateConfig = VERTICAL_WIRING_B_SECTION,
  ) =>
    applicable(scoreVerticalCandidate(withLevel(HAND, level), mouse, config));

  it("replaces only the width-proxy slot; length and height are phase 1", () => {
    const base = applicable(scoreVerticalCandidate(HAND, MX_S));
    for (const level of PALM_THICKNESS_LEVELS) {
      const r = at(level);
      expect(r.subscores.length).toStrictEqual(base.subscores.length);
      expect(r.subscores.height).toStrictEqual(base.subscores.height);
      expect(r.subscores.widthProxy.reason).toMatch(/^vertical_section_/);
      expect(r.subscores.widthProxy.weight).toBe(
        base.subscores.widthProxy.weight,
      );
    }
  });

  it("compares the mean min Feret of the four stations with palmWidth × ratio × scale^−1", () => {
    const meanMx = (61.517 + 66.974 + 69.334 + 68.163) / 4; // SEC-2 literals
    const r = at("medium");
    expect(r.thickness?.section?.quantity).toBe("minFeretMm");
    expect(r.thickness?.section?.mouseMm).toBeCloseTo(meanMx, 9);
    expect(r.subscores.widthProxy.targetMm).toBeCloseTo(84.1 * 0.75, 9);
    expect(at("thin").subscores.widthProxy.targetMm).toBeCloseTo(
      (84.1 * 0.75) / 0.85,
      9,
    );
    expect(at("thick").subscores.widthProxy.targetMm).toBeCloseTo(
      (84.1 * 0.75) / 1.15,
      9,
    );
  });

  it("direction −1: thin target > medium > thick; reversed is the mirror", () => {
    const target = (
      level: PalmThicknessLevel,
      config: VerticalCandidateConfig,
    ) => at(level, MX_S, config).subscores.widthProxy.targetMm;
    expect(target("thin", VERTICAL_WIRING_B_SECTION)).toBeGreaterThan(
      target("medium", VERTICAL_WIRING_B_SECTION),
    );
    expect(target("medium", VERTICAL_WIRING_B_SECTION)).toBeGreaterThan(
      target("thick", VERTICAL_WIRING_B_SECTION),
    );
    expect(target("thin", VERTICAL_WIRING_B_REVERSED)).toBeLessThan(
      target("medium", VERTICAL_WIRING_B_REVERSED),
    );
    expect(target("medium", VERTICAL_WIRING_B_REVERSED)).toBeLessThan(
      target("thick", VERTICAL_WIRING_B_REVERSED),
    );
  });

  it("scores 100 where the mouse's section mean equals the target, less either side", () => {
    // A mouse whose min Feret is 63 at every station; the palm width is chosen
    // so the medium target is exactly 63.
    const flat: VerticalSectionStation[] = VERTICAL_SECTION_STATIONS.map(
      (ny) => ({
        ny,
        widthMm: 70,
        heightMm: 70,
        outerGirthMm: 220,
        minFeretMm: 63,
        maxFeretMm: 80,
        minRectLongMm: 80,
        minRectShortMm: 63,
      }),
    );
    const mouse = { ...LIFT, sections: flat };
    const hand = { handLengthMm: 180, palmWidthMm: 63 / 0.75 };
    const score = (level: PalmThicknessLevel) =>
      applicable(
        scoreVerticalCandidate(
          withLevel(hand, level),
          mouse,
          VERTICAL_WIRING_B_SECTION,
        ),
      ).subscores.widthProxy;
    expect(score("medium").scoreUnrounded).toBeCloseTo(100, 9);
    expect(score("thin").scoreUnrounded).toBeLessThan(100);
    expect(score("thick").scoreUnrounded).toBeLessThan(100);
    // thin target 63 / 0.85 = 74.1 (mouse below it); thick 63 / 1.15 = 54.8 (above it)
    expect(score("thin").deltaMm).toBeLessThan(0);
    expect(score("thick").deltaMm).toBeGreaterThan(0);
  });

  it("the section sub-score falls as the section moves away from the target (monotone)", () => {
    const mk = (feret: number): VerticalMouseInput => ({
      ...LIFT,
      sections: VERTICAL_SECTION_STATIONS.map((ny) => ({
        ny,
        widthMm: 70,
        heightMm: 70,
        outerGirthMm: 220,
        minFeretMm: feret,
        maxFeretMm: 80,
        minRectLongMm: 80,
        minRectShortMm: feret,
      })),
    });
    const hand = withLevel({ handLengthMm: 180, palmWidthMm: 84 }, "medium");
    const s = (f: number) =>
      applicable(scoreVerticalCandidate(hand, mk(f), VERTICAL_WIRING_B_SECTION))
        .subscores.widthProxy.scoreUnrounded;
    const target = 84 * 0.75;
    for (let d = 1; d < 15; d++) {
      expect(s(target + d)).toBeLessThan(s(target + d - 1));
      expect(s(target - d)).toBeLessThan(s(target - d + 1));
    }
  });

  it("the quantity choice changes the answer (min Feret is not axis width)", () => {
    const a = at("medium").totalUnrounded;
    const b = at("medium", MX_S, {
      ...VERTICAL_CONFIG_A,
      thickness: makeSectionWiring({ quantity: "widthAxisMm" }),
    }).totalUnrounded;
    expect(a).not.toBeCloseTo(b, 3);
  });

  it("the station choice changes the value read from the sections", () => {
    const one = (ny: number) =>
      at("thick", MX_S, {
        ...VERTICAL_CONFIG_A,
        thickness: makeSectionWiring({ stations: [ny] }),
      }).thickness?.section?.mouseMm;
    expect(one(0.4)).toBeCloseTo(61.517, 9);
    expect(one(0.6)).toBeCloseTo(69.334, 9);
  });

  it("refuses with section_data_missing when a level is given but sections are not", () => {
    expect(
      scoreVerticalCandidate(
        withLevel(HAND, "thick"),
        MX,
        VERTICAL_WIRING_B_SECTION,
      ),
    ).toEqual({
      applicable: false,
      status: "candidate",
      reason: "section_data_missing",
    });
    expect(
      scoreVerticalCandidate(
        withLevel(HAND, "thick"),
        { ...MX, sections: [] },
        VERTICAL_WIRING_B_SECTION,
      ),
    ).toMatchObject({ reason: "section_data_missing" });
    // a station the wiring asks for is absent
    expect(
      scoreVerticalCandidate(withLevel(HAND, "thick"), MX_S, {
        ...VERTICAL_CONFIG_A,
        thickness: makeSectionWiring({ stations: [0.45] }),
      }),
    ).toMatchObject({ reason: "section_data_missing" });
  });

  it("section reason codes say size closeness only", () => {
    const codes = new Set<string>();
    for (const level of PALM_THICKNESS_LEVELS) {
      for (const l of [150, 180, 220]) {
        for (const m of [LIFT_S, MX_S]) {
          const r = applicable(
            scoreVerticalCandidate(
              withLevel({ handLengthMm: l, palmWidthMm: 0.47 * l }, level),
              m,
              VERTICAL_WIRING_B_SECTION,
            ),
          );
          codes.add(r.subscores.widthProxy.reason);
        }
      }
    }
    expect([...codes].sort()).toEqual([
      "vertical_section_close",
      "vertical_section_large",
      "vertical_section_small",
    ]);
    for (const c of codes) {
      expect(c).not.toMatch(/wrist|pain|strain|comfort|health|ergonomic/i);
    }
  });
});

describe("thickness: purity and determinism", () => {
  it("is deterministic and does not mutate frozen inputs (hand, mouse, sections)", () => {
    const sections = Object.freeze(
      (sectionsForModel("MX Vertical") ?? []).map((s) =>
        Object.freeze({ ...s }),
      ),
    );
    const mouse = Object.freeze({ ...MX, sections });
    const hand = Object.freeze({ ...HAND, palmThickness: "thick" as const });
    for (const [, config] of ALL_CONFIGS) {
      const a = scoreVerticalCandidate(hand, mouse, config);
      const b = scoreVerticalCandidate(hand, mouse, config);
      expect(a).toEqual(b);
    }
    expect(hand).toEqual({ ...HAND, palmThickness: "thick" });
  });

  it("every thickness result is marked candidate and stays within 0–100", () => {
    for (const [, config] of ALL_CONFIGS) {
      for (const level of PALM_THICKNESS_LEVELS) {
        for (const l of [100, 180, 280]) {
          const r = scoreVerticalCandidate(
            withLevel({ handLengthMm: l, palmWidthMm: 0.47 * l }, level),
            LIFT_S,
            config,
          );
          expect(r.status).toBe("candidate");
          if (r.applicable) {
            expect(r.total).toBeGreaterThanOrEqual(0);
            expect(r.total).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  });
});

describe("section data literals", () => {
  const models = ["MX Vertical", "Lift Vertical"] as const;
  const catalogue = { "MX Vertical": MX, "Lift Vertical": LIFT };

  it("has the four grip stations for each of the two vertical mice, nothing else", () => {
    expect(Object.keys(VERTICAL_SECTIONS).sort()).toEqual([...models].sort());
    for (const m of models) {
      expect(sectionsForModel(m)?.map((s) => s.ny)).toEqual([
        ...VERTICAL_SECTION_STATIONS,
      ]);
    }
    expect(sectionsForModel("G502 X")).toBeUndefined();
    expect(sectionsForModel("toString")).toBeUndefined();
    expect(sectionsForModel("__proto__")).toBeUndefined();
  });

  it("is internally consistent (geometry orderings that must hold)", () => {
    for (const m of models) {
      for (const s of sectionsForModel(m) ?? []) {
        for (const v of Object.values(s)) {
          expect(Number.isFinite(v) && v > 0).toBe(true);
        }
        // min Feret is the minimum over ALL directions, so <= both axis extents
        expect(s.minFeretMm).toBeLessThanOrEqual(
          Math.min(s.widthMm, s.heightMm),
        );
        expect(s.maxFeretMm).toBeGreaterThanOrEqual(
          Math.max(s.widthMm, s.heightMm),
        );
        // the minimum-area rectangle cannot be thinner than the min Feret
        expect(s.minRectShortMm).toBeGreaterThanOrEqual(s.minFeretMm - 0.01);
        expect(s.minRectLongMm).toBeGreaterThanOrEqual(s.minRectShortMm);
        // the contour is longer than its own longest caliper
        expect(s.outerGirthMm).toBeGreaterThan(s.maxFeretMm);
      }
    }
  });

  it("section extents do not exceed the catalogue size (shells are scaled to it)", () => {
    for (const m of models) {
      for (const s of sectionsForModel(m) ?? []) {
        expect(s.widthMm).toBeLessThanOrEqual(catalogue[m].widthMm + 0.1);
        expect(s.heightMm).toBeLessThanOrEqual(catalogue[m].heightMm + 0.1);
      }
    }
  });

  it("MX Vertical is bigger than Lift at every station in the quantities wiring B can use (not the rectangle long side, whose orientation flips)", () => {
    const mx = sectionsForModel("MX Vertical")!;
    const lift = sectionsForModel("Lift Vertical")!;
    for (let i = 0; i < 4; i++) {
      for (const k of [
        "widthMm",
        "heightMm",
        "outerGirthMm",
        "minFeretMm",
        "maxFeretMm",
        "minRectShortMm",
      ] as const) {
        expect(mx[i]![k]).toBeGreaterThan(lift[i]![k]);
      }
    }
  });
});
