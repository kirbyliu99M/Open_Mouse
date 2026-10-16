import { describe, expect, it } from "vitest";
import {
  GRIP_STYLES,
  type FitPreferences,
  type GripStyle,
} from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import {
  BIAS_INPUT_FRAME_B,
  V1_EQUIVALENT_PARAMS_V2,
} from "../../src/server/fit/coefficients-v2";
import { excludeReasonV1 } from "../../src/server/fit/exclusions-v1";
import { argmaxGrip, gripWeights } from "../../src/server/fit/grip-weights";
import { computePriors } from "../../src/server/fit/priors";
import {
  scoreFitV1,
  scoreMouseV1,
  type GripContext,
} from "../../src/server/fit/score-v1";
import { scoreFitV2 } from "../../src/server/fit/score-v2";
import { computeTargetsByGrip } from "../../src/server/fit/targets";
import type { CatalogueMouse } from "../../src/server/fit/types";
import {
  describedCatalogue,
  goldenHands,
  seedCatalogue,
} from "./fit-v2-fixtures";

/**
 * "v1-equivalent" proof: with Sigma_input = diag(6^2, 4^2), v1's sigma as the
 * tolerance, asymmetry 1 and v1's grip weights, fit-v2 must give v1's
 * unrounded total for every mouse to within 1e-9, and v1's order.
 */
const TOL = 1e-9;
const catalogues: [string, CatalogueMouse[]][] = [
  ["seed38", seedCatalogue],
  ["described", describedCatalogue],
];
const prefsList: [string, FitPreferences][] = [
  ["no prefs", { includeVertical: false }],
  [
    "weight + thick",
    {
      includeVertical: false,
      weightG: { min: 60, max: 90 },
      palmThickness: "thick",
    },
  ],
  ["stated palm", { includeVertical: false, gripStyle: "palm" }],
  ["stated claw", { includeVertical: false, gripStyle: "claw" }],
  ["stated fingertip", { includeVertical: false, gripStyle: "fingertip" }],
];

/** v1's own unrounded total for one mouse (scoreFitV1 only returns rounded ones). */
function v1TotalRaw(
  m: CatalogueMouse,
  measurements: HandMeasurements,
  prefs: FitPreferences,
  priors: ReturnType<typeof computePriors>,
): number {
  const r = measurements.palmLengthMm / measurements.handLengthMm;
  const stated: GripStyle | null = prefs.gripStyle ?? null;
  const weights = gripWeights(r, stated);
  const grips: GripContext = {
    used: stated ?? argmaxGrip(gripWeights(r)),
    weights,
    gripsInPlay: GRIP_STYLES.filter((g) => weights[g] > 0),
    targetsByGrip: computeTargetsByGrip(
      measurements.handLengthMm,
      measurements.palmWidthMm,
      prefs.palmThickness,
    ),
  };
  return scoreMouseV1(m, grips, priors, prefs).totalRaw;
}

describe("fit-v2 is v1 under the v1-equivalent setting", () => {
  for (const [catName, catalogue] of catalogues) {
    const priors = computePriors(catalogue);
    for (const [handName, g] of Object.entries(goldenHands)) {
      for (const [prefName, prefs] of prefsList) {
        it(`${catName} / ${handName} / ${prefName}`, () => {
          const v2 = scoreFitV2(
            g.measurements,
            catalogue,
            prefs,
            g.hand,
            priors,
            { params: V1_EQUIVALENT_PARAMS_V2 },
          );
          const v1 = scoreFitV1(
            g.measurements,
            catalogue,
            prefs,
            g.hand,
            priors,
          );
          // Same ranked set, same order, same rounded totals.
          expect(v2.results.map((e) => e.mouse.slug)).toEqual(
            v1.results.map((e) => e.mouse.slug),
          );
          expect(v2.results.map((e) => e.total)).toEqual(
            v1.results.map((e) => e.total),
          );
          expect(v2.excluded.map((e) => [e.slug, e.reason])).toEqual(
            v1.excluded.map((e) => [e.slug, e.reason]),
          );
          // Unrounded totals agree to 1e-9.
          const bySlug = new Map(catalogue.map((m) => [m.slug, m] as const));
          for (const e of v2.results) {
            const want = v1TotalRaw(
              bySlug.get(e.mouse.slug) as CatalogueMouse,
              g.measurements,
              prefs,
              priors,
            );
            expect(Math.abs(e.totalRaw - want)).toBeLessThan(TOL);
          }
        });
      }
    }
  }

  it("the v1-equivalent setting is v1's own numbers, not a copy", () => {
    expect(V1_EQUIVALENT_PARAMS_V2.sigmaInput).toEqual([
      [36, 0],
      [0, 16],
    ]);
    expect(V1_EQUIVALENT_PARAMS_V2.gripUnknownMode).toBe("v1_ratio");
    expect(V1_EQUIVALENT_PARAMS_V2.asymmetry).toEqual({
      length: 1,
      gripWidth: 1,
      height: 1,
    });
  });

  it("the equivalence needs bias = 0: the default bias alone breaks it", () => {
    const g = goldenHands.medium_claw;
    const priors = computePriors(seedCatalogue);
    const prefs = { includeVertical: false } as const;
    const v1 = scoreFitV1(g.measurements, seedCatalogue, prefs, g.hand, priors);
    const v2 = scoreFitV2(
      g.measurements,
      seedCatalogue,
      prefs,
      g.hand,
      priors,
      {
        params: {
          ...V1_EQUIVALENT_PARAMS_V2,
          biasInput: BIAS_INPUT_FRAME_B,
        },
      },
    );
    const v1Totals = new Map(v1.results.map((e) => [e.mouse.slug, e.total]));
    expect(v2.results.some((e) => v1Totals.get(e.mouse.slug) !== e.total)).toBe(
      true,
    );
  });

  it("v2 excludes exactly what v1 excludes (same rule function)", () => {
    const g = goldenHands.left_handed;
    const priors = computePriors(seedCatalogue);
    const v2 = scoreFitV2(
      g.measurements,
      seedCatalogue,
      { includeVertical: false },
      g.hand,
      priors,
    );
    for (const e of v2.excluded) {
      const m = seedCatalogue.find((x) => x.slug === e.slug) as CatalogueMouse;
      expect(excludeReasonV1(m, g.hand, { includeVertical: false })).toBe(
        e.reason,
      );
    }
  });
});
