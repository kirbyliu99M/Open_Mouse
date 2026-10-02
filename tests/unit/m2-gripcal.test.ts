import { describe, expect, it } from "vitest";
import {
  CURRENT_GRIP_THRESHOLDS,
  bestGripThresholds,
  calibrateGrip,
  gripAgreement,
  gripFromRatio,
  type GripClass,
  type GripSample,
} from "../../src/lib/m2/gripcal";
import { GRIP_PREDICTION } from "../../src/server/fit/coefficients";
import { predictGrip } from "../../src/server/fit/grip";

const sample = (
  participant: string,
  self: GripClass,
  ratio: number,
): GripSample => ({ participant, self, ratio });

// The scenarios below are written against the product's thresholds, whatever
// they are: r values are placed relative to GRIP_PREDICTION, so a later change
// to the product's numbers moves the scenarios with them. A scenario is laid
// out as if claw began at 0.54 and palm at 0.58 (the numbers in the comments);
// `at(offset)` is that r, offset being the distance above 0.54, stretched by
// how far apart the product's two thresholds really are.
const CLAW = GRIP_PREDICTION.clawAtOrAbove;
const PALM = GRIP_PREDICTION.palmAtOrAbove;
const STRETCH = (PALM - CLAW) / 0.04;
const at = (offset: number): number =>
  offset === 0 ? CLAW : offset === 0.04 ? PALM : CLAW + offset * STRETCH;

describe("the current thresholds are the product's, not a copy", () => {
  it("are read from GRIP_PREDICTION", () => {
    expect(CURRENT_GRIP_THRESHOLDS).toEqual({
      palmAtOrAbove: GRIP_PREDICTION.palmAtOrAbove,
      clawAtOrAbove: GRIP_PREDICTION.clawAtOrAbove,
    });
  });

  it("predicts exactly what the product's predictGrip predicts, edges included (the one test that pins the two together)", () => {
    const rs = [CLAW, PALM, CLAW - 1e-7, PALM + 1e-7, PALM - 1e-6, 0.3, 0.9];
    for (let r = 0.3; r <= 0.8; r += 0.001) rs.push(r);
    for (const r of rs) {
      // predictGrip works the ratio out itself: palm / hand, here with hand = 1.
      expect(gripFromRatio(r)).toBe(predictGrip(1, r));
    }
    expect(gripFromRatio(PALM)).toBe("palm");
    expect(gripFromRatio(CLAW)).toBe("claw");
    expect(gripFromRatio(CLAW - 1e-4)).toBe("fingertip");
  });

  it("running the calibration leaves the product's thresholds as they were", () => {
    const before = { ...GRIP_PREDICTION };
    calibrateGrip([
      sample("P001", "palm", at(0.06)),
      sample("P002", "claw", at(-0.04)),
    ]);
    expect(GRIP_PREDICTION).toEqual(before);
  });
});

// Eight people, sorted by r (as if claw began at 0.54 and palm at 0.58):
//   0.50 F  0.53 C  0.54 F  0.55 C  0.56 P  0.58 F  0.585 C  0.60 P
// (F fingertip, C claw, P palm: what each said).
const EIGHT: GripSample[] = [
  sample("P001", "palm", at(0.06)),
  sample("P002", "palm", at(0.02)),
  sample("P003", "claw", at(0.01)),
  sample("P004", "claw", at(-0.01)),
  sample("P005", "claw", at(0.045)),
  sample("P006", "fingertip", at(-0.04)),
  sample("P007", "fingertip", at(0)),
  sample("P008", "fingertip", at(0.04)),
];

describe("confusion matrix with the current thresholds", () => {
  const a = gripAgreement(EIGHT);

  it("counts self-reported (rows) against predicted (columns), edges as the product reads them", () => {
    // r at the claw threshold is claw and r at the palm threshold is palm: both "at or above".
    expect(a.matrix).toEqual({
      palm: { palm: 1, claw: 1, fingertip: 0 },
      claw: { palm: 1, claw: 1, fingertip: 1 },
      fingertip: { palm: 1, claw: 1, fingertip: 1 },
    });
  });

  it("agreement is the diagonal over everyone: 3 of 8", () => {
    expect(a.people).toBe(8);
    expect(a.agree).toBe(3);
    expect(a.rate).toBeCloseTo(0.375, 12);
    expect(a.thresholds).toEqual(CURRENT_GRIP_THRESHOLDS);
  });

  it("nobody: no rate, never 0 percent", () => {
    const none = gripAgreement([]);
    expect(none.rate).toBeNull();
    expect(none.people).toBe(0);
    expect(none.matrix.palm).toEqual({ palm: 0, claw: 0, fingertip: 0 });
  });
});

