/**
 * fit-v2.0 candidate, build spec rev2 §4:
 * - T3: `coverage` (edges, an unstated grip, left vs right, the exclusion
 *   options, nothing rankable);
 * - T4: the true target is kept for `targets`, the displayed sub-scores and
 *   `handType`;
 * - T11: oracle for an out-of-range hand: the RANKING length sub-score is
 *   v1's at h' = Lmax / k, every other sub-score is v1's at h.
 */
import { describe, expect, it } from "vitest";
import {
  fitCoverageSchema,
  type FitPreferences,
  type FitResponse,
} from "../../src/lib/contracts/fit";
import { LENGTH_FACTOR } from "../../src/server/fit/coefficients";
import { excludeReasonV1 } from "../../src/server/fit/exclusions-v1";
import { computePriors } from "../../src/server/fit/priors";
import {
  gripChoiceV1,
  scoreFitV1,
  scoreMouseV1,
} from "../../src/server/fit/score-v1";
import {
  planV2,
  rankV2,
  scoreFitV2,
  type FitV2Options,
} from "../../src/server/fit/score-v2-candidate";
import { scoreLengthV1 } from "../../src/server/fit/subscores-v1";
import { computeTargets } from "../../src/server/fit/targets";
import type { CatalogueMouse } from "../../src/server/fit/types";
import { hand, mouseRow, seedCatalogue, seedPriors } from "./fit-v2c-fixtures";

const W = 70;
const H_LO = 151.5;
const H_HI = 197;
// The shortest and longest rankable lengths are exactly the palm length
// targets of the hands H_LO and H_HI, so "target equals the edge" is exact.
const L_MIN = computeTargets(H_LO, W, "palm").lengthMm;
const L_MAX = computeTargets(H_HI, W, "palm").lengthMm;

const base: CatalogueMouse[] = [
  mouseRow({ slug: "a", model: "A", brand: "A", lengthMm: L_MIN }),
  mouseRow({ slug: "b", model: "B", brand: "B", lengthMm: 110 }),
  mouseRow({ slug: "c", model: "C", brand: "C", lengthMm: 120 }),
  mouseRow({ slug: "d", model: "D", brand: "D", lengthMm: L_MAX }),
];
// Shorter than every base row, but right-handed and ergonomic: excluded for a
// left hand only.
const rightErgo = mouseRow({
  slug: "e",
  model: "E",
  brand: "E",
  lengthMm: 90,
  handCompatibility: "right",
  shape: "ergonomic",
  thumbRest: true,
});
const vertical = mouseRow({
  slug: "v",
  model: "V",
  brand: "V",
  lengthMm: 80,
  heightMm: 50, // 50 / 80 > 0.55
});
const trackball = mouseRow({
  slug: "t",
  model: "T",
  brand: "T",
  lengthMm: 140,
  formFactor: "trackball",
});

const PALM: FitPreferences = { includeVertical: false, gripStyle: "palm" };
const OPEN: FitPreferences = { includeVertical: false };

function v2(
  h: number,
  catalogue: readonly CatalogueMouse[],
  prefs: FitPreferences,
  side: "left" | "right" = "right",
  options: FitV2Options = {},
  ratio = 0.56,
) {
  return scoreFitV2(
    hand(h, W, ratio),
    catalogue,
    prefs,
    side,
    computePriors(catalogue),
    options,
  );
}

function coverageOf(r: Omit<FitResponse, "scanId">) {
  expect(r.coverage).toBeDefined();
  expect(fitCoverageSchema.safeParse(r.coverage).success).toBe(true);
  return r.coverage!;
}

describe("T3: coverage at and around the edges (stated palm grip)", () => {
  it("Lmin - e: out of range, below", () => {
    const h = H_LO - 0.001;
    const c = coverageOf(v2(h, base, PALM));
    expect(c).toEqual({
      lengthOutOfRange: true,
      direction: "below",
      usedGripLengthTargetMm: computeTargets(h, W, "palm").lengthMm,
      catalogueLengthRangeMm: [L_MIN, L_MAX],
    });
  });

  it.each([
    ["Lmin", H_LO],
    ["the middle", (H_LO + H_HI) / 2],
    ["Lmax", H_HI],
  ])("%s: in range (an edge counts as inside)", (_n, h) => {
    const c = coverageOf(v2(h, base, PALM));
    expect(c).toEqual({
      lengthOutOfRange: false,
      direction: null,
      usedGripLengthTargetMm: computeTargets(h, W, "palm").lengthMm,
      catalogueLengthRangeMm: [L_MIN, L_MAX],
    });
  });

  it("Lmax + e: out of range, above", () => {
    const h = H_HI + 0.001;
    const c = coverageOf(v2(h, base, PALM));
    expect(c.lengthOutOfRange).toBe(true);
    expect(c.direction).toBe("above");
    expect(c.usedGripLengthTargetMm).toBeGreaterThan(L_MAX);
  });
});

