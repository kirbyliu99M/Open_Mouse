import { describe, expect, it } from "vitest";
import {
  POSE_CHECK_THRESHOLDS,
  classifyPose,
  poseAgrees,
} from "../../src/lib/learning/posecheck";
import { syntheticHand } from "./helpers/synthetic-hand";

describe("the thresholds", () => {
  it("are named in one place, ordered, and leave a band to abstain in", () => {
    const { flatReachMin, clawReachMax, maxPlausibleReach } =
      POSE_CHECK_THRESHOLDS;
    expect(clawReachMax).toBeGreaterThan(0);
    expect(flatReachMin).toBeGreaterThan(clawReachMax);
    expect(maxPlausibleReach).toBeGreaterThan(flatReachMin);
  });
});

describe("classifyPose on synthetic hands", () => {
  it("calls a flat hand with the fingers spread G02", () => {
    const c = classifyPose(syntheticHand({ curl: 0, spread: true }));
    expect(c.predicted).toBe("G02");
    expect(c.reason).toBe("flat");
    expect(c.reach).toBeCloseTo(0.745, 2);
  });

  it("calls a flat hand with the fingers together G02 too: it separates flat from curled, not spread from together", () => {
    const c = classifyPose(syntheticHand({ curl: 0, spread: false }));
    expect(c.predicted).toBe("G02");
    expect(c.reason).toBe("flat");
  });

  it("calls a claw G04, spread or together", () => {
    for (const spread of [true, false]) {
      const c = classifyPose(syntheticHand({ curl: 1, spread }));
      expect(c.predicted).toBe("G04");
      expect(c.reason).toBe("claw");
      expect(c.reach!).toBeLessThan(POSE_CHECK_THRESHOLDS.clawReachMax);
    }
  });

  it("abstains on a hand half-way between flat and claw", () => {
    const c = classifyPose(syntheticHand({ curl: 0.7 }));
    expect(c.predicted).toBeNull();
    expect(c.reason).toBe("between");
    expect(c.reach!).toBeGreaterThan(POSE_CHECK_THRESHOLDS.clawReachMax);
    expect(c.reach!).toBeLessThan(POSE_CHECK_THRESHOLDS.flatReachMin);
  });

  it("reach falls steadily as the hand curls, and the calls follow it", () => {
    const curls = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const reaches = curls.map(
      (curl) => classifyPose(syntheticHand({ curl })).reach!,
    );
    for (let i = 1; i < reaches.length; i++) {
      expect(reaches[i]!).toBeLessThan(reaches[i - 1]!);
    }
    const calls = curls.map(
      (curl) => classifyPose(syntheticHand({ curl })).predicted,
    );
    // Flat at one end, claw at the other, never the wrong way round.
    expect(calls[0]).toBe("G02");
    expect(calls[calls.length - 1]).toBe("G04");
    const firstClaw = calls.indexOf("G04");
    expect(calls.slice(0, firstClaw).includes("G04")).toBe(false);
    expect(calls.slice(firstClaw).includes("G02")).toBe(false);
  });
});

describe("ratios only: size, position, rotation and handedness do not matter", () => {
  const cases = [
    { name: "G02", hand: { curl: 0 } },
    { name: "G04", hand: { curl: 1 } },
    { name: "between", hand: { curl: 0.7 } },
  ] as const;
  const transforms = [
    { scale: 0.01 },
    { scale: 1000 },
    { rotationDeg: 37 },
    { rotationDeg: 180 },
    { rotationDeg: -75, offset: { x: 1234.5, y: -987.6 } },
    { mirror: true },
    { mirror: true, scale: 3.2, rotationDeg: 140, offset: { x: -50, y: 800 } },
  ];

  it.each(cases)("a $name hand reads the same however it is placed", (c) => {
    const base = classifyPose(syntheticHand(c.hand));
    for (const t of transforms) {
      const moved = classifyPose(syntheticHand(c.hand, t));
      expect(moved.predicted).toBe(base.predicted);
      expect(moved.reason).toBe(base.reason);
      expect(moved.reach!).toBeCloseTo(base.reach!, 9);
    }
  });
});

describe("abstains when there is nothing to go on", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty list", []],
    ["twenty landmarks", syntheticHand().slice(0, 20)],
    ["twenty-two landmarks", [...syntheticHand(), { x: 0, y: 0 }]],
  ])("no hand: %s", (_name, landmarks) => {
    const c = classifyPose(landmarks);
    expect(c).toEqual({ predicted: null, reach: null, reason: "no-hand" });
  });

  it("degenerate points: all the same point, a NaN, an infinity", () => {
    const same = Array.from({ length: 21 }, () => ({ x: 5, y: 5 }));
    expect(classifyPose(same).reason).toBe("degenerate");
    const nan = syntheticHand();
    nan[8] = { x: Number.NaN, y: 0 };
    expect(classifyPose(nan)).toEqual({
      predicted: null,
      reach: null,
      reason: "degenerate",
    });
    const inf = syntheticHand();
    inf[12] = { x: Number.POSITIVE_INFINITY, y: 0 };
    expect(classifyPose(inf).predicted).toBeNull();
    // A palm with no length (the wrist on the middle MCP) has no ratio.
    const flatPalm = syntheticHand();
    flatPalm[0] = { ...flatPalm[9]! };
    expect(classifyPose(flatPalm).reason).toBe("degenerate");
  });

  it("points that cannot be one hand: the fingertips far beyond the palm", () => {
    const far = syntheticHand().map((p, i) =>
      [8, 12, 16, 20].includes(i) ? { x: p.x * 6, y: p.y * 6 } : p,
    );
    const c = classifyPose(far);
    expect(c.predicted).toBeNull();
    expect(c.reason).toBe("implausible");
    expect(c.reach!).toBeGreaterThan(POSE_CHECK_THRESHOLDS.maxPlausibleReach);
  });
});

describe("the thresholds' edges", () => {
  /** A flat hand whose fingers are rescaled so that its reach is `target`. */
  function withReach(target: number) {
    const hand = syntheticHand();
    const base = classifyPose(hand).reach!;
    const s = target / base;
    const tips = [8, 12, 16, 20];
    const mcps = [5, 9, 13, 17];
    return hand.map((p, i) => {
      const f = tips.indexOf(i);
      if (f < 0) return p;
      const m = hand[mcps[f]!]!;
      return { x: m.x + (p.x - m.x) * s, y: m.y + (p.y - m.y) * s };
    });
  }
  const eps = 1e-6;

  it("flat at the flat threshold and above, not just below it; claw at the claw threshold and below", () => {
    const { flatReachMin, clawReachMax } = POSE_CHECK_THRESHOLDS;
    expect(classifyPose(withReach(flatReachMin + eps)).predicted).toBe("G02");
    expect(classifyPose(withReach(flatReachMin - eps)).predicted).toBeNull();
    expect(classifyPose(withReach(clawReachMax + eps)).predicted).toBeNull();
    expect(classifyPose(withReach(clawReachMax - eps)).predicted).toBe("G04");
  });
});

describe("poseAgrees", () => {
  it.each([
    ["G02", "G02", true],
    ["G04", "G04", true],
    ["G02", "G04", false],
    ["G04", "G02", false],
    [null, "G02", null],
    [null, "G04", null],
    ["G02", "G01", null],
    ["G04", null, null],
  ] as const)("predicted %s, order says %s: %s", (predicted, expected, out) => {
    expect(poseAgrees(predicted, expected)).toBe(out);
  });
});
