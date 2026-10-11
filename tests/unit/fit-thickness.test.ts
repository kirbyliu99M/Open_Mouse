import { beforeAll, describe, expect, it } from "vitest";
import seedRows from "../../src/db/seed/logitech.json";
import factsJson from "../../src/db/seed/logitech-facts.json";
import {
  GRIP_STYLES,
  fitPreferencesSchema,
  type FitPreferences,
} from "../../src/lib/contracts/fit";
import {
  PALM_THICKNESS_LEVELS,
  type HandMeasurements,
} from "../../src/lib/contracts/measurement";
import {
  ENGINE_VERSION_V1,
  GRIP_WIDTH_FACTOR,
  HEIGHT_FACTOR,
  LENGTH_FACTOR,
  THICKNESS_HEIGHT_SHIFT_MM,
} from "../../src/server/fit/coefficients";
import { scoreWithEngine } from "../../src/server/fit/engine";
import { gripWeights } from "../../src/server/fit/grip-weights";
import { computePriors } from "../../src/server/fit/priors";
import { scoreFit } from "../../src/server/fit/score";
import { scoreFitV1 } from "../../src/server/fit/score-v1";
import { buildSeedCatalogue } from "../../src/server/fit/seed-catalogue";
import {
  THICKNESS_ANSWERS,
  palmLengthSweep,
  thicknessRuns,
  withThickness,
  type EngineFn,
} from "../../src/server/fit/stability";
import { buildStabilityReport } from "../../src/server/fit/stability-report";
import {
  computeTargets,
  computeTargetsByGrip,
} from "../../src/server/fit/targets";
import type { CatalogueMouse } from "../../src/server/fit/types";
import golden from "./fixtures/fit-golden.json";

const seed = buildSeedCatalogue(
  seedRows as Parameters<typeof buildSeedCatalogue>[0],
  factsJson as Parameters<typeof buildSeedCatalogue>[1],
);
const seedPriors = computePriors(seed);
const hands = Object.entries(golden) as [
  string,
  { hand: "left" | "right"; measurements: HandMeasurements },
][];

const NO_ANSWER: FitPreferences = { includeVertical: false };

/** A standard mouse sized to the medium_claw golden hand under a stated claw grip. */
function mouse(slug: string, over: Partial<CatalogueMouse>): CatalogueMouse {
  return {
    slug,
    brand: "Acme",
    model: slug,
    lengthMm: 115,
    widthMm: 67,
    heightMm: 37,
    weightG: null,
    size: "medium",
    handCompatibility: null,
    shape: null,
    humpPlacement: null,
    frontFlare: null,
    sideCurvature: null,
    thumbRest: null,
    ringFingerRest: null,
    ...over,
  };
}

describe("THICKNESS_HEIGHT_SHIFT_MM (candidate, uncalibrated)", () => {
  it("is -1.5 / 0 / +1.5 mm for thin / medium / thick", () => {
    expect(THICKNESS_HEIGHT_SHIFT_MM).toEqual({
      thin: -1.5,
      medium: 0,
      thick: 1.5,
    });
  });

  it("covers every contract level and nothing else", () => {
    expect(Object.keys(THICKNESS_HEIGHT_SHIFT_MM).sort()).toEqual(
      [...PALM_THICKNESS_LEVELS].sort(),
    );
  });

  it("bumps the engine version, so stored rows of the two calibrations never mix", () => {
    expect(ENGINE_VERSION_V1).toBe("fit-v1-candidate.3");
  });
});

describe("computeTargets with a thickness answer", () => {
  it.each(GRIP_STYLES)(
    "%s: no answer is exactly the old formula; medium equals no answer",
    (grip) => {
      const none = computeTargets(190, 80, grip);
      expect(none).toEqual({
        lengthMm: 190 * LENGTH_FACTOR[grip],
        gripWidthMm: 80 * GRIP_WIDTH_FACTOR,
        heightMm: 190 * HEIGHT_FACTOR[grip],
      });
      expect(computeTargets(190, 80, grip, undefined)).toEqual(none);
      expect(computeTargets(190, 80, grip, "medium")).toEqual(none);
    },
  );

  it.each(GRIP_STYLES)("%s: thin and thick move only the height", (grip) => {
    const none = computeTargets(190, 80, grip);
    const thin = computeTargets(190, 80, grip, "thin");
    const thick = computeTargets(190, 80, grip, "thick");
    expect(thin.heightMm).toBeCloseTo(none.heightMm - 1.5, 12);
    expect(thick.heightMm).toBeCloseTo(none.heightMm + 1.5, 12);
    for (const t of [thin, thick]) {
      expect(t.lengthMm).toBe(none.lengthMm);
      expect(t.gripWidthMm).toBe(none.gripWidthMm);
    }
  });
});

