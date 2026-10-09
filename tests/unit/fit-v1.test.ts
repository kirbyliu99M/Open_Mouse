import { describe, expect, it } from "vitest";
import seedRows from "../../src/db/seed/logitech.json";
import factsJson from "../../src/db/seed/logitech-facts.json";
import { GRIP_STYLES } from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import {
  DEFAULT_ENGINE,
  ENGINE_VERSION,
  ENGINE_VERSION_V1,
  GRIP_SOFTNESS,
  SIGMA_MEAS_MM,
  SIGMA_MM,
  UNKNOWN_PRIOR_SCORE,
} from "../../src/server/fit/coefficients";
import { scoreFitDefault } from "../../src/server/fit/engine";
import { excludeReasonV1 } from "../../src/server/fit/exclusions-v1";
import { argmaxGrip, gripWeights } from "../../src/server/fit/grip-weights";
import { computePriors } from "../../src/server/fit/priors";
import { scoreFit } from "../../src/server/fit/score";
import {
  compareRankKeys,
  scoreFitV1,
  type RankKey,
} from "../../src/server/fit/score-v1";
import { buildSeedCatalogue } from "../../src/server/fit/seed-catalogue";
import { palmLengthSweep, type EngineFn } from "../../src/server/fit/stability";
import { SIGMA_EFF, sigmaEff } from "../../src/server/fit/subscores-v1";
import type { CatalogueMouse } from "../../src/server/fit/types";
import golden from "./fixtures/fit-golden.json";

const seed = buildSeedCatalogue(
  seedRows as Parameters<typeof buildSeedCatalogue>[0],
  factsJson as Parameters<typeof buildSeedCatalogue>[1],
);

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
const prefs = { includeVertical: false } as const;
const hand: HandMeasurements = {
  handLengthMm: 185,
  palmLengthMm: 104,
  palmWidthMm: 76,
};
const noPriors = computePriors([]);

describe("v0 stays the default", () => {
  it("DEFAULT_ENGINE is v0 and the default engine is scoreFit, byte for byte", () => {
    expect(DEFAULT_ENGINE).toBe("v0");
    expect(ENGINE_VERSION).toBe("fit-v0-provisional");
    const args = [hand, seed, prefs, "right"] as const;
    expect(scoreFitDefault(...args)).toEqual(scoreFit(...args));
    expect(scoreFitDefault(...args).engineVersion).toBe("fit-v0-provisional");
  });
});

describe("gripWeights", () => {
  it.each([0.45, 0.5, 0.54, 0.56, 0.58, 0.6, 0.7])(
    "sums to 1 and is non-negative at r = %s",
    (r) => {
      const w = gripWeights(r);
      expect(w.palm + w.claw + w.fingertip).toBeCloseTo(1, 12);
      for (const g of GRIP_STYLES) expect(w[g]).toBeGreaterThanOrEqual(0);
    },
  );

  it.each(GRIP_STYLES)("a stated %s grip has weight 1 and the rest 0", (g) => {
    for (const r of [0.45, 0.56, 0.7]) {
      const w = gripWeights(r, g);
      expect(w[g]).toBe(1);
      expect(GRIP_STYLES.filter((x) => x !== g).every((x) => w[x] === 0)).toBe(
        true,
      );
    }
  });

  it("the arg-max follows v0's thresholds away from the boundaries", () => {
    expect(argmaxGrip(gripWeights(0.5))).toBe("fingertip");
    expect(argmaxGrip(gripWeights(0.56))).toBe("claw");
    expect(argmaxGrip(gripWeights(0.62))).toBe("palm");
  });

  it("is monotone: more palm weight and less fingertip weight as r grows", () => {
    let prev = gripWeights(0.45);
    for (let r = 0.451; r < 0.7; r += 0.005) {
      const w = gripWeights(r);
      expect(w.palm).toBeGreaterThanOrEqual(prev.palm);
      expect(w.fingertip).toBeLessThanOrEqual(prev.fingertip);
      prev = w;
    }
  });

  it("uses the softness constant by default", () => {
    expect(gripWeights(0.58).palm).toBeCloseTo(
      gripWeights(0.58, null, GRIP_SOFTNESS).palm,
      15,
    );
  });
});

