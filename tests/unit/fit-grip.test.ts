import { describe, expect, it } from "vitest";
import { predictGrip } from "../../src/server/fit/grip";
import { computeTargets } from "../../src/server/fit/targets";

describe("predictGrip", () => {
  it.each([
    // [handLengthMm, palmLengthMm, r, expected] — §1 boundaries
    [100, 58, 0.58, "palm"], //      r exactly 0.58 → palm (>=)
    [100, 57.9, 0.579, "claw"], //   just under 0.58 → claw
    [100, 54, 0.54, "claw"], //      r exactly 0.54 → claw (>=)
    [100, 53.9, 0.539, "fingertip"], // just under 0.54 → fingertip
    [200, 130, 0.65, "palm"],
    [200, 100, 0.5, "fingertip"],
  ] as const)(
    "handLength=%s palmLength=%s (r=%s) → %s",
    (handLengthMm, palmLengthMm, _r, expected) => {
      expect(predictGrip(handLengthMm, palmLengthMm)).toBe(expected);
    },
  );
});

describe("computeTargets", () => {
  it.each([
    // [handLengthMm, palmWidthMm, grip, lengthMm, gripWidthMm, heightMm]
    [190, 80, "palm", 125.4, 70.4, 39.9],
    [190, 80, "claw", 117.8, 70.4, 38],
    [190, 80, "fingertip", 110.2, 70.4, 34.2],
  ] as const)(
    "hand=%s width=%s grip=%s → L%s W%s H%s",
    (handLengthMm, palmWidthMm, grip, lengthMm, gripWidthMm, heightMm) => {
      const t = computeTargets(handLengthMm, palmWidthMm, grip);
      expect(t.lengthMm).toBeCloseTo(lengthMm, 5);
      expect(t.gripWidthMm).toBeCloseTo(gripWidthMm, 5);
      expect(t.heightMm).toBeCloseTo(heightMm, 5);
    },
  );
});