describe("T3: an unstated grip", () => {
  it("palm clamped but the used grip (claw) not: lengthOutOfRange true, direction null", () => {
    const h = 200; // palm 132 > Lmax ~130.02; claw 124, fingertip 116 inside
    const m = hand(h, W);
    expect(gripChoiceV1(m, OPEN).used).toBe("claw");
    const r = v2(h, base, OPEN);
    expect(r.gripStyle.used).toBe("claw");
    expect(coverageOf(r)).toEqual({
      lengthOutOfRange: true,
      direction: null,
      usedGripLengthTargetMm: computeTargets(h, W, "claw").lengthMm,
      catalogueLengthRangeMm: [L_MIN, L_MAX],
    });
  });

  it("the used grip clamped: its direction", () => {
    const r = v2(215, base, OPEN); // claw 133.3 > Lmax
    expect(r.gripStyle.used).toBe("claw");
    const c = coverageOf(r);
    expect(c.lengthOutOfRange).toBe(true);
    expect(c.direction).toBe("above");
  });

  it("with soft weights (equal weights off) the same rule applies to the grips in play", () => {
    // r = 0.56: soft weights are all above zero, palm included.
    const r = v2(200, base, OPEN, "right", { equalWeightsWhenUnknown: false });
    expect(r.gripStyle.weights!.palm).toBeGreaterThan(0);
    expect(coverageOf(r).lengthOutOfRange).toBe(true);
  });
});

describe("T3: which mice make the range", () => {
  it("left and right hands can have different ranges (synthetic)", () => {
    const cat = [...base, rightErgo];
    expect(
      coverageOf(v2(170, cat, PALM, "right")).catalogueLengthRangeMm,
    ).toEqual([90, L_MAX]);
    expect(
      coverageOf(v2(170, cat, PALM, "left")).catalogueLengthRangeMm,
    ).toEqual([L_MIN, L_MAX]);
  });

  it("on the seed catalogue the two hands' ranges differ, each the min/max of its rankable rows", () => {
    const ranges = (["right", "left"] as const).map((side) => {
      const lengths = seedCatalogue
        .filter((m) => excludeReasonV1(m, side, OPEN) === null)
        .map((m) => m.lengthMm);
      const expected = [Math.min(...lengths), Math.max(...lengths)];
      const got = scoreFitV2(
        hand(180, 65),
        seedCatalogue,
        OPEN,
        side,
        seedPriors,
      ).coverage!.catalogueLengthRangeMm;
      expect(got).toEqual(expected);
      return got;
    });
    // For the PR description; not asserted beyond "different".
    console.log(
      `[T3] seed length range: right ${JSON.stringify(ranges[0])}, left ${JSON.stringify(ranges[1])}`,
    );
    expect(ranges[0]).not.toEqual(ranges[1]);
  });

  it("an excluded vertical mouse does not widen the range; includeVertical brings it in", () => {
    const cat = [...base, vertical];
    expect(coverageOf(v2(170, cat, PALM)).catalogueLengthRangeMm).toEqual([
      L_MIN,
      L_MAX,
    ]);
    expect(
      coverageOf(v2(170, cat, { ...PALM, includeVertical: true }))
        .catalogueLengthRangeMm,
    ).toEqual([80, L_MAX]);
  });

  it("an excluded trackball does not widen the range; allowTrackball brings it in", () => {
    const cat = [...base, trackball];
    expect(coverageOf(v2(170, cat, PALM)).catalogueLengthRangeMm).toEqual([
      L_MIN,
      L_MAX,
    ]);
    expect(
      coverageOf(v2(170, cat, PALM, "right", { allowTrackball: true }))
        .catalogueLengthRangeMm,
    ).toEqual([L_MIN, 140]);
  });

  it("one rankable mouse: the range is a single point", () => {
    const c = coverageOf(v2(170, [base[2]!], PALM));
    expect(c.catalogueLengthRangeMm).toEqual([120, 120]);
  });

  it("clampLength off: no coverage at all", () => {
    expect(
      v2(250, base, PALM, "right", { clampLength: false }),
    ).not.toHaveProperty("coverage");
  });
});

