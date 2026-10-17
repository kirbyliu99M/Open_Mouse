/**
 * fit-v2.0 candidate, build spec rev2 §4 T1 and T1b: where v2 must be v1.
 *
 * T1: a stated grip, every length target inside the rankable range, both
 * options on: results, excluded (with the wrong_hand totals), targets,
 * handType and gripStyle equal v1's, deeply. The hands are deliberately off
 * the 0.1 mm grid: v2 must not round any input of the main ranking.
 *
 * T1b: both options off is v1 for every hand, including out-of-range hands
 * and an unstated grip: the whole response except `engineVersion`.
 */
import { describe, expect, it } from "vitest";
import {
  GRIP_STYLES,
  type FitPreferences,
  type GripStyle,
} from "../../src/lib/contracts/fit";
import {
  PALM_THICKNESS_LEVELS,
  type HandMeasurements,
} from "../../src/lib/contracts/measurement";
import { scoreFitV1 } from "../../src/server/fit/score-v1";
import { planV2, scoreFitV2 } from "../../src/server/fit/score-v2-candidate";
import {
  hand,
  seedCatalogue,
  seedPriors,
  withoutVersion,
} from "./fit-v2c-fixtures";

const SIDES = ["right", "left"] as const;

/**
 * Several of these run hundreds of full engine calls in one `it` (about 0.5 to
 * 2 s alone): an explicit timeout, so a loaded or battery-throttled run of the
 * whole suite does not trip vitest's 5 s default.
 */
const SLOW = 30_000;

// 44 hands, 140 to about 204 mm: inside the length range of every grip for
// both hands on the seed catalogue (palm, the tightest, needs <= 209.7 mm).
// Most are off the 0.1 mm grid (…0.0371, widths with …0.0123).
const T1_HANDS: HandMeasurements[] = Array.from({ length: 44 }, (_, i) => {
  const h = 140 + i * 1.4837 + (i % 3 === 0 ? 0 : 0.0371);
  return {
    handLengthMm: h,
    palmLengthMm: h * (0.52 + (i % 7) * 0.012),
    palmWidthMm: 55 + ((i * 1.731) % 35) + 0.0123 * (i % 4),
  };
});

function expectSameAsV1(
  m: HandMeasurements,
  prefs: FitPreferences,
  side: "left" | "right",
) {
  const v1 = scoreFitV1(m, seedCatalogue, prefs, side, seedPriors);
  const v2 = scoreFitV2(m, seedCatalogue, prefs, side, seedPriors);
  // The precondition, so the test cannot pass vacuously.
  expect(v2.coverage?.lengthOutOfRange).toBe(false);
  expect(v2.results).toEqual(v1.results);
  expect(v2.excluded).toEqual(v1.excluded);
  expect(v2.targets).toEqual(v1.targets);
  expect(v2.handType).toEqual(v1.handType);
  expect(v2.gripStyle).toEqual(v1.gripStyle);
  expect(v2.gripStyle).not.toHaveProperty("weights");
  return { v1, v2 };
}

describe("T1: v2 equals v1 in range, with a stated grip", () => {
  it("the fixture is the seed catalogue, with ergonomic, symmetrical and undescribed rows", () => {
    const plan = planV2(seedCatalogue, "right", { includeVertical: false });
    expect(plan.rankable.length).toBeGreaterThan(300);
    expect(plan.rankable.some((m) => m.shape === "ergonomic")).toBe(true);
    expect(plan.rankable.some((m) => m.shape === "symmetrical")).toBe(true);
    expect(plan.rankable.some((m) => m.frontFlare === null)).toBe(true);
    expect(T1_HANDS.length).toBeGreaterThanOrEqual(40);
    const offGrid = T1_HANDS.filter(
      (m) =>
        Math.abs(m.handLengthMm * 10 - Math.round(m.handLengthMm * 10)) > 1e-6,
    );
    expect(offGrid.length).toBeGreaterThan(20);
  });

  it.each(SIDES)(
    "%s hand: 44 hands x 3 grips, every field equal",
    (side) => {
      let wrongHandTotals = 0;
      for (const m of T1_HANDS) {
        for (const g of GRIP_STYLES) {
          const { v1 } = expectSameAsV1(
            m,
            { includeVertical: false, gripStyle: g },
            side,
          );
          wrongHandTotals += v1.excluded.filter(
            (e) => e.total !== undefined,
          ).length;
        }
      }
      // The wrong-hand totals were really compared, not absent on both sides.
      expect(wrongHandTotals).toBeGreaterThan(0);
    },
    SLOW,
  );

  it.each(SIDES)(
    "%s hand: thickness thin / medium / unanswered, with and without a weight preference",
    (side) => {
      const weights: (FitPreferences["weightG"] | undefined)[] = [
        undefined,
        { min: 55, max: 75 },
      ];
      const thicknesses = [undefined, "thin", "medium"] as const;
      expect(PALM_THICKNESS_LEVELS).toContain("thin");
      for (const m of T1_HANDS.filter((_, i) => i % 7 === 0)) {
        for (const g of GRIP_STYLES) {
          for (const palmThickness of thicknesses) {
            for (const weightG of weights) {
              expectSameAsV1(
                m,
                {
                  includeVertical: false,
                  gripStyle: g,
                  ...(palmThickness ? { palmThickness } : {}),
                  ...(weightG ? { weightG } : {}),
                },
                side,
              );
            }
          }
        }
      }
    },
    SLOW,
  );

  it("includeVertical on: still equal", () => {
    for (const m of T1_HANDS.filter((_, i) => i % 11 === 0)) {
      expectSameAsV1(m, { includeVertical: true, gripStyle: "claw" }, "right");
    }
  });
});

describe("T1b: both options off is v1, for every hand", () => {
  const OFF = { clampLength: false, equalWeightsWhenUnknown: false } as const;
  // In range, far above (palm 250 mm -> 165 mm target), far below, off-grid.
  const hands: HandMeasurements[] = [
    hand(105.3, 52.1),
    hand(150, 60),
    hand(190.04, 66.5, 0.55),
    hand(215.55, 75.3, 0.58),
    hand(230, 80),
    hand(250, 87.5, 0.6),
    hand(275.7, 96.1, 0.53),
  ];
  const grips: (GripStyle | undefined)[] = [undefined, ...GRIP_STYLES];

  it.each(SIDES)(
    "%s hand: the whole response but the version",
    (side) => {
      for (const m of hands) {
        for (const g of grips) {
          for (const palmThickness of [undefined, "thick"] as const) {
            const prefs: FitPreferences = {
              includeVertical: false,
              ...(g ? { gripStyle: g } : {}),
              ...(palmThickness ? { palmThickness } : {}),
            };
            const v1 = scoreFitV1(m, seedCatalogue, prefs, side, seedPriors);
            const v2 = scoreFitV2(
              m,
              seedCatalogue,
              prefs,
              side,
              seedPriors,
              OFF,
            );
            expect(v2).not.toHaveProperty("coverage");
            expect(withoutVersion(v2)).toEqual(withoutVersion(v1));
          }
        }
      }
    },
    SLOW,
  );

  it("allowTrackball is passed through like v1's exclusion options", () => {
    const m = hand(250, 87.5);
    const prefs: FitPreferences = { includeVertical: true };
    const v1 = scoreFitV1(m, seedCatalogue, prefs, "right", seedPriors, {
      allowTrackball: true,
    });
    const v2 = scoreFitV2(m, seedCatalogue, prefs, "right", seedPriors, {
      ...OFF,
      allowTrackball: true,
    });
    expect(withoutVersion(v2)).toEqual(withoutVersion(v1));
  });
});
