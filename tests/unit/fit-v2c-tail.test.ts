/**
 * fit-v2.0 candidate, build spec rev2 §4 T2: tail monotonicity on the seed
 * catalogue. As the hand grows from 190 to 280 mm (2.5 mm steps), the top
 * mouse's length should not fall back. For three grips and five width
 * settings, count the steps where it does and the largest fall, for v1 and for
 * v2 with the length clamp only (a stated grip, so the equal-weights option
 * has no effect).
 *
 * The assertion is only "v2 is not worse than v1" on this catalogue. The
 * measured numbers are printed for the PR description (the spec expects v1 29
 * steps / 18.0 mm and length clamp 9 / 10.3 mm on origin/main). It is not a
 * claim for every catalogue: a five-mouse synthetic catalogue exists where
 * the clamp falls back more often (Codex, verify-codex B12).
 */
import { describe, expect, it } from "vitest";
import {
  GRIP_STYLES,
  type FitEntry,
  type GripStyle,
} from "../../src/lib/contracts/fit";
import { scoreFitV1 } from "../../src/server/fit/score-v1";
import { scoreFitV2 } from "../../src/server/fit/score-v2-candidate";
import { hand, seedCatalogue, seedPriors } from "./fit-v2c-fixtures";

const WIDTHS: [string, (h: number) => number][] = [
  ["fixed 68", () => 68],
  ["fixed 72", () => 72],
  ["x0.32", (h) => h * 0.32],
  ["x0.35", (h) => h * 0.35],
  ["x0.38", (h) => h * 0.38],
];

type Top = (h: number, w: number, g: GripStyle) => FitEntry;

function fallbacks(top: Top) {
  let count = 0;
  let maxDropMm = 0;
  for (const g of GRIP_STYLES) {
    for (const [, width] of WIDTHS) {
      let prev: number | null = null;
      for (let step = 0; step <= 36; step++) {
        const h = 190 + step * 2.5;
        const length = top(h, width(h), g).mouse.lengthMm;
        if (prev !== null && length < prev) {
          count += 1;
          maxDropMm = Math.max(maxDropMm, prev - length);
        }
        prev = length;
      }
    }
  }
  return { count, maxDropMm };
}

describe("T2: the top mouse's length falls back no more under v2 than v1", () => {
  it("on the seed catalogue, right hand, 190-280 mm, 3 grips x 5 widths", () => {
    const prefs = (g: GripStyle) => ({ includeVertical: false, gripStyle: g });
    const v1 = fallbacks(
      (h, w, g) =>
        scoreFitV1(hand(h, w), seedCatalogue, prefs(g), "right", seedPriors)
          .results[0]!,
    );
    const v2 = fallbacks(
      (h, w, g) =>
        scoreFitV2(hand(h, w), seedCatalogue, prefs(g), "right", seedPriors, {
          clampLength: true,
          equalWeightsWhenUnknown: false,
        }).results[0]!,
    );
    // For the PR description; not asserted.
    console.log(
      `[T2] v1: ${v1.count} fall-backs, largest ${v1.maxDropMm.toFixed(2)} mm; ` +
        `v2 length clamp: ${v2.count} fall-backs, largest ${v2.maxDropMm.toFixed(2)} mm`,
    );
    expect(v1.count).toBeGreaterThan(0);
    expect(v2.count).toBeLessThanOrEqual(v1.count);
    expect(v2.maxDropMm).toBeLessThanOrEqual(v1.maxDropMm);
  });
});