describe("computeTargetsByGrip: every grip shifts alike", () => {
  it.each([
    ["thin", -1.5],
    ["thick", 1.5],
  ] as const)(
    "%s moves the height of palm, claw and fingertip by %s mm, and nothing else",
    (level, shift) => {
      const none = computeTargetsByGrip(190, 80);
      const shifted = computeTargetsByGrip(190, 80, level);
      for (const g of GRIP_STYLES) {
        expect(shifted[g].heightMm).toBeCloseTo(none[g].heightMm + shift, 12);
        expect(shifted[g].lengthMm).toBe(none[g].lengthMm);
        expect(shifted[g].gripWidthMm).toBe(none[g].gripWidthMm);
        expect(shifted[g]).toEqual(computeTargets(190, 80, g, level));
      }
    },
  );

  it("no answer and medium equal the unshifted targets of each grip", () => {
    const none = computeTargetsByGrip(190, 80);
    for (const g of GRIP_STYLES) {
      expect(none[g]).toEqual(computeTargets(190, 80, g));
    }
    expect(computeTargetsByGrip(190, 80, "medium")).toEqual(none);
  });
});

describe("v1 reads prefs.palmThickness", () => {
  // Hand on the palm/claw/fingertip border (r = 0.56): all three grips are in
  // play, so the blended total must equal the weighted sum of the totals of
  // each grip stated alone with the same answer. A shift that reached only
  // the grip used would be off by about 2 points on these cases.
  it.each([
    [30, "thin"],
    [34, "thick"],
  ] as const)(
    "no stated grip: a %s mm mouse's blended total matches the sum over grips, all shifted (%s)",
    (heightMm, level) => {
      const cat = [mouse("m", { heightMm })];
      const priors = computePriors(cat);
      const m: HandMeasurements = {
        handLengthMm: 185,
        palmLengthMm: 103.6,
        palmWidthMm: 76,
      };
      const total = (prefs: FitPreferences) =>
        scoreFitV1(m, cat, prefs, "right", priors).results[0]!.total;
      const w = gripWeights(m.palmLengthMm / m.handLengthMm);
      expect(Object.values(w).filter((x) => x > 0.1)).toHaveLength(3);
      const sum = GRIP_STYLES.reduce(
        (acc, g) =>
          acc +
          w[g] * total({ ...NO_ANSWER, gripStyle: g, palmThickness: level }),
        0,
      );
      expect(
        Math.abs(total({ ...NO_ANSWER, palmThickness: level }) - sum),
      ).toBeLessThan(1);
    },
  );

  it.each(hands)(
    "%s: medium equals no answer (same totals, ranks, reasons, targets, hand type)",
    (_n, g) => {
      const run = (prefs: FitPreferences) =>
        scoreFitV1(g.measurements, seed, prefs, g.hand, seedPriors);
      const none = run(NO_ANSWER);
      expect(run({ ...NO_ANSWER, palmThickness: "medium" })).toEqual(none);
      // An explicit undefined (a skipped answer) is the same as no key at all.
      expect(run({ ...NO_ANSWER, palmThickness: undefined })).toEqual(none);
    },
  );

  it.each(GRIP_STYLES)(
    "medium equals no answer under a stated %s grip too",
    (grip) => {
      const g = golden.medium_claw;
      const run = (prefs: FitPreferences) =>
        scoreFitV1(g.measurements, seed, prefs, "right", seedPriors);
      expect(
        run({ ...NO_ANSWER, gripStyle: grip, palmThickness: "medium" }),
      ).toEqual(run({ ...NO_ANSWER, gripStyle: grip }));
    },
  );

  it("thin and thick change the height target of the grip used, and nothing else in it", () => {
    const g = golden.medium_claw;
    const run = (palmThickness?: "thin" | "thick") =>
      scoreFitV1(
        g.measurements,
        seed,
        { ...NO_ANSWER, gripStyle: "claw", palmThickness },
        "right",
        seedPriors,
      );
    const none = run();
    expect(run("thin").targets.heightMm).toBeCloseTo(
      none.targets.heightMm - 1.5,
      12,
    );
    expect(run("thick").targets.heightMm).toBeCloseTo(
      none.targets.heightMm + 1.5,
      12,
    );
    expect(run("thick").targets.lengthMm).toBe(none.targets.lengthMm);
    expect(run("thick").targets.gripWidthMm).toBe(none.targets.gripWidthMm);
  });

  it("with no stated grip, every grip's height target shifts alike (the blend sees it)", () => {
    // Above the unshifted target for every grip, so a taller target can only help.
    const g = golden.medium_claw;
    const tall = mouse("tall", { heightMm: 42 });
    const out = (t?: "thin" | "thick") =>
      scoreFitV1(
        g.measurements,
        [tall],
        { ...NO_ANSWER, palmThickness: t },
        "right",
        computePriors([tall]),
      ).results[0]!;
    expect(out("thick").total).toBeGreaterThanOrEqual(out().total);
    expect(out().total).toBeGreaterThanOrEqual(out("thin").total);
    expect(out("thick").total).toBeGreaterThan(out("thin").total);
  });

  it("does not move the hand-type label (size, grip, width) for any answer", () => {
    for (const [, g] of hands) {
      const base = scoreFitV1(
        g.measurements,
        seed,
        NO_ANSWER,
        g.hand,
        seedPriors,
      );
      expect(base.handType).toBeDefined();
      for (const level of PALM_THICKNESS_LEVELS) {
        const out = scoreFitV1(
          g.measurements,
          seed,
          { ...NO_ANSWER, palmThickness: level },
          g.hand,
          seedPriors,
        );
        expect(out.handType).toEqual(base.handType);
        expect(out.gripStyle).toEqual(base.gripStyle);
      }
    }
  });

  it("handType is identical for every answer at the contract's smallest hand (handLengthMm = 100)", () => {
    const m: HandMeasurements = {
      handLengthMm: 100,
      palmLengthMm: 58,
      palmWidthMm: 50,
    };
    const run = (prefs: FitPreferences) =>
      scoreFitV1(m, seed, prefs, "right", seedPriors);
    const none = run(NO_ANSWER);
    expect(none.handType).toBeDefined();
    for (const level of ["thin", "thick"] as const) {
      const out = run({ ...NO_ANSWER, palmThickness: level });
      expect(out.handType).toEqual(none.handType);
      // The response targets are the shifted ones; only the label is not.
      expect(out.targets.heightMm).not.toBe(none.targets.heightMm);
    }
  });

  it("is deterministic and the response carries the new engine version", () => {
    const g = golden.large_palm;
    const prefs: FitPreferences = { ...NO_ANSWER, palmThickness: "thick" };
    const a = scoreFitV1(g.measurements, seed, prefs, "right", seedPriors);
    const b = scoreFitV1(g.measurements, seed, prefs, "right", seedPriors);
    expect(a).toEqual(b);
    expect(a.engineVersion).toBe("fit-v1-candidate.3");
  });
});