describe("sigma_eff", () => {
  it("is sqrt(sigma^2 + (k * sigmaMeas)^2)", () => {
    expect(sigmaEff(6, 0.66, 6)).toBeCloseTo(Math.sqrt(36 + (0.66 * 6) ** 2));
    expect(sigmaEff(5, 0.88, 4)).toBeCloseTo(Math.sqrt(25 + (0.88 * 4) ** 2));
    expect(sigmaEff(3, 0.21, 6)).toBeCloseTo(Math.sqrt(9 + (0.21 * 6) ** 2));
  });

  it("uses the factor of the target's own grip and measurement", () => {
    expect(SIGMA_EFF.length("palm")).toBeCloseTo(
      Math.sqrt(SIGMA_MM.length ** 2 + (0.66 * SIGMA_MEAS_MM.handLength) ** 2),
    );
    expect(SIGMA_EFF.length("fingertip")).toBeLessThan(
      SIGMA_EFF.length("palm"),
    );
    expect(SIGMA_EFF.gripWidth()).toBeCloseTo(
      Math.sqrt(
        SIGMA_MM.gripWidth ** 2 + (0.88 * SIGMA_MEAS_MM.palmWidth) ** 2,
      ),
    );
    expect(SIGMA_EFF.height("claw")).toBeGreaterThan(SIGMA_MM.height);
  });

  it("widens the score: a miss scores higher than under plain sigma, and scores are unrounded", () => {
    const m = mouse({ lengthMm: 124 }); // claw target = 0.62 * 185 = 114.7
    const r = scoreFitV1(
      hand,
      [m],
      { ...prefs, gripStyle: "claw" },
      "right",
      noPriors,
    );
    const delta = 124 - 114.7;
    const plain = Math.round(100 * Math.exp(-0.5 * (delta / 6) ** 2));
    const lengthScore = r.results[0].subscores.length.score!;
    expect(lengthScore).toBeGreaterThan(plain);
    expect(lengthScore).toBe(
      Math.round(
        100 * Math.exp(-0.5 * (delta / SIGMA_EFF.length("claw")) ** 2),
      ),
    );
  });
});

describe("priors", () => {
  it("fall back to 75 when no row has the descriptor", () => {
    for (const priors of [computePriors([]), computePriors(seed)]) {
      for (const grip of GRIP_STYLES) {
        expect(priors.frontFlare[grip]).toBe(UNKNOWN_PRIOR_SCORE);
        expect(priors.thumb[grip]).toBe(UNKNOWN_PRIOR_SCORE);
        expect(priors.weight[grip]).toBe(UNKNOWN_PRIOR_SCORE);
      }
    }
  });

  it("is the mean of the sub-score over rows that have the descriptor", () => {
    const rows = [
      mouse({ frontFlare: "outward_slight", thumbRest: true }),
      mouse({ frontFlare: "flat", thumbRest: false }),
      mouse({ frontFlare: null, thumbRest: null }),
    ];
    const p = computePriors(rows);
    // claw/fingertip table: outward_slight 100, flat 80 → 90; palm table: 80, 80 → 80.
    expect(p.frontFlare.claw).toBe(90);
    expect(p.frontFlare.fingertip).toBe(90);
    expect(p.frontFlare.palm).toBe(80);
    // thumb palm: withRest 100, withoutRest 75 → 87.5; claw: 65, 85 → 75.
    expect(p.thumb.palm).toBe(87.5);
    expect(p.thumb.claw).toBe(75);
  });

  it("a null sub-score contributes the prior, and confidence still counts it as missing", () => {
    const priors = computePriors([
      mouse({ frontFlare: "outward_slight", thumbRest: true }),
      mouse({ frontFlare: "flat", thumbRest: false }),
    ]);
    const known = mouse({ frontFlare: "flat", thumbRest: false });
    const unknown = mouse({ slug: "acme-unknown", model: "Unknown" });
    const r = scoreFitV1(
      hand,
      [known, unknown],
      { ...prefs, gripStyle: "claw" },
      "right",
      priors,
    );
    const u = r.results.find((e) => e.mouse.slug === "acme-unknown")!;
    expect(u.subscores.frontFlare.score).toBeNull();
    expect(u.confidence).toBeLessThan(
      r.results.find((e) => e.mouse.slug === "acme-alpha")!.confidence,
    );
    // Its flare and thumb parts equal the catalogue means (90 and 75 for claw).
    const lengthPart = u.subscores.length.score! * 0.3;
    const widthWeight = u.subscores.gripWidth.weight; // halved: curvature unknown
    const widthPart = u.subscores.gripWidth.score! * widthWeight;
    const heightPart = u.subscores.heightHump.score! * 0.2;
    const sum = lengthPart + widthPart + heightPart + 90 * 0.1 + 75 * 0.1;
    const expected = sum / (0.3 + widthWeight + 0.2 + 0.1 + 0.1);
    expect(Math.abs(u.total - expected)).toBeLessThan(1);
  });
});

