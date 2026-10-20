/**
 * fit-v3.0 candidate (未拍板): the engine. Without references it differs from
 * v2 only by the grip-width factor (1.00) and the reversed palm-thickness
 * shift; with references it adds the personal calibration and the contract's
 * `calibration` block. The default engine stays v1.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GRIP_STYLES,
  fitCalibrationSchema,
  fitPreferencesSchema,
  fitResponseSchema,
  type FitPreferences,
  type FitReference,
} from "../../src/lib/contracts/fit";
import type { PalmThicknessLevel } from "../../src/lib/contracts/measurement";
import {
  DEFAULT_ENGINE,
  ENGINE_VERSION_V3,
  GRIP_WIDTH_FACTOR,
  GRIP_WIDTH_FACTOR_V3,
} from "../../src/server/fit/coefficients";
import { scoreFitDefault, scoreWithEngine } from "../../src/server/fit/engine";
import { gaussianRaw } from "../../src/server/fit/subscores-v1";
import { computePriors } from "../../src/server/fit/priors";
import { calibrateV3 } from "../../src/server/fit/calibration-v3-candidate";
import { planV2, scoreFitV2 } from "../../src/server/fit/score-v2-candidate";
import {
  baseTargetsV3,
  gripStateV3,
  scoreFitV3,
} from "../../src/server/fit/score-v3-candidate";
import { groupShells } from "../../src/server/fit/shell-groups";
import {
  deepFreeze,
  hand,
  mouseRow,
  seedCatalogue,
  seedPriors,
  withoutVersion,
} from "./fit-v2c-fixtures";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";

function ref(
  slug: string,
  feel: Partial<FitReference["feel"]> = {},
  extra: Partial<FitReference> = {},
): FitReference {
  return {
    slug,
    grips: [],
    feel: { length: null, width: null, height: null, ...feel },
    specialUse: false,
    ...extra,
  };
}

const v3 = (
  m: ReturnType<typeof hand>,
  prefs: FitPreferences,
  catalogue = seedCatalogue,
  side: "left" | "right" = "right",
) => scoreFitV3(m, catalogue, prefs, side, computePriors(catalogue));

const v2 = (m: ReturnType<typeof hand>, prefs: FitPreferences) =>
  scoreFitV2(m, seedCatalogue, prefs, "right", seedPriors);

const NO_REFS: FitPreferences = { includeVertical: false };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("engine dispatch", () => {
  it("DEFAULT_ENGINE is still v1: with FIT_ENGINE unset the default path does not run v3, and FIT_ENGINE=v3 does", () => {
    expect(DEFAULT_ENGINE).toBe("v1");
    const m = hand(190, 65.7);
    vi.stubEnv("FIT_ENGINE", "");
    expect(scoreFitDefault(m, seedCatalogue, NO_REFS, "right")).toEqual(
      scoreWithEngine("v1", m, seedCatalogue, NO_REFS, "right"),
    );
    vi.stubEnv("FIT_ENGINE", "v3");
    expect(scoreFitDefault(m, seedCatalogue, NO_REFS, "right")).toEqual(
      scoreWithEngine("v3", m, seedCatalogue, NO_REFS, "right"),
    );
    vi.unstubAllEnvs();
  });

  it('"v3" runs the candidate and reports its version', () => {
    const m = hand(190, 65.7);
    expect(ENGINE_VERSION_V3).toBe("fit-v3.0-candidate.0");
    const out = scoreWithEngine("v3", m, seedCatalogue, NO_REFS, "right");
    expect(out.engineVersion).toBe("fit-v3.0-candidate.0");
    expect(out).toEqual(v3(m, NO_REFS));
    // Rank stability is a separate step.
    expect(out.results.some((e) => "rankStability" in e)).toBe(false);
  });
});

describe("without references: v2 plus the width factor and the thickness sign", () => {
  const m = hand(190, 65.7);

  it("the grip-width target is palmWidth x 1.00 (v2: 0.88)", () => {
    expect(GRIP_WIDTH_FACTOR_V3).toBe(1);
    expect(GRIP_WIDTH_FACTOR).toBe(0.88);
    const a = v3(m, NO_REFS);
    const b = v2(m, NO_REFS);
    expect(a.targets.gripWidthMm).toBeCloseTo(65.7, 9);
    expect(b.targets.gripWidthMm).toBeCloseTo(65.7 * 0.88, 9);
    // length and height are v2's
    expect(a.targets.lengthMm).toBe(b.targets.lengthMm);
    expect(a.targets.heightMm).toBe(b.targets.heightMm);
  });

  it("the grip-width error spread follows each engine's own factor (A1-06)", () => {
    // sigma_eff = sqrt(5^2 + (k * 4)^2): v3 k = 1.00, v1/v2 k = 0.88.
    const sigmaV3 = Math.sqrt(5 ** 2 + (GRIP_WIDTH_FACTOR_V3 * 4) ** 2);
    const sigmaV2 = Math.sqrt(5 ** 2 + (GRIP_WIDTH_FACTOR * 4) ** 2);
    expect(sigmaV3).toBeCloseTo(6.403124, 6);
    expect(sigmaV2).toBeCloseTo(6.114769, 6);
    const check = (
      entries: ReturnType<typeof v3>["results"],
      sigma: number,
    ) => {
      let checked = 0;
      for (const e of entries) {
        const { score, reason } = e.subscores.gripWidth;
        if (score === null) continue;
        const delta = reason.params.deltaMm!;
        // Far-off mice score 0 either way; the near ones tell the sigmas apart.
        expect(score).toBe(Math.round(gaussianRaw(delta, sigma)));
        if (Math.abs(delta) > 4) checked += 1;
      }
      expect(checked).toBeGreaterThan(10);
    };
    check(v3(m, NO_REFS).results, sigmaV3);
    check(v2(m, NO_REFS).results, sigmaV2);
  });

  it("thick lowers the height target by 1.5 mm, thin raises it, no answer leaves it", () => {
    const heightOf = (level?: PalmThicknessLevel) =>
      v3(m, { ...NO_REFS, ...(level ? { palmThickness: level } : {}) }).targets
        .heightMm;
    const none = heightOf();
    expect(heightOf("thick")).toBeCloseTo(none - 1.5, 9);
    expect(heightOf("thin")).toBeCloseTo(none + 1.5, 9);
    expect(heightOf("medium")).toBe(none);
    // against v2 (v1's sign): thick is 3 mm LOWER, thin 3 mm HIGHER
    const v2Height = (level: PalmThicknessLevel) =>
      v2(m, { ...NO_REFS, palmThickness: level }).targets.heightMm;
    expect(heightOf("thick")).toBeCloseTo(v2Height("thick") - 3, 9);
    expect(heightOf("thin")).toBeCloseTo(v2Height("thin") + 3, 9);
  });

  it("the thickness shift reaches all three grips, and the base targets show it", () => {
    const thick = baseTargetsV3(m, "thick");
    const none = baseTargetsV3(m, undefined);
    for (const g of GRIP_STYLES) {
      expect(thick[g].heightMm).toBeCloseTo(none[g].heightMm - 1.5, 9);
      expect(thick[g].lengthMm).toBe(none[g].lengthMm);
    }
  });

  it("no calibration key, and the grip, exclusions and coverage are v2's", () => {
    for (const grip of [undefined, ...GRIP_STYLES]) {
      const prefs: FitPreferences = {
        includeVertical: false,
        ...(grip ? { gripStyle: grip } : {}),
      };
      const a = v3(m, prefs);
      const b = v2(m, prefs);
      expect(a).not.toHaveProperty("calibration");
      expect(a.gripStyle).toEqual(b.gripStyle);
      expect(a.excluded.map((e) => e.slug)).toEqual(
        b.excluded.map((e) => e.slug),
      );
      expect(a.coverage).toEqual(b.coverage);
      expect(a.handType).toEqual(b.handType);
      expect(a.results).toHaveLength(b.results.length);
    }
  });

  it("an empty references list is the same as none", () => {
    expect(v3(m, { ...NO_REFS, references: [] })).toEqual(v3(m, NO_REFS));
  });

  it("changes the ranking only through width: a catalogue of mice equal but for width", () => {
    // 62 vs 66 mm wide, same everything else; palm 65.7 -> v3 prefers 66,
    // v2 (target 57.8) prefers 62.
    const cat = [
      mouseRow({ slug: "acme-narrow", model: "Narrow", widthMm: 62 }),
      mouseRow({ slug: "acme-wide", model: "Wide", widthMm: 66 }),
    ];
    const a = v3(m, NO_REFS, cat);
    const b = scoreFitV2(m, cat, NO_REFS, "right", computePriors(cat));
    expect(a.results[0]!.mouse.slug).toBe("acme-wide");
    expect(b.results[0]!.mouse.slug).toBe("acme-narrow");
  });

  it("keeps v2's clamp: an out-of-range hand is reported and the displayed targets are true", () => {
    const big = hand(250, 87.5);
    const a = v3(big, NO_REFS);
    expect(a.coverage?.lengthOutOfRange).toBe(true);
    expect(a.coverage?.direction).toBe("above");
    expect(a.coverage?.usedGripLengthTargetMm).toBe(a.targets.lengthMm);
    const max = a.coverage!.catalogueLengthRangeMm[1];
    expect(a.targets.lengthMm).toBeGreaterThan(max);
  });

  it("does not change its arguments", () => {
    const prefs = deepFreeze<FitPreferences>({
      includeVertical: false,
      palmThickness: "thick",
      references: [ref("logitech-g903-hero", { length: 0 })],
    });
    const frozenHand = deepFreeze(hand(190, 65.7));
    expect(() => v3(frozenHand, prefs)).not.toThrow();
  });
});

describe("with references", () => {
  const m = hand(190, 65.7, 0.56);
  const refs = ["logitech-g903-hero", "logitech-g-pro-2-lightspeed"].map(
    (slug) =>
      ref(
        slug,
        { length: 0, width: 0, height: 0 },
        { grips: ["palm", "claw"] },
      ),
  );
  const prefs: FitPreferences = { includeVertical: false, references: refs };
  const out = v3(m, prefs);
  const base = v3(m, NO_REFS);

  it("the request parses, and the calibration block passes the contract", () => {
    expect(fitPreferencesSchema.safeParse(prefs).success).toBe(true);
    expect(out.calibration).toBeDefined();
    expect(fitCalibrationSchema.safeParse(out.calibration).success).toBe(true);
    expect(
      fitResponseSchema.safeParse({ scanId: SCAN_ID, ...out }).success,
    ).toBe(true);
    expect(
      fitResponseSchema.safeParse({
        scanId: SCAN_ID,
        ...out,
        results: groupShells(out.results, seedCatalogue),
      }).success,
    ).toBe(true);
  });

  it("the targets already include the offsets", () => {
    const dims = out.calibration!.dims;
    expect(out.targets.lengthMm).toBeCloseTo(
      base.targets.lengthMm + dims.length.shiftMm,
      9,
    );
    expect(out.targets.gripWidthMm).toBeCloseTo(
      base.targets.gripWidthMm + dims.gripWidth.shiftMm,
      9,
    );
    expect(out.targets.heightMm).toBeCloseTo(
      base.targets.heightMm + dims.height.shiftMm,
      9,
    );
  });

  it("two 'just right' mice larger than the ideal pull the targets up in length", () => {
    // G903 130 mm and G Pro 2 125 mm against a 117.8 mm claw target
    expect(out.calibration!.dims.length.shiftMm).toBeGreaterThan(1);
    expect(out.calibration!.referencesUsed).toBe(2);
    for (const d of Object.values(out.calibration!.dims)) {
      expect(d.answers).toBe(2);
      expect(d.conflict).toBe(false);
    }
  });

  // CATALOGUE-DEPENDENT GOLDEN. The three shifts depend on the two mice's sizes
  // and the hand; the ranks below also depend on the whole checked-in seed
  // catalogue (src/db/seed/*) and its descriptors. When the seed changes
  // (a mouse added, a size or descriptor corrected), the ranks are expected to
  // move: re-run the cross-check against the workbench, then update the
  // numbers here. The shifts only move if those two mice or the hand change.
  it("catalogue-dependent golden (workbench cross-check): hand 190 / 65.7, no grip, G903 + G Pro 2 'just right'", () => {
    const d = out.calibration!.dims;
    expect(d.length.shiftMm).toBeCloseTo(4.7118, 3);
    expect(d.gripWidth.shiftMm).toBeCloseTo(-1.2557, 3);
    expect(d.height.shiftMm).toBeCloseTo(0.8927, 3);
    expect(out.gripStyle.used).toBe("claw");
    const rank = (r: typeof out, slug: string) =>
      r.results.find((e) => e.mouse.slug === slug)!.rank;
    expect(rank(base, "logitech-g-pro-2-lightspeed")).toBe(139);
    expect(rank(base, "logitech-g903-hero")).toBe(273);
    // A1-06: v3's grip-width error spread now follows v3's 1.00 palm-width
    // factor (sqrt(5^2 + (1.00 * 4)^2) = 6.403124 mm, was 6.114769 with v1's
    // 0.88), which moved these ranks: G Pro 2 42 -> 45, G903 189 -> 196. The
    // base ranks and the shifts above did not move.
    expect(rank(out, "logitech-g-pro-2-lightspeed")).toBe(45);
    expect(rank(out, "logitech-g903-hero")).toBe(196);
  });

  it("references only change the targets and the order, never the set of mice or the version", () => {
    expect(out.engineVersion).toBe(base.engineVersion);
    expect(out.excluded.map((e) => e.slug)).toEqual(
      base.excluded.map((e) => e.slug),
    );
    expect(out.results.map((e) => e.mouse.slug).sort()).toEqual(
      base.results.map((e) => e.mouse.slug).sort(),
    );
    expect(out.gripStyle).toEqual(base.gripStyle);
  });

  it("references that are all ignored give a calibration with no shift and the base ranking", () => {
    const ignored = v3(m, {
      includeVertical: false,
      references: [
        ref("logitech-g903-hero", { length: 1 }, { specialUse: true }),
        ref("no-such-mouse", { length: 1 }),
      ],
    });
    expect(ignored.calibration).toEqual({
      referencesUsed: 0,
      dims: {
        length: { shiftMm: 0, answers: 0, conflict: false },
        gripWidth: { shiftMm: 0, answers: 0, conflict: false },
        height: { shiftMm: 0, answers: 0, conflict: false },
      },
    });
    const { calibration: _c, ...rest } = ignored;
    void _c;
    expect(rest).toEqual(base);
  });

  it("a conflict leaves that target uncalibrated", () => {
    const conflicting = v3(m, {
      includeVertical: false,
      references: [
        // 130 mm called short and 100-ish mm called long cannot both hold
        ref("logitech-g903-hero", { length: -1 }),
        ref("logitech-g-pro-2-lightspeed", { length: 1 }),
      ],
    });
    // G903 (130) "short" needs the ideal above 136; G Pro 2 (125) "long" below 119
    expect(conflicting.calibration!.dims.length.conflict).toBe(true);
    expect(conflicting.calibration!.dims.length.shiftMm).toBe(0);
    expect(conflicting.targets.lengthMm).toBe(base.targets.lengthMm);
  });

  it("v1 and v2 ignore references and score as before", () => {
    const plain = hand(190, 65.7);
    expect(
      withoutVersion(
        scoreFitV2(plain, seedCatalogue, prefs, "right", seedPriors),
      ),
    ).toEqual(
      withoutVersion(
        scoreFitV2(plain, seedCatalogue, NO_REFS, "right", seedPriors),
      ),
    );
    expect(scoreWithEngine("v1", plain, seedCatalogue, prefs, "right")).toEqual(
      scoreWithEngine("v1", plain, seedCatalogue, NO_REFS, "right"),
    );
    expect(
      scoreWithEngine("v2", plain, seedCatalogue, prefs, "right"),
    ).not.toHaveProperty("calibration");
  });

  it("is deterministic", () => {
    expect(v3(m, prefs)).toEqual(out);
  });
});

describe("calibrate, then clamp (references with a hand outside the catalogue range)", () => {
  const RANGE = planV2(seedCatalogue, "right", NO_REFS).lengthRangeMm!;
  const lengthOnly = (feel: -1 | 0 | 1): FitReference[] =>
    ["logitech-g903-hero", "logitech-g-pro-2-lightspeed"].map((slug) =>
      ref(slug, { length: feel }, { grips: ["claw"] }),
    );
  const claw = (references?: FitReference[]): FitPreferences => ({
    includeVertical: false,
    gripStyle: "claw",
    ...(references ? { references } : {}),
  });

  it("the catalogue range is what the tests below assume", () => {
    expect(RANGE[0]).toBeCloseTo(70.4, 9);
    expect(RANGE[1]).toBeCloseTo(138.4, 9);
  });

  it("a hand far above the range: targets = base + shift (unclamped), ranking on the top edge", () => {
    const m = hand(250, 87.5); // claw target 155 mm, above 138.4
    const refs = lengthOnly(-1); // "too short" pushes the target up again
    const base = v3(m, claw());
    const out = v3(m, claw(refs));
    const shift = out.calibration!.dims.length.shiftMm;
    expect(shift).not.toBe(0);
    expect(out.targets.lengthMm).toBeCloseTo(base.targets.lengthMm + shift, 9);
    expect(out.targets.lengthMm).toBeGreaterThan(RANGE[1]);
    expect(out.coverage).toMatchObject({
      lengthOutOfRange: true,
      direction: "above",
      usedGripLengthTargetMm: out.targets.lengthMm,
    });
    expect(out.coverage!.usedGripLengthTargetMm).toBe(out.targets.lengthMm);
    // The ranking used the clamped length: the state says so, and a run that
    // differs only in an (also out-of-range) length shift ranks identically.
    const plan = planV2(seedCatalogue, "right", claw(refs));
    const state = gripStateV3(m, seedCatalogue, claw(refs), plan);
    expect(state.ranking.targetsByGrip.claw.lengthMm).toBe(RANGE[1]);
    expect(state.trueTargets.claw.lengthMm).toBeCloseTo(
      base.targets.lengthMm + shift,
      9,
    );
    const rankingOf = (r: typeof out) =>
      r.results.map((e) => [e.mouse.slug, e.total, e.confidence]);
    expect(rankingOf(out)).toEqual(rankingOf(base));
  });

  it("a hand far below the range: ranking on the bottom edge, direction below", () => {
    const m = hand(100, 50); // claw target 62 mm, below 70.4
    const refs = lengthOnly(1); // "too long" pulls the target further down
    const base = v3(m, claw());
    const out = v3(m, claw(refs));
    const shift = out.calibration!.dims.length.shiftMm;
    expect(shift).toBeLessThan(0);
    expect(out.targets.lengthMm).toBeCloseTo(base.targets.lengthMm + shift, 9);
    expect(out.coverage).toMatchObject({
      lengthOutOfRange: true,
      direction: "below",
      usedGripLengthTargetMm: out.targets.lengthMm,
    });
    const state = gripStateV3(
      m,
      seedCatalogue,
      claw(refs),
      planV2(seedCatalogue, "right", claw(refs)),
    );
    expect(state.ranking.targetsByGrip.claw.lengthMm).toBe(RANGE[0]);
    const rankingOf = (r: typeof out) =>
      r.results.map((e) => [e.mouse.slug, e.total]);
    expect(rankingOf(out)).toEqual(rankingOf(base));
  });

  it("the shift can carry an in-range target out of range: clamp comes after calibration", () => {
    const m = hand(215, 75); // claw target 133.3 mm, inside [70.4, 138.4]
    const base = v3(m, claw());
    expect(base.coverage?.lengthOutOfRange).toBe(false);
    // Both mice are shorter than the ideal and called "short"
    // (G903 130 mm, G Pro 2 125 mm): the target goes up.
    const out = v3(m, claw(lengthOnly(-1)));
    const shift = out.calibration!.dims.length.shiftMm;
    expect(base.targets.lengthMm + shift).toBeGreaterThan(RANGE[1]);
    expect(out.targets.lengthMm).toBeCloseTo(base.targets.lengthMm + shift, 9);
    expect(out.coverage).toMatchObject({
      lengthOutOfRange: true,
      direction: "above",
      usedGripLengthTargetMm: out.targets.lengthMm,
    });
  });

  it("a shift that brings an out-of-range hand back in range removes the coverage flag", () => {
    const inRange = v3(hand(222, 78), claw()); // claw target 137.6
    expect(inRange.coverage?.lengthOutOfRange).toBe(false);
    const m2 = hand(224, 78); // claw 138.9: just above 138.4
    expect(v3(m2, claw()).coverage?.lengthOutOfRange).toBe(true);
    // "too long" mice lower the target back below the top edge.
    const back = v3(m2, claw(lengthOnly(1)));
    expect(back.calibration!.dims.length.shiftMm).toBeLessThan(0);
    expect(back.coverage?.lengthOutOfRange).toBe(false);
    expect(back.coverage?.direction).toBeNull();
  });
});

describe("palm thickness together with references", () => {
  const m = hand(190, 65.7);
  // G903 is 40 mm high; the claw height target is a little under it.
  const heightRef = ref(
    "logitech-g903-hero",
    { height: 0 },
    { grips: ["claw"] },
  );
  const prefs = (thickness?: PalmThicknessLevel): FitPreferences => ({
    includeVertical: false,
    gripStyle: "claw",
    references: [heightRef],
    ...(thickness ? { palmThickness: thickness } : {}),
  });
  const stateOf = (thickness?: PalmThicknessLevel) =>
    gripStateV3(
      m,
      seedCatalogue,
      prefs(thickness),
      planV2(seedCatalogue, "right", prefs(thickness)),
    );

  it("the calibration baseline already carries the reversed thickness shift", () => {
    const none = v3(m, prefs());
    const thick = v3(m, prefs("thick"));
    // thick: base height 1.5 mm lower, before any offset
    expect(stateOf("thick").baseTargets.claw.heightMm).toBeCloseTo(
      stateOf().baseTargets.claw.heightMm - 1.5,
      9,
    );
    // the offset is computed against that lowered baseline...
    const expected = calibrateV3(
      [heightRef],
      seedCatalogue,
      baseTargetsV3(m, "thick"),
      "claw",
    ).shiftsMm.height;
    expect(thick.calibration!.dims.height.shiftMm).toBe(expected);
    // ...so it differs from the offset against the un-shifted baseline
    // (a mouse above a lower target pulls it up further)...
    expect(thick.calibration!.dims.height.shiftMm).toBeGreaterThan(
      none.calibration!.dims.height.shiftMm,
    );
    // ...and the final height target is baseline + offset.
    expect(thick.targets.heightMm).toBeCloseTo(
      baseTargetsV3(m, "thick").claw.heightMm + expected,
      9,
    );
  });

  it("thin works the other way: baseline 1.5 mm higher", () => {
    expect(stateOf("thin").baseTargets.claw.heightMm).toBeCloseTo(
      stateOf().baseTargets.claw.heightMm + 1.5,
      9,
    );
  });
});

describe("gripStateV3", () => {
  const m = hand(190, 65.7, 0.56);
  const stateOf = (
    prefs: FitPreferences,
    measurements = m,
    catalogue = seedCatalogue,
  ) =>
    gripStateV3(
      measurements,
      catalogue,
      prefs,
      planV2(catalogue, "right", prefs),
    );

  it("a stated grip has weight 1, and `predicted` is still the soft arg-max", () => {
    const s = stateOf({ includeVertical: false, gripStyle: "fingertip" });
    expect(s.stated).toBe("fingertip");
    expect(s.used).toBe("fingertip");
    expect(s.weights).toEqual({ palm: 0, claw: 0, fingertip: 1 });
    expect(s.ranking.gripsInPlay).toEqual(["fingertip"]);
    expect(s.predicted).toBe("claw"); // r = 0.56
  });

  it("no stated grip: equal weights, all three in play, used = predicted", () => {
    const s = stateOf(NO_REFS);
    expect(s.stated).toBeNull();
    expect(s.used).toBe(s.predicted);
    for (const g of GRIP_STYLES) expect(s.weights[g]).toBeCloseTo(1 / 3, 12);
    expect(s.ranking.gripsInPlay).toEqual([...GRIP_STYLES]);
  });

  it("equalWeightsWhenUnknown: false falls back to v1's soft weights", () => {
    const s = gripStateV3(
      m,
      seedCatalogue,
      NO_REFS,
      planV2(seedCatalogue, "right", NO_REFS),
      { equalWeightsWhenUnknown: false },
    );
    expect(s.weights.claw).toBeGreaterThan(s.weights.palm);
    expect(s.weights.palm + s.weights.claw + s.weights.fingertip).toBeCloseTo(
      1,
      12,
    );
  });

  it("without references: no calibration and true targets are the base targets", () => {
    const s = stateOf({ includeVertical: false, palmThickness: "thick" });
    expect(s.calibration).toBeNull();
    expect(s.trueTargets).toEqual(s.baseTargets);
    expect(s.baseTargets).toEqual(baseTargetsV3(m, "thick"));
    expect(s.clampApplied).toBe(true);
    expect(s.clamped).toEqual({ palm: null, claw: null, fingertip: null });
  });

  it("with references: every grip's three targets get the same offsets; in range, ranking = true targets", () => {
    const refs = [
      ref("logitech-g903-hero", { length: 0, width: 0, height: 0 }),
    ];
    const s = stateOf({ includeVertical: false, references: refs });
    const dims = s.calibration!.dims;
    for (const g of GRIP_STYLES) {
      expect(s.trueTargets[g].lengthMm).toBeCloseTo(
        s.baseTargets[g].lengthMm + dims.length.shiftMm,
        9,
      );
      expect(s.trueTargets[g].gripWidthMm).toBeCloseTo(
        s.baseTargets[g].gripWidthMm + dims.gripWidth.shiftMm,
        9,
      );
      expect(s.trueTargets[g].heightMm).toBeCloseTo(
        s.baseTargets[g].heightMm + dims.height.shiftMm,
        9,
      );
    }
    expect(s.ranking.targetsByGrip).toEqual(s.trueTargets);
  });

  it("an out-of-range hand clamps the ranking length per grip in play, not the true target", () => {
    const [min, max] = planV2(seedCatalogue, "right", NO_REFS).lengthRangeMm!;
    const big = stateOf(NO_REFS, hand(250, 87.5));
    expect(big.clamped).toEqual({
      palm: "above",
      claw: "above",
      fingertip: "above",
    });
    for (const g of GRIP_STYLES) {
      expect(big.ranking.targetsByGrip[g].lengthMm).toBe(max);
      expect(big.trueTargets[g].lengthMm).toBeGreaterThan(max);
    }
    const small = stateOf(
      { includeVertical: false, gripStyle: "fingertip" },
      hand(100, 50),
    );
    expect(small.clamped.fingertip).toBe("below");
    expect(small.clamped.palm).toBeNull(); // not in play: left alone
    expect(small.ranking.targetsByGrip.fingertip.lengthMm).toBe(min);
  });

  it("nothing rankable: no range, no clamp", () => {
    const s = stateOf(NO_REFS, hand(250, 87.5), []);
    expect(s.clampApplied).toBe(false);
    expect(s.clamped).toEqual({ palm: null, claw: null, fingertip: null });
    expect(s.ranking.targetsByGrip).toEqual(s.trueTargets);
  });
});