describe("monotonic in the answer", () => {
  // medium_claw, claw stated: the unshifted height target is 185 x 0.20 = 37 mm.
  const m = golden.medium_claw.measurements;
  const catalogue = [
    mouse("above", { heightMm: 41 }), // above the unshifted target
    mouse("below", { heightMm: 33 }), // below it
    mouse("exact", { heightMm: 37 }),
  ];
  const priors = computePriors(catalogue);
  const scoreOf = (slug: string, level?: "thin" | "medium" | "thick") => {
    const out = scoreFitV1(
      m,
      catalogue,
      { ...NO_ANSWER, gripStyle: "claw", palmThickness: level },
      "right",
      priors,
    );
    const e = out.results.find((r) => r.mouse.slug === slug)!;
    return { total: e.total, height: e.subscores.heightHump.score! };
  };

  it("a mouse above the unshifted target: thick >= medium >= thin (strict on the height score)", () => {
    const thick = scoreOf("above", "thick");
    const medium = scoreOf("above", "medium");
    const thin = scoreOf("above", "thin");
    expect(thick.total).toBeGreaterThanOrEqual(medium.total);
    expect(medium.total).toBeGreaterThanOrEqual(thin.total);
    expect(thick.height).toBeGreaterThan(medium.height);
    expect(medium.height).toBeGreaterThan(thin.height);
  });

  it("a mouse below the unshifted target: thin >= medium >= thick (strict on the height score)", () => {
    const thick = scoreOf("below", "thick");
    const medium = scoreOf("below", "medium");
    const thin = scoreOf("below", "thin");
    expect(thin.total).toBeGreaterThanOrEqual(medium.total);
    expect(medium.total).toBeGreaterThanOrEqual(thick.total);
    expect(thin.height).toBeGreaterThan(medium.height);
    expect(medium.height).toBeGreaterThan(thick.height);
  });

  it("a mouse exactly on the unshifted target loses the same either way", () => {
    const thick = scoreOf("exact", "thick");
    const thin = scoreOf("exact", "thin");
    expect(thick.height).toBeCloseTo(thin.height, 9);
    expect(thick.height).toBeLessThan(scoreOf("exact", "medium").height);
  });

  it("the shift reorders mice: a thick answer puts the tall mouse over the short one, thin the reverse", () => {
    const rank = (level: "thin" | "thick") =>
      scoreFitV1(
        m,
        catalogue,
        { ...NO_ANSWER, gripStyle: "claw", palmThickness: level },
        "right",
        priors,
      ).results.map((r) => r.mouse.slug);
    const thick = rank("thick");
    const thin = rank("thin");
    expect(thick.indexOf("above")).toBeLessThan(thick.indexOf("below"));
    expect(thin.indexOf("below")).toBeLessThan(thin.indexOf("above"));
  });
});