describe("exclusions", () => {
  it("wrong hand comes first", () => {
    expect(
      excludeReasonV1(
        mouse({ handCompatibility: "left", formFactor: "trackball" }),
        "right",
        prefs,
      ),
    ).toBe("wrong_hand");
  });

  it("trackballs are excluded unless allowed; absent form factor is standard", () => {
    expect(
      excludeReasonV1(mouse({ formFactor: "trackball" }), "right", prefs),
    ).toBe("trackball_form_factor");
    expect(
      excludeReasonV1(mouse({ formFactor: "trackball" }), "right", prefs, {
        allowTrackball: true,
      }),
    ).toBeNull();
    expect(excludeReasonV1(mouse({}), "right", prefs)).toBeNull();
    expect(
      excludeReasonV1(mouse({ formFactor: "standard" }), "right", prefs),
    ).toBeNull();
  });

  it("vertical is the form factor or the height ratio, unless includeVertical", () => {
    expect(
      excludeReasonV1(mouse({ formFactor: "vertical" }), "right", prefs),
    ).toBe("vertical_form_factor");
    expect(
      excludeReasonV1(mouse({ heightMm: 70, lengthMm: 120 }), "right", prefs),
    ).toBe("vertical_form_factor");
    expect(
      excludeReasonV1(mouse({ formFactor: "vertical" }), "right", {
        includeVertical: true,
      }),
    ).toBeNull();
  });
});

