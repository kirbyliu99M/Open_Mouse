import { describe, expect, it } from "vitest";
import { excludeReason } from "../../src/server/fit/exclusions";
import type { CatalogueMouse } from "../../src/server/fit/types";
import {
  isVerticalFormFactor,
  scoreVerticalCandidate,
  type VerticalCandidateResult,
  type VerticalHandInput,
  type VerticalMouseInput,
} from "../../src/server/fit/vertical-candidate";
import {
  VERTICAL_CONFIG_A,
  VERTICAL_CONFIG_B,
  type VerticalCandidateConfig,
} from "../../src/server/fit/vertical-candidate-constants";

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