describe("v0 ignores palmThickness", () => {
  it.each(hands)(
    "%s: scoreWithEngine('v0') is identical with any answer",
    (_n, g) => {
      const none = scoreWithEngine(
        "v0",
        g.measurements,
        seed,
        NO_ANSWER,
        g.hand,
      );
      for (const level of PALM_THICKNESS_LEVELS) {
        expect(
          scoreWithEngine(
            "v0",
            g.measurements,
            seed,
            { ...NO_ANSWER, palmThickness: level },
            g.hand,
          ),
        ).toEqual(none);
      }
      expect(
        scoreFit(
          g.measurements,
          seed,
          { ...NO_ANSWER, palmThickness: "thick" },
          g.hand,
        ),
      ).toEqual(scoreFit(g.measurements, seed, NO_ANSWER, g.hand));
    },
  );

  it("v0 never reports a shifted target", () => {
    const g = golden.medium_claw;
    const out = scoreWithEngine(
      "v0",
      g.measurements,
      seed,
      { ...NO_ANSWER, gripStyle: "claw", palmThickness: "thick" },
      "right",
    );
    expect(out.targets).toEqual(
      computeTargets(
        g.measurements.handLengthMm,
        g.measurements.palmWidthMm,
        "claw",
      ),
    );
  });
});

describe("the fit preferences contract accepts the answer", () => {
  it("parses a level and rejects anything else", () => {
    expect(
      fitPreferencesSchema.parse({ palmThickness: "thick" }).palmThickness,
    ).toBe("thick");
    expect(
      fitPreferencesSchema.safeParse({ palmThickness: "huge" }).success,
    ).toBe(false);
  });
});

// The shift depends on hand length only, so a palm-length sweep cannot see it
// directly; this guards that fixing an answer does not break the grip blend's
// continuity (the answer is applied to every grip's target before blending),
// as a guard on the combination, not a second copy of fit-v1's own sweep test.
describe("continuity (§8) with the answer fixed: the blend stays continuous", () => {
  const v1: EngineFn = (m, c, p, h) => scoreFitV1(m, c, p, h, seedPriors);
  it.each(hands)(
    "%s: no mouse's total jumps by more than 2 points",
    (_n, g) => {
      for (const answer of THICKNESS_ANSWERS) {
        const sweep = palmLengthSweep(
          v1,
          seed,
          g.hand,
          g.measurements,
          {},
          withThickness(NO_ANSWER, answer),
        );
        expect(sweep.maxJump).toBeLessThanOrEqual(2);
      }
    },
  );
});

describe("withThickness", () => {
  it("sets a level and keeps the other preferences", () => {
    expect(
      withThickness({ includeVertical: true, gripStyle: "palm" }, "thin"),
    ).toEqual({
      includeVertical: true,
      gripStyle: "palm",
      palmThickness: "thin",
    });
  });

  it("'none' removes the key entirely (never writes medium or undefined)", () => {
    const out = withThickness(
      { includeVertical: false, palmThickness: "thick" },
      "none",
    );
    expect(out).toEqual({ includeVertical: false });
    expect("palmThickness" in out).toBe(false);
  });
});