describe("T3: nothing rankable", () => {
  it("an empty catalogue: no throw, no coverage, nothing excluded", () => {
    const r = scoreFitV2(hand(250, W), [], PALM, "right", computePriors([]));
    expect(r).not.toHaveProperty("coverage");
    expect(r.results).toEqual([]);
    expect(r.excluded).toEqual([]);
    expect(r.targets.lengthMm).toBe(250 * LENGTH_FACTOR.palm);
  });

  it("every mouse excluded: no throw, no coverage, excluded as usual (with wrong-hand totals)", () => {
    const lefties = base.map((m) => ({
      ...m,
      handCompatibility: "left" as const,
    }));
    for (const prefs of [PALM, OPEN]) {
      const r = v2(250, lefties, prefs, "right");
      const v1 = scoreFitV1(
        hand(250, W),
        lefties,
        prefs,
        "right",
        computePriors(lefties),
      );
      expect(r).not.toHaveProperty("coverage");
      expect(r.results).toEqual([]);
      expect(r.excluded.map((e) => e.reason)).toEqual(
        lefties.map(() => "wrong_hand"),
      );
      expect(r.excluded.every((e) => e.total !== undefined)).toBe(true);
      // No range, so nothing is clamped: with a stated grip the totals are v1's.
      if (prefs.gripStyle) expect(r.excluded).toEqual(v1.excluded);
    }
  });
});

describe("§2.2: a wrong_hand total is scored like the ranked mice", () => {
  it.each([
    ["out of range, palm stated", hand(250, 87.5), PALM],
    ["in range, no grip stated (equal weights)", hand(183.3, 70.7, 0.57), OPEN],
  ] as const)("%s: the ranking grip context, not v1's", (_n, m, prefs) => {
    const plan = planV2(seedCatalogue, "left", prefs);
    const { state } = rankV2(plan, m, prefs, seedPriors);
    const r = scoreFitV2(m, seedCatalogue, prefs, "left", seedPriors);
    const v1 = scoreFitV1(m, seedCatalogue, prefs, "left", seedPriors);
    const rows = new Map(seedCatalogue.map((x) => [x.slug, x]));
    const withTotal = r.excluded.filter((e) => e.total !== undefined);
    expect(withTotal.length).toBeGreaterThan(5);
    for (const e of withTotal) {
      expect(e.reason).toBe("wrong_hand");
      expect(e.total).toBe(
        scoreMouseV1(rows.get(e.slug)!, state.ranking, seedPriors, prefs).total,
      );
    }
    // Same mice, same reasons, same "has a total or not" as v1...
    expect(
      r.excluded.map((e) => [e.slug, e.reason, e.total === undefined]),
    ).toEqual(
      v1.excluded.map((e) => [e.slug, e.reason, e.total === undefined]),
    );
    // ...but some totals differ, exactly because the ranking context does.
    expect(r.excluded.map((e) => e.total)).not.toEqual(
      v1.excluded.map((e) => e.total),
    );
  });
});