describe("the pair of thresholds that agrees most", () => {
  // By hand, over the cuts between the sorted r (class order F C F C P F C P):
  // five pairs reach 5 of 8; the one nearest the current thresholds is claw at
  // 0.545, palm at 0.5925 (distance 0.0175 against 0.03, 0.0375, 0.05, 0.055
  // for the others, in the layout where the thresholds are 0.54 and 0.58).
  const best = bestGripThresholds(EIGHT)!;

  it("finds the maximum, 5 of 8, and how many pairs tie for it", () => {
    expect(best.agreement.agree).toBe(5);
    expect(best.agreement.rate).toBeCloseTo(0.625, 12);
    expect(best.tiedPairs).toBe(5);
  });

  it("breaks the tie toward the current thresholds", () => {
    expect(best.agreement.thresholds.palmAtOrAbove).toBeCloseTo(at(0.0525), 10);
    expect(best.agreement.thresholds.clawAtOrAbove).toBeCloseTo(at(0.005), 10);
    // And the pair really is no more than palm >= claw.
    expect(best.agreement.thresholds.palmAtOrAbove).toBeGreaterThanOrEqual(
      best.agreement.thresholds.clawAtOrAbove,
    );
  });

  it("carries the counts behind it: the confusion matrix at that pair", () => {
    expect(best.agreement.matrix).toEqual({
      palm: { palm: 1, claw: 1, fingertip: 0 },
      claw: { palm: 0, claw: 2, fingertip: 1 },
      fingertip: { palm: 0, claw: 1, fingertip: 2 },
    });
    expect(best.agreement.people).toBe(8);
  });

  it("never does worse than the current thresholds", () => {
    expect(best.agreement.agree).toBeGreaterThanOrEqual(
      gripAgreement(EIGHT).agree,
    );
  });

  it("is the same whatever order the people come in", () => {
    const shuffled = [...EIGHT].reverse();
    expect(bestGripThresholds(shuffled)).toEqual(best);
  });

  it("people with the same r are never split by a cut", () => {
    const tie = bestGripThresholds([
      sample("P001", "palm", at(0.06)),
      sample("P002", "fingertip", at(0.06)),
    ])!;
    expect(tie.agreement.agree).toBe(1);
  });

  it("a set that the current thresholds separate perfectly: found, with thresholds between the groups", () => {
    const clean = [
      sample("P001", "fingertip", at(-0.04)),
      sample("P002", "claw", at(0.02)),
      sample("P003", "palm", at(0.06)),
    ];
    const r = calibrateGrip(clean)!;
    expect(r.current.agree).toBe(3);
    expect(r.best.agreement.agree).toBe(3);
    expect(r.best.tiedPairs).toBe(1);
    expect(r.best.agreement.thresholds.palmAtOrAbove).toBeCloseTo(at(0.04), 10);
    expect(r.best.agreement.thresholds.clawAtOrAbove).toBeCloseTo(
      at(-0.01),
      10,
    );
  });

  it("everybody in one class: the cuts sit just outside the observed range", () => {
    const claws = [
      sample("P001", "claw", at(0.01)),
      sample("P002", "claw", at(0.02)),
      sample("P003", "claw", at(0.03)),
    ];
    const r = bestGripThresholds(claws)!;
    expect(r.agreement.agree).toBe(3);
    expect(r.agreement.thresholds.clawAtOrAbove).toBeCloseTo(
      at(0.01) - 0.0005,
      10,
    );
    expect(r.agreement.thresholds.palmAtOrAbove).toBeCloseTo(
      at(0.03) + 0.0005,
      10,
    );
    expect(r.tiedPairs).toBe(1);
  });

  it("nobody: nothing to search", () => {
    expect(bestGripThresholds([])).toBeNull();
    expect(calibrateGrip([])).toBeNull();
  });

  it("reports both views together", () => {
    const r = calibrateGrip(EIGHT)!;
    expect(r.current.agree).toBe(3);
    expect(r.best.agreement.agree).toBe(5);
  });
});

// The last tie-break: pairs that agree equally AND lie equally far from the
// current thresholds. The r values and thresholds below are multiples of 1/16,
// so every midpoint and every distance is exact in floating point and "equally
// far" is exactly equal. They are the caller's `current`, not the product's.
describe("the final tie-break: equally good, equally far from the current pair", () => {
  it("the lower claw threshold wins when the palm thresholds are the same", () => {
    const samples = [
      sample("P001", "fingertip", 0.3125),
      sample("P002", "claw", 0.625),
      sample("P003", "claw", 0.5625),
      sample("P004", "fingertip", 0.75),
      sample("P005", "palm", 0.4375),
    ];
    const current = { palmAtOrAbove: 0.625, clawAtOrAbove: 0.4375 };
    const best = bestGripThresholds(samples, current)!;
    // Two pairs reach 3 of 5 at distance 0.125: (palm 0.6875, claw 0.375) and
    // (palm 0.6875, claw 0.5). The lower claw threshold is the one reported.
    expect(best.agreement.agree).toBe(3);
    expect(best.tiedPairs).toBe(4);
    expect(best.agreement.thresholds).toEqual({
      palmAtOrAbove: 0.6875,
      clawAtOrAbove: 0.375,
    });
  });

  it("the lower palm threshold wins when the pairs differ in both", () => {
    const samples = [
      sample("P001", "claw", 0.5625),
      sample("P002", "palm", 0.75),
      sample("P003", "palm", 0.5),
      sample("P004", "fingertip", 0.375),
      sample("P005", "fingertip", 0.4375),
    ];
    const current = { palmAtOrAbove: 0.5625, clawAtOrAbove: 0.4375 };
    const best = bestGripThresholds(samples, current)!;
    // (palm 0.46875, claw 0.46875) and (palm 0.65625, claw 0.46875) both reach
    // 4 of 5 at distance 0.125; the lower palm threshold is reported.
    expect(best.agreement.agree).toBe(4);
    expect(best.tiedPairs).toBe(3);
    expect(best.agreement.thresholds).toEqual({
      palmAtOrAbove: 0.46875,
      clawAtOrAbove: 0.46875,
    });
  });
});