describe("thicknessRuns", () => {
  const ranked = (entries: [string, number][]) =>
    ({
      results: entries.map(([slug, total], i) => ({
        rank: i + 1,
        total,
        mouse: { slug },
      })),
    }) as unknown as ReturnType<EngineFn>;

  /**
   * A fake engine over five base mice: thick lifts "b" over "a" and lets a new
   * "c" push "f" out of the top 5; thin lowers everyone. Records the answers it saw.
   */
  function fake() {
    const seen: (string | undefined)[] = [];
    const engine: EngineFn = (_m, _c, prefs) => {
      seen.push(prefs.palmThickness);
      if (prefs.palmThickness === "thick") {
        return ranked([
          ["b", 90],
          ["a", 80],
          ["c", 75],
          ["d", 70],
          ["e", 60],
          ["f", 50],
        ]);
      }
      if (prefs.palmThickness === "thin") {
        return ranked([
          ["a", 74],
          ["b", 70],
          ["d", 60],
          ["e", 50],
          ["f", 40],
        ]);
      }
      return ranked([
        ["a", 80],
        ["b", 79],
        ["d", 70],
        ["e", 60],
        ["f", 50],
      ]);
    };
    return { engine, seen };
  }

  const m: HandMeasurements = {
    handLengthMm: 185,
    palmLengthMm: 104,
    palmWidthMm: 76,
  };

  it("compares each answer with the no-answer ranking", () => {
    const { engine } = fake();
    const r = thicknessRuns(engine, [], "right", m);
    expect(r.none).toEqual({
      top1Kept: true,
      top5Jaccard: 1,
      maxTotalChange: 0,
    });
    expect(r.medium).toEqual(r.none);
    // thin: same five mice, every total lower (largest drop 10).
    expect(r.thin).toEqual({
      top1Kept: true,
      top5Jaccard: 1,
      maxTotalChange: 10,
    });
    // thick: "b" is first now, "c" pushes "f" out of the top 5:
    // {a,b,d,e,f} against {b,a,c,d,e} shares 4 of 6.
    expect(r.thick.top1Kept).toBe(false);
    expect(r.thick.top5Jaccard).toBeCloseTo(4 / 6, 12);
    expect(r.thick.maxTotalChange).toBe(11);
  });

  it("scores the baseline with no answer, then each level in order", () => {
    const { engine, seen } = fake();
    thicknessRuns(engine, [], "right", m);
    // baseline, none, thin, medium, thick
    expect(seen).toEqual([undefined, undefined, "thin", "medium", "thick"]);
  });
});

describe("the stability report carries the thickness section", () => {
  let report = "";
  beforeAll(() => {
    report = buildStabilityReport(
      seed,
      Object.fromEntries(hands.map(([n, g]) => [n, g])),
    );
  });

  it("has the sensitivity table, one row per hand and answer, and the fixed-answer sweep", () => {
    expect(report).toContain("## Palm-thickness sensitivity (v1 only)");
    for (const [name] of hands) {
      for (const a of THICKNESS_ANSWERS) {
        expect(report).toContain(`| ${name} | ${a} |`);
      }
    }
    expect(report).toContain(
      "### Palm-length sweep with the answer fixed (v1)",
    );
    const worst =
      /Largest jump over all hands: none = (\d+), thin = (\d+), medium = (\d+), thick = (\d+) points/.exec(
        report,
      );
    expect(worst).not.toBeNull();
    for (const n of worst!.slice(1)) expect(Number(n)).toBeLessThanOrEqual(2);
  });

  it("the 'none' and 'medium' rows are the baseline itself (100%, Jaccard 1.00, change 0)", () => {
    for (const a of ["none", "medium"]) {
      expect(report).toContain(
        `| **all hands** | **${a}** | **100%** | **1.00** | **0** |`,
      );
    }
  });

  it("thin and thick rows are not the baseline: some golden hand moves (so the report does not reuse the none run)", () => {
    for (const a of ["thin", "thick"]) {
      const rows = report
        .split("\n")
        .filter((l) => hands.some(([n]) => l.startsWith(`| ${n} | ${a} |`)));
      expect(rows).toHaveLength(hands.length);
      expect(rows.some((l) => !l.endsWith("| 100% | 1.00 | 0 |"))).toBe(true);
    }
  });

  it("with no hands the thickness section prints no NaN and no pooled rows", () => {
    const empty = buildStabilityReport(seed, {});
    expect(empty).not.toContain("NaN");
    expect(empty).toContain("## Palm-thickness sensitivity (v1 only)");
    expect(empty).not.toContain("| **all hands** | **thin**");
  });
});