describe("tie-break order", () => {
  const key = (patch: Partial<RankKey>): RankKey => ({
    totalRaw: 80,
    confidence: 0.5,
    lengthAbsDelta: 2,
    model: "M",
    ...patch,
  });
  const order = (keys: RankKey[]) =>
    [...keys].sort(compareRankKeys).map((k) => k.model);

  it("unrounded total decides first, even when the rounded totals are equal", () => {
    expect(
      order([
        key({ model: "low", totalRaw: 79.6, confidence: 1, lengthAbsDelta: 0 }),
        key({ model: "high", totalRaw: 80.4 }),
      ]),
    ).toEqual(["high", "low"]);
  });

  it("then confidence (higher first)", () => {
    expect(
      order([
        key({ model: "a", confidence: 0.4, lengthAbsDelta: 0 }),
        key({ model: "z", confidence: 0.9 }),
      ]),
    ).toEqual(["z", "a"]);
  });

  it("then the smaller |length delta|", () => {
    expect(
      order([
        key({ model: "a", lengthAbsDelta: 4 }),
        key({ model: "z", lengthAbsDelta: 1 }),
      ]),
    ).toEqual(["z", "a"]);
  });

  it("then model name ascending", () => {
    expect(order([key({ model: "Bravo" }), key({ model: "Alpha" })])).toEqual([
      "Alpha",
      "Bravo",
    ]);
  });

  it("treats float noise in |length delta| as a tie, so the model name decides", () => {
    expect(
      order([
        key({ model: "b", lengthAbsDelta: 2 }),
        key({ model: "a", lengthAbsDelta: 2 + 1e-12 }),
      ]),
    ).toEqual(["a", "b"]);
  });

  it("treats float noise in the total as a tie", () => {
    expect(
      order([
        key({ model: "b", totalRaw: 80 + 1e-12 }),
        key({ model: "a", totalRaw: 80 }),
      ]),
    ).toEqual(["a", "b"]);
  });

  it("the engine applies it: mirrored length misses tie, so the model name decides after the exact fit", () => {
    const priors = computePriors([]);
    const target = 0.62 * hand.handLengthMm;
    const r = scoreFitV1(
      hand,
      [
        mouse({ slug: "x-short", model: "Zzz", lengthMm: target - 2 }),
        mouse({ slug: "x-long", model: "Aaa", lengthMm: target + 2 }),
        mouse({ slug: "x-exact", model: "Mmm", lengthMm: target }),
      ],
      { ...prefs, gripStyle: "claw" },
      "right",
      priors,
    );
    expect(r.results.map((e) => e.mouse.slug)).toEqual([
      "x-exact",
      "x-long",
      "x-short",
    ]);
  });

  it("the engine applies it: at equal totals the more confident mouse goes first", () => {
    const known = mouse({
      slug: "x-known",
      model: "Zulu",
      frontFlare: "flat",
      thumbRest: false,
      ringFingerRest: null,
    });
    const unknown = mouse({ slug: "x-unknown", model: "Alpha" });
    // The unknown mouse takes the known one's own flare and thumb scores as
    // its prior, so the totals match.
    const r = scoreFitV1(
      hand,
      [unknown, known],
      { ...prefs, gripStyle: "claw" },
      "right",
      computePriors([known]),
    );
    expect(r.results.map((e) => e.mouse.slug)).toEqual([
      "x-known",
      "x-unknown",
    ]);
  });
});

describe("continuity in palm length", () => {
  const goldenHands = Object.values(golden) as {
    hand: "left" | "right";
    measurements: HandMeasurements;
  }[];
  const priors = computePriors(seed);
  const v1: EngineFn = (m, c, p, h) => scoreFitV1(m, c, p, h, priors);

  it.each(goldenHands.map((g, i) => [Object.keys(golden)[i], g] as const))(
    "%s: no mouse's v1 total jumps more than 2 points per 0.5 mm of palm length over r in [0.50, 0.62]",
    (_n, g) => {
      const sweep = palmLengthSweep(v1, seed, g.hand, g.measurements);
      expect(sweep.maxJump).toBeLessThanOrEqual(2);
    },
  );

  it("v0's sweep runs (its jump is reported by scripts/fit-stability.ts, not asserted)", () => {
    const worst = Math.max(
      ...goldenHands.map(
        (g) => palmLengthSweep(scoreFit, seed, g.hand, g.measurements).maxJump,
      ),
    );
    expect(Number.isFinite(worst)).toBe(true);
  });
});

describe("engine version", () => {
  it("labels itself fit-v1-candidate", () => {
    expect(ENGINE_VERSION_V1).toBe("fit-v1-candidate");
    expect(
      scoreFitV1(hand, seed, prefs, "right", computePriors(seed)).engineVersion,
    ).toBe("fit-v1-candidate");
  });

  it("omits gripStyle.weights when a grip is stated, includes them otherwise", () => {
    const priors = computePriors(seed);
    expect(
      scoreFitV1(hand, seed, { ...prefs, gripStyle: "palm" }, "right", priors)
        .gripStyle,
    ).toEqual({ stated: "palm", predicted: "claw", used: "palm" });
    expect(
      scoreFitV1(hand, seed, prefs, "right", priors).gripStyle.weights,
    ).toBeDefined();
  });
});
