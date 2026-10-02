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

describe("the current thresholds are the product's, not a copy", () => {
  it("are 0.58 (palm) and 0.54 (claw) and are read from GRIP_PREDICTION", () => {
    expect(CURRENT_GRIP_THRESHOLDS).toEqual({
      palmAtOrAbove: 0.58,
      clawAtOrAbove: 0.54,
    });
    expect(CURRENT_GRIP_THRESHOLDS.palmAtOrAbove).toBe(
      GRIP_PREDICTION.palmAtOrAbove,
    );
    expect(CURRENT_GRIP_THRESHOLDS.clawAtOrAbove).toBe(
      GRIP_PREDICTION.clawAtOrAbove,
    );
  });

  it("predicts exactly what the product's predictGrip predicts, edges included", () => {
    const rs = [0.54, 0.58, 0.5399999, 0.5800001, 0.579999, 0.3, 0.9];
    for (let r = 0.4; r <= 0.7; r += 0.001) rs.push(r);
    for (const r of rs) {
      // predictGrip works the ratio out itself: palm / hand, here with hand = 1.
      expect(gripFromRatio(r)).toBe(predictGrip(1, r));
    }
    expect(gripFromRatio(0.58)).toBe("palm");
    expect(gripFromRatio(0.54)).toBe("claw");
    expect(gripFromRatio(0.5399)).toBe("fingertip");
  });

  it("running the calibration leaves the product's thresholds as they were", () => {
    calibrateGrip([sample("P001", "palm", 0.6), sample("P002", "claw", 0.5)]);
    expect(GRIP_PREDICTION).toEqual({
      palmAtOrAbove: 0.58,
      clawAtOrAbove: 0.54,
    });
  });
});

// Eight people, sorted by r:
//   0.50 F  0.53 C  0.54 F  0.55 C  0.56 P  0.58 F  0.585 C  0.60 P
// (F fingertip, C claw, P palm: what each said).
const EIGHT: GripSample[] = [
  sample("P001", "palm", 0.6),
  sample("P002", "palm", 0.56),
  sample("P003", "claw", 0.55),
  sample("P004", "claw", 0.53),
  sample("P005", "claw", 0.585),
  sample("P006", "fingertip", 0.5),
  sample("P007", "fingertip", 0.54),
  sample("P008", "fingertip", 0.58),
];

describe("confusion matrix with the current thresholds", () => {
  const a = gripAgreement(EIGHT);

  it("counts self-reported (rows) against predicted (columns), edges as the product reads them", () => {
    // r = 0.54 is claw and r = 0.58 is palm: both "at or above".
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
  // five pairs reach 5 of 8; the one nearest 0.58 / 0.54 is claw >= 0.545,
  // palm >= 0.5925 (distance 0.0175; the others are 0.03, 0.0375, 0.05, 0.055).
  const best = bestGripThresholds(EIGHT)!;

  it("finds the maximum, 5 of 8, and how many pairs tie for it", () => {
    expect(best.agreement.agree).toBe(5);
    expect(best.agreement.rate).toBeCloseTo(0.625, 12);
    expect(best.tiedPairs).toBe(5);
  });

  it("breaks the tie toward the current thresholds", () => {
    expect(best.agreement.thresholds.palmAtOrAbove).toBeCloseTo(0.5925, 10);
    expect(best.agreement.thresholds.clawAtOrAbove).toBeCloseTo(0.545, 10);
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
      sample("P001", "palm", 0.6),
      sample("P002", "fingertip", 0.6),
    ])!;
    expect(tie.agreement.agree).toBe(1);
  });

  it("a set that the current thresholds separate perfectly: found, with thresholds between the groups", () => {
    const clean = [
      sample("P001", "fingertip", 0.5),
      sample("P002", "claw", 0.56),
      sample("P003", "palm", 0.6),
    ];
    const r = calibrateGrip(clean)!;
    expect(r.current.agree).toBe(3);
    expect(r.best.agreement.agree).toBe(3);
    expect(r.best.tiedPairs).toBe(1);
    expect(r.best.agreement.thresholds.palmAtOrAbove).toBeCloseTo(0.58, 10);
    expect(r.best.agreement.thresholds.clawAtOrAbove).toBeCloseTo(0.53, 10);
  });

  it("everybody in one class: the cuts sit just outside the observed range", () => {
    const claws = [
      sample("P001", "claw", 0.55),
      sample("P002", "claw", 0.56),
      sample("P003", "claw", 0.57),
    ];
    const r = bestGripThresholds(claws)!;
    expect(r.agreement.agree).toBe(3);
    expect(r.agreement.thresholds.clawAtOrAbove).toBeCloseTo(0.5495, 10);
    expect(r.agreement.thresholds.palmAtOrAbove).toBeCloseTo(0.5705, 10);
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
