/**
 * fit-v3.0 candidate (未拍板): the engine. Without references it differs from
 * v2 only by the grip-width factor (1.00) and the reversed palm-thickness
 * shift; with references it adds the personal calibration and the contract's
 * `calibration` block. The default engine stays v1.
 */
import { describe, expect, it } from "vitest";
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
  UNKNOWN_PRIOR_SCORE,
} from "../../src/server/fit/coefficients";
import {
  scoreFitDefault,
  scoreWithEngine,
  storedNullScore,
} from "../../src/server/fit/engine";
import { computePriors } from "../../src/server/fit/priors";
import { scoreFitV2 } from "../../src/server/fit/score-v2-candidate";
import {
  baseTargetsV3,
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

describe("engine dispatch", () => {
  it("DEFAULT_ENGINE is still v1, and the default path does not run v3", () => {
    expect(DEFAULT_ENGINE).toBe("v1");
    const m = hand(190, 65.7);
    expect(scoreFitDefault(m, seedCatalogue, NO_REFS, "right")).toEqual(
      scoreWithEngine("v1", m, seedCatalogue, NO_REFS, "right"),
    );
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

  it('"v3" stores the catalogue-mean prior of every sub-score, like v1 and v2', () => {
    const cat = [
      mouseRow({ slug: "a", frontFlare: "outward_slight", thumbRest: true }),
      mouseRow({ slug: "b", frontFlare: "outward_moderate", thumbRest: true }),
    ];
    const priors = computePriors(cat);
    const stored = storedNullScore("v3", cat);
    expect(stored("frontFlare", "claw")).toBe(priors.frontFlare.claw);
    expect(stored("thumb", "palm")).toBe(priors.thumb.palm);
    expect(stored("frontFlare", "claw")).not.toBe(UNKNOWN_PRIOR_SCORE);
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

  it("cross-check numbers (workbench): hand 190 / 65.7, no grip, G903 + G Pro 2 'just right'", () => {
    const d = out.calibration!.dims;
    expect(d.length.shiftMm).toBeCloseTo(4.7118, 3);
    expect(d.gripWidth.shiftMm).toBeCloseTo(-1.2557, 3);
    expect(d.height.shiftMm).toBeCloseTo(0.8927, 3);
    expect(out.gripStyle.used).toBe("claw");
    const rank = (r: typeof out, slug: string) =>
      r.results.find((e) => e.mouse.slug === slug)!.rank;
    expect(rank(base, "logitech-g-pro-2-lightspeed")).toBe(139);
    expect(rank(base, "logitech-g903-hero")).toBe(273);
    expect(rank(out, "logitech-g-pro-2-lightspeed")).toBe(42);
    expect(rank(out, "logitech-g903-hero")).toBe(189);
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