describe("T4: the true target is what the response shows", () => {
  const big = hand(250, 87.5);

  it("250 mm, palm: targets, coverage and the displayed length reason use 165 mm, not the edge", () => {
    const r = scoreFitV2(big, seedCatalogue, PALM, "right", seedPriors);
    const v1 = scoreFitV1(big, seedCatalogue, PALM, "right", seedPriors);
    const trueTarget = 250 * LENGTH_FACTOR.palm;
    const lMax = r.coverage!.catalogueLengthRangeMm[1];
    expect(r.targets).toEqual(v1.targets);
    expect(r.targets.lengthMm).toBe(trueTarget);
    expect(r.coverage).toMatchObject({
      lengthOutOfRange: true,
      direction: "above",
      usedGripLengthTargetMm: trueTarget,
    });

    const top = r.results[0]!;
    const topRow = seedCatalogue.find((m) => m.slug === top.mouse.slug)!;
    // The clamp ranks the longest mouse first; scored against the edge its
    // length would read as ideal, which is exactly what must not be shown.
    expect(top.mouse.lengthMm).toBe(lMax);
    expect(scoreLengthV1(topRow, lMax, "palm").reason.code).toBe(
      "length_ideal",
    );
    const shown = top.subscores.length;
    expect(shown.reason.code).toBe("length_short");
    expect(shown.reason.params.targetMm).toBe(trueTarget);
    expect(shown.reason.params.deltaMm).toBe(topRow.lengthMm - trueTarget);
    expect(shown.score).toBe(
      Math.round(scoreLengthV1(topRow, trueTarget, "palm").score!),
    );
  });

  it("every entry's displayed sub-scores are v1's for that mouse at the true targets", () => {
    for (const prefs of [PALM, OPEN]) {
      const r = scoreFitV2(big, seedCatalogue, prefs, "right", seedPriors);
      const v1 = scoreFitV1(big, seedCatalogue, prefs, "right", seedPriors);
      expect(r.coverage!.lengthOutOfRange).toBe(true);
      const v1BySlug = new Map(v1.results.map((e) => [e.mouse.slug, e]));
      expect(r.results.length).toBe(v1.results.length);
      for (const e of r.results) {
        expect(e.subscores).toEqual(v1BySlug.get(e.mouse.slug)!.subscores);
      }
      // ...while the ranking itself differs from v1's.
      expect(r.results.map((e) => e.mouse.slug)).not.toEqual(
        v1.results.map((e) => e.mouse.slug),
      );
    }
  });

  it("handType moves with neither the clamp nor the thickness answer", () => {
    const v1 = scoreFitV1(big, seedCatalogue, PALM, "right", seedPriors);
    for (const palmThickness of [
      undefined,
      "thin",
      "medium",
      "thick",
    ] as const) {
      const r = scoreFitV2(
        big,
        seedCatalogue,
        { ...PALM, ...(palmThickness ? { palmThickness } : {}) },
        "right",
        seedPriors,
      );
      expect(r.handType).toBeDefined();
      expect(r.handType).toEqual(v1.handType);
    }
  });
});

describe("T11: out of range, the ranking sub-scores are v1's at h' = Lmax / k for length and at h for the rest", () => {
  it.each(["palm", "claw", "fingertip"] as const)(
    "%s, stated, right hand",
    (grip) => {
      const plan = planV2(seedCatalogue, "right", OPEN);
      const lMax = plan.lengthRangeMm![1];
      const k = LENGTH_FACTOR[grip];
      const h = lMax / k + 25; // clearly above
      const w = 84.3;
      const prefs: FitPreferences = { ...OPEN, gripStyle: grip };
      const { ranked, state } = rankV2(plan, hand(h, w), prefs, seedPriors);
      expect(state.clamped[grip]).toBe("above");

      const atH = scoreFitV1(
        hand(h, w),
        seedCatalogue,
        prefs,
        "right",
        seedPriors,
      );
      const atHPrime = scoreFitV1(
        hand(lMax / k, w),
        seedCatalogue,
        prefs,
        "right",
        seedPriors,
      );
      const bySlug = (list: typeof atH.results) =>
        new Map(list.map((e) => [e.mouse.slug, e.subscores]));
      const v1AtH = bySlug(atH.results);
      const v1AtHPrime = bySlug(atHPrime.results);

      for (const { mouse, score } of ranked) {
        const s = score.subscores;
        const len = v1AtHPrime.get(mouse.slug)!.length;
        expect(Math.round(s.length.score!)).toBe(len.score);
        expect(s.length.reason.code).toBe(len.reason.code);
        expect(s.length.reason.params.targetMm).toBeCloseTo(
          len.reason.params.targetMm!,
          9,
        );
        const rest = v1AtH.get(mouse.slug)!;
        for (const key of [
          "gripWidth",
          "heightHump",
          "frontFlare",
          "thumb",
          "weight",
        ] as const) {
          expect(s[key].score === null ? null : Math.round(s[key].score!)).toBe(
            rest[key].score,
          );
          expect(s[key].reason).toEqual(rest[key].reason);
        }
      }
    },
  );
});
