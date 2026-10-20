/**
 * fit-v2.0 candidate, build spec rev2 §4 T7: equal weights when no grip is
 * stated. The weights are 1/3 each; `predicted`, `used` and `handType` stay
 * v1's (never the arg-max of the equal weights, which would always be palm);
 * and, without a clamp, a mouse's unrounded total is the mean of its three
 * single-grip v1 totals (an oracle built from v1's own per-grip scoring).
 * With a stated grip there are no weights, and inside the length range the
 * totals are v1's.
 */
import { describe, expect, it } from "vitest";
import {
  GRIP_STYLES,
  type FitPreferences,
  type GripStyle,
} from "../../src/lib/contracts/fit";
import { gripWeights } from "../../src/server/fit/grip-weights";
import {
  compareRankKeys,
  scoreFitV1,
  scoreMouseV1,
  type GripContext,
} from "../../src/server/fit/score-v1";
import {
  planV2,
  rankV2,
  scoreFitV2,
  type FitV2Options,
} from "../../src/server/fit/score-v2-candidate";
import { computeTargetsByGrip } from "../../src/server/fit/targets";
import { hand, seedCatalogue, seedPriors } from "./fit-v2c-fixtures";

const OPEN: FitPreferences = { includeVertical: false };

// r from fingertip to palm territory; hands inside every grip's length range.
const CASES = [
  { h: 172.31, w: 66.07, r: 0.5 },
  { h: 181.4, w: 70.2, r: 0.54 },
  { h: 186.07, w: 74.93, r: 0.56 },
  { h: 193.9, w: 69.1, r: 0.58 },
  { h: 199.13, w: 79.6, r: 0.62 },
];

/** v1 scoring one stated grip, as `scoreFitV1` sets it up. */
function statedContext(
  h: number,
  w: number,
  grip: GripStyle,
  prefs: FitPreferences,
): GripContext {
  return {
    used: grip,
    weights: gripWeights(0, grip),
    gripsInPlay: [grip],
    targetsByGrip: computeTargetsByGrip(h, w, prefs.palmThickness),
  };
}

describe("T7: no stated grip", () => {
  it.each(CASES)(
    "h $h, r $r: weights 1/3 each; predicted, used and handType are v1's",
    ({ h, w, r }) => {
      const m = hand(h, w, r);
      const v1 = scoreFitV1(m, seedCatalogue, OPEN, "right", seedPriors);
      const v2 = scoreFitV2(m, seedCatalogue, OPEN, "right", seedPriors);
      expect(v2.gripStyle).toEqual({
        stated: null,
        predicted: v1.gripStyle.predicted,
        used: v1.gripStyle.used,
        weights: { palm: 1 / 3, claw: 1 / 3, fingertip: 1 / 3 },
      });
      expect(v2.handType).toEqual(v1.handType);
      expect(v2.targets).toEqual(v1.targets);
    },
  );

  it("used is v1's arg-max, not the arg-max of the equal weights (which is palm)", () => {
    expect(
      scoreFitV2(hand(186, 72, 0.56), seedCatalogue, OPEN, "right", seedPriors)
        .gripStyle.used,
    ).toBe("claw");
    expect(
      scoreFitV2(hand(186, 72, 0.5), seedCatalogue, OPEN, "right", seedPriors)
        .gripStyle.used,
    ).toBe("fingertip");
  });

  it.each([
    ["no clamp", { clampLength: false }],
    ["clamp on, every target in range", {}],
  ] as [string, FitV2Options][])(
    "oracle (%s): total = mean of the three single-grip v1 totals, and the order follows",
    (_n, options) => {
      for (const { h, w, r } of CASES) {
        const m = hand(h, w, r);
        const plan = planV2(seedCatalogue, "right", OPEN, options);
        const { ranked, state } = rankV2(plan, m, OPEN, seedPriors, options);
        expect(Object.values(state.clamped)).toEqual([null, null, null]);
        const v2 = scoreFitV2(
          m,
          seedCatalogue,
          OPEN,
          "right",
          seedPriors,
          options,
        );

        const oracle = plan.rankable.map((mouse) => {
          const per = GRIP_STYLES.map(
            (g) =>
              scoreMouseV1(
                mouse,
                statedContext(h, w, g, OPEN),
                seedPriors,
                OPEN,
              ).totalRaw,
          );
          const usedScore = scoreMouseV1(
            mouse,
            statedContext(h, w, state.used, OPEN),
            seedPriors,
            OPEN,
          );
          return {
            slug: mouse.slug,
            key: {
              totalRaw: (per[0]! + per[1]! + per[2]!) / 3,
              confidence: usedScore.confidence,
              lengthAbsDelta: usedScore.lengthAbsDelta,
              model: mouse.model,
            },
          };
        });
        const bySlug = new Map(oracle.map((o) => [o.slug, o.key]));
        for (const { mouse, score } of ranked) {
          expect(score.totalRaw).toBeCloseTo(
            bySlug.get(mouse.slug)!.totalRaw,
            9,
          );
        }
        for (const e of v2.results) {
          expect(
            Math.abs(e.total - bySlug.get(e.mouse.slug)!.totalRaw),
          ).toBeLessThanOrEqual(0.5 + 1e-9);
        }
        const oracleOrder = [...oracle]
          .sort((a, b) => compareRankKeys(a.key, b.key))
          .map((o) => o.slug);
        expect(v2.results.map((e) => e.mouse.slug)).toEqual(oracleOrder);
      }
    },
  );

  it("differs from v1's soft blend (the change is real, not a no-op)", () => {
    const m = hand(193.9, 69.1, 0.58);
    const v1 = scoreFitV1(m, seedCatalogue, OPEN, "right", seedPriors);
    const v2 = scoreFitV2(m, seedCatalogue, OPEN, "right", seedPriors);
    expect(v2.results.map((e) => e.total)).not.toEqual(
      v1.results.map((e) => e.total),
    );
  });

  it("equalWeightsWhenUnknown off: v1's soft weights", () => {
    const m = hand(186.07, 74.93, 0.56);
    const v1 = scoreFitV1(m, seedCatalogue, OPEN, "right", seedPriors);
    const v2 = scoreFitV2(m, seedCatalogue, OPEN, "right", seedPriors, {
      equalWeightsWhenUnknown: false,
    });
    expect(v2.gripStyle).toEqual(v1.gripStyle);
    expect(v2.results).toEqual(v1.results);
  });
});

describe("T7: a stated grip", () => {
  it.each(GRIP_STYLES)(
    "%s: no weights, and in range the totals are v1's",
    (grip) => {
      const prefs: FitPreferences = { ...OPEN, gripStyle: grip };
      const m = hand(181.4, 70.2, 0.54);
      const v1 = scoreFitV1(m, seedCatalogue, prefs, "right", seedPriors);
      const v2 = scoreFitV2(m, seedCatalogue, prefs, "right", seedPriors);
      expect(v2.coverage!.lengthOutOfRange).toBe(false);
      expect(v2.gripStyle).not.toHaveProperty("weights");
      expect(v2.results.map((e) => [e.mouse.slug, e.total])).toEqual(
        v1.results.map((e) => [e.mouse.slug, e.total]),
      );
    },
  );
});
