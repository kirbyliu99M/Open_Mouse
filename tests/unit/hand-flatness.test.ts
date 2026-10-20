/**
 * `assessHandFlatness` (scan S3, shadow mode, 未拍板 candidate): the grade of
 * how flat the four fingers look, from 2D landmarks alone. Synthetic hands
 * only; no photo, no MediaPipe. The thresholds under test are R3's simulation
 * candidates, so these tests pin the behaviour (each limit, both sides) and say
 * nothing about whether the limits are right for people.
 */
import { describe, expect, it } from "vitest";
import {
  HAND_FLATNESS_THRESHOLDS,
  assessHandFlatness,
  gradeHandFlatness,
} from "../../src/client/photo/handFlatness";
import { HAND_POSE_BUCKETS } from "../../src/lib/contracts/analytics";
import type { Point2 } from "../../src/client/geometry/homography";
import { curledHandPx } from "./helpers/curled-hand-3d";
import { syntheticHand } from "./helpers/synthetic-hand";

const T = HAND_FLATNESS_THRESHOLDS;

/**
 * A hand whose four fingers are straight, parallel and each exactly `reach` x
 * the palm long (knuckle to tip), with a palm of 1000 px: every number is an
 * integer when `reach` is a multiple of 0.001, so the ratios are exact.
 */
function parallelHand(reach: number): Point2[] {
  const pts: Point2[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  pts[0] = { x: 0, y: 0 };
  // The thumb: anywhere, it is not read.
  for (let i = 1; i <= 4; i++) pts[i] = { x: -100 * i, y: -150 * i };
  const xs = [-200, 0, 200, 400];
  const length = Math.round(reach * 1000);
  xs.forEach((x, f) => {
    const mcp = 5 + 4 * f;
    pts[mcp] = { x, y: -1000 };
    pts[mcp + 1] = { x, y: -1000 - length / 3 };
    pts[mcp + 2] = { x, y: -1000 - (2 * length) / 3 };
    pts[mcp + 3] = { x, y: -1000 - length };
  });
  // The middle knuckle is the palm's end.
  pts[9] = { x: 0, y: -1000 };
  return pts;
}

describe("a flat synthetic hand", () => {
  it.each([true, false])("is flat_like (fingers spread: %s)", (spread) => {
    const out = assessHandFlatness(syntheticHand({ curl: 0, spread }));
    expect(out.pose).toBe("flat_like");
    expect(out.reachMean).toBeGreaterThan(T.borderlineReachBelow);
    expect(out.reachMean).toBeLessThan(T.borderlineReachAbove);
    expect(out.fingerStraightMin).toBeGreaterThanOrEqual(
      T.borderlineStraightBelow,
    );
  });

  it("reads exactly the synthetic hand's finger reach over palm", () => {
    // Palm 100; fingers 81 x k long with k = 0.95, 1, 0.95, 0.78.
    const out = assessHandFlatness(syntheticHand({ curl: 0 }));
    expect(out.reachMean).toBeCloseTo(
      (0.95 * 0.81 + 0.81 + 0.95 * 0.81 + 0.78 * 0.81) / 4,
      10,
    );
    expect(out.fingerStraightMin).toBeCloseTo(1, 10);
  });
});

describe("curled fingers (R3's 3D simulation hand, camera 350 mm above)", () => {
  it("the flat hand reads R3's 0.713 and is flat_like", () => {
    const out = assessHandFlatness(curledHandPx(0));
    expect(out.reachMean).toBeCloseTo(0.713, 2);
    expect(out.pose).toBe("flat_like");
  });
  it("curl c = 0.5 is borderline (R3: reach 0.564)", () => {
    const out = assessHandFlatness(curledHandPx(0.5));
    expect(out.reachMean).toBeCloseTo(0.564, 2);
    expect(out.pose).toBe("borderline");
  });
  it("curl c = 1.0 is extreme (R3: reach 0.182)", () => {
    const out = assessHandFlatness(curledHandPx(1));
    expect(out.reachMean).toBeCloseTo(0.182, 2);
    expect(out.pose).toBe("extreme");
  });
  it("the more curled the lower the reach", () => {
    const reach = [0, 0.1, 0.25, 0.5, 0.75, 1].map(
      (c) => assessHandFlatness(curledHandPx(c)).reachMean!,
    );
    for (let i = 1; i < reach.length; i++)
      expect(reach[i]).toBeLessThan(reach[i - 1]);
  });
  it("the claw-shaped synthetic hand (a different curl model): flat_like, then borderline, then extreme", () => {
    expect(assessHandFlatness(syntheticHand({ curl: 0.5 })).pose).toBe(
      "flat_like",
    );
    expect(assessHandFlatness(syntheticHand({ curl: 0.8 })).pose).toBe(
      "borderline",
    );
    expect(assessHandFlatness(syntheticHand({ curl: 1 })).pose).toBe("extreme");
  });
});

describe("rotation, scale, mirror and position do not change the grade", () => {
  const transforms = [
    { rotationDeg: 37 },
    { rotationDeg: 180 },
    { scale: 0.01 },
    { scale: 1234.5 },
    { mirror: true },
    { mirror: true, rotationDeg: -71, scale: 7.3, offset: { x: 500, y: -90 } },
  ] as const;
  for (const curl of [0, 0.5, 1]) {
    it.each(transforms)(`curl ${curl}, %j`, (transform) => {
      const base = assessHandFlatness(syntheticHand({ curl }));
      const moved = assessHandFlatness(syntheticHand({ curl }, transform));
      expect(moved.pose).toBe(base.pose);
      expect(moved.reachMean).toBeCloseTo(base.reachMean!, 8);
      expect(moved.fingerStraightMin).toBeCloseTo(base.fingerStraightMin!, 8);
    });
  }
});

describe("rotation, scale and mirror, on the 3D hand at c = 0.5 and 1.0", () => {
  const move = (
    pts: readonly Point2[],
    rotationDeg: number,
    scale: number,
    mirror: boolean,
  ): Point2[] => {
    const r = (rotationDeg * Math.PI) / 180;
    return pts.map((p) => {
      const x0 = (mirror ? -p.x : p.x) * scale;
      const y0 = p.y * scale;
      return {
        x: x0 * Math.cos(r) - y0 * Math.sin(r) + 321,
        y: x0 * Math.sin(r) + y0 * Math.cos(r) - 654,
      };
    });
  };
  for (const c of [0, 0.5, 1]) {
    it.each([
      [90, 1, false],
      [-33, 0.3, true],
      [180, 4, true],
    ] as const)(`c ${c}, rotate %s, scale %s, mirror %s`, (rot, sc, mir) => {
      const base = assessHandFlatness(curledHandPx(c));
      const moved = assessHandFlatness(move(curledHandPx(c), rot, sc, mir));
      expect(moved.pose).toBe(base.pose);
      expect(moved.reachMean).toBeCloseTo(base.reachMean!, 8);
    });
  }
});

describe("the thumb is not read", () => {
  it("bending, moving or collapsing the thumb changes nothing", () => {
    for (const curl of [0, 0.5, 1]) {
      const hand = syntheticHand({ curl });
      const base = assessHandFlatness(hand);
      const bent = hand.map((p, i) =>
        i >= 1 && i <= 4 ? { x: p.x * -3 + 17, y: p.y * 0.2 - 40 } : p,
      );
      const collapsed = hand.map((p, i) =>
        i >= 1 && i <= 4 ? { x: 50, y: 50 } : p,
      );
      expect(assessHandFlatness(bent)).toEqual(base);
      expect(assessHandFlatness(collapsed)).toEqual(base);
    }
  });
});

describe("gradeHandFlatness: every limit, both sides", () => {
  const ok = 0.72;
  const straight = 1;
  it.each([
    // [reach, straight, grade]
    // extreme below 0.50 (strict): on the limit is the milder side.
    [T.extremeReachBelow - 0.0001, straight, "extreme"],
    [T.extremeReachBelow, straight, "borderline"],
    [T.extremeReachBelow + 0.0001, straight, "borderline"],
    // extreme above 0.95 (strict).
    [T.extremeReachAbove - 0.0001, straight, "borderline"],
    [T.extremeReachAbove, straight, "borderline"],
    [T.extremeReachAbove + 0.0001, straight, "extreme"],
    // borderline below 0.57 (strict).
    [T.borderlineReachBelow - 0.0001, straight, "borderline"],
    [T.borderlineReachBelow, straight, "flat_like"],
    [T.borderlineReachBelow + 0.0001, straight, "flat_like"],
    // borderline above 0.86 (strict).
    [T.borderlineReachAbove - 0.0001, straight, "flat_like"],
    [T.borderlineReachAbove, straight, "flat_like"],
    [T.borderlineReachAbove + 0.0001, straight, "borderline"],
    // The straightness limits, with a reach in the flat range.
    [ok, T.extremeStraightBelow - 0.0001, "extreme"],
    [ok, T.extremeStraightBelow, "borderline"],
    [ok, T.extremeStraightBelow + 0.0001, "borderline"],
    [ok, T.borderlineStraightBelow - 0.0001, "borderline"],
    [ok, T.borderlineStraightBelow, "flat_like"],
    [ok, T.borderlineStraightBelow + 0.0001, "flat_like"],
    // A straightness above 1 is as good as 1.
    [ok, 1.0001, "flat_like"],
  ] as const)("reach %s, straight %s -> %s", (reach, str, grade) => {
    expect(gradeHandFlatness(reach, str)).toBe(grade);
  });

  it("uses the candidate values R3 gave, spelled out in one place", () => {
    expect(T).toEqual({
      extremeReachBelow: 0.5,
      extremeReachAbove: 0.95,
      extremeStraightBelow: 0.95,
      borderlineReachBelow: 0.57,
      borderlineReachAbove: 0.86,
      borderlineStraightBelow: 0.98,
    });
  });

  it("the worst of the two signals wins", () => {
    expect(gradeHandFlatness(0.56, 0.9)).toBe("extreme");
    expect(gradeHandFlatness(0.72, 0.9)).toBe("extreme");
    expect(gradeHandFlatness(0.45, 1)).toBe("extreme");
    expect(gradeHandFlatness(0.56, 1)).toBe("borderline");
  });
});

describe("assessHandFlatness at the reach limits (exact geometry)", () => {
  it.each([
    [0.45, "extreme"],
    [0.499, "extreme"],
    [0.5, "borderline"],
    [0.569, "borderline"],
    [0.571, "flat_like"],
    [0.72, "flat_like"],
    [0.859, "flat_like"],
    [0.861, "borderline"],
    [0.949, "borderline"],
    [0.951, "extreme"],
  ] as const)("fingers %s x the palm -> %s", (reach, grade) => {
    const out = assessHandFlatness(parallelHand(reach));
    expect(out.reachMean).toBeCloseTo(reach, 9);
    expect(out.fingerStraightMin).toBeGreaterThan(0.999999);
    expect(out.pose).toBe(grade);
  });
});

describe("a finger bent sideways inside the picture (each of the four fingers)", () => {
  const FINGERS = [
    [0, "index"],
    [1, "middle"],
    [2, "ring"],
    [3, "little"],
  ] as const;
  /** Finger `finger` (0 index .. 3 little) as a zigzag of the given amplitude (px, palm 1000, finger 600 long); the other three stay straight. */
  function withZigzag(amplitude: number, finger: number): Point2[] {
    const hand = parallelHand(0.6);
    const x = [-200, 0, 200, 400][finger];
    const mcp = 5 + 4 * finger;
    hand[mcp] = { x, y: -1000 };
    hand[mcp + 1] = { x: x + amplitude, y: -1200 };
    hand[mcp + 2] = { x: x - amplitude, y: -1400 };
    hand[mcp + 3] = { x, y: -1600 };
    return hand;
  }
  it.each(FINGERS)("finger %s (%s): a straight finger reads 1", (finger) => {
    expect(
      assessHandFlatness(withZigzag(0, finger)).fingerStraightMin,
    ).toBeCloseTo(1, 9);
  });
  it.each(FINGERS)("finger %s (%s): a small zigzag is borderline", (finger) => {
    // pieces 202.54, 209.99 and 202.54 px: 600 / 615.07 = 0.9755.
    const out = assessHandFlatness(withZigzag(32, finger));
    expect(out.fingerStraightMin).toBeCloseTo(0.9755, 3);
    expect(out.pose).toBe("borderline");
  });
  it.each(FINGERS)("finger %s (%s): a large zigzag is extreme", (finger) => {
    const out = assessHandFlatness(withZigzag(150, finger));
    expect(out.fingerStraightMin!).toBeLessThan(T.extremeStraightBelow);
    expect(out.pose).toBe("extreme");
  });
  it.each(FINGERS)(
    "finger %s (%s): only the bent finger lowers the minimum, and the reach does not move",
    (finger) => {
      const flatOnes = assessHandFlatness(parallelHand(0.6));
      expect(flatOnes.pose).toBe("flat_like");
      expect(flatOnes.fingerStraightMin).toBeGreaterThan(0.999999);
      expect(assessHandFlatness(withZigzag(150, finger)).reachMean).toBeCloseTo(
        flatOnes.reachMean!,
        9,
      );
    },
  );
  it("the worst finger decides: two bent fingers read the more bent one", () => {
    const hand = withZigzag(32, 0);
    const worse = withZigzag(150, 3);
    for (let i = 17; i <= 20; i++) hand[i] = worse[i];
    const out = assessHandFlatness(hand);
    expect(out.fingerStraightMin).toBeCloseTo(
      assessHandFlatness(withZigzag(150, 3)).fingerStraightMin!,
      9,
    );
    expect(out.pose).toBe("extreme");
  });
});

describe("every one of the four fingers counts toward the reach", () => {
  /** All four fingers 0.6 of the palm, except finger `finger`, which is `reach` of it. */
  function oneFingerAt(finger: number, reach: number): Point2[] {
    const hand = parallelHand(0.6);
    const x = [-200, 0, 200, 400][finger];
    const mcp = 5 + 4 * finger;
    const length = Math.round(reach * 1000);
    hand[mcp + 1] = { x, y: -1000 - length / 3 };
    hand[mcp + 2] = { x, y: -1000 - (2 * length) / 3 };
    hand[mcp + 3] = { x, y: -1000 - length };
    return hand;
  }
  it.each([0, 1, 2, 3])("finger %s curled to 0.1 of the palm: extreme", (f) => {
    const out = assessHandFlatness(oneFingerAt(f, 0.1));
    // (3 x 0.6 + 0.1) / 4
    expect(out.reachMean).toBeCloseTo(0.475, 9);
    expect(out.pose).toBe("extreme");
  });
  it.each([0, 1, 2, 3])("finger %s raised to 3 palms: extreme", (f) => {
    const out = assessHandFlatness(oneFingerAt(f, 3));
    // (3 x 0.6 + 3) / 4
    expect(out.reachMean).toBeCloseTo(1.2, 9);
    expect(out.pose).toBe("extreme");
  });
});

describe("unknown: inputs that are not a usable hand never throw", () => {
  const flat = () => syntheticHand({ curl: 0 });
  const unknown = { pose: "unknown", reachMean: null, fingerStraightMin: null };

  it("fewer or more than 21 points", () => {
    expect(assessHandFlatness(flat().slice(0, 20))).toEqual(unknown);
    expect(assessHandFlatness([])).toEqual(unknown);
    expect(assessHandFlatness([...flat(), { x: 0, y: 0 }])).toEqual(unknown);
  });
  it("null, undefined and things that are not lists", () => {
    expect(assessHandFlatness(null)).toEqual(unknown);
    expect(assessHandFlatness(undefined)).toEqual(unknown);
    expect(assessHandFlatness({} as never)).toEqual(unknown);
    expect(assessHandFlatness("hand" as never)).toEqual(unknown);
  });
  it.each([Number.NaN, Infinity, -Infinity])(
    "a %s coordinate, in any of the 21 points",
    (bad) => {
      for (let i = 0; i < 21; i++) {
        const x = flat();
        x[i] = { x: bad, y: 1 };
        expect(assessHandFlatness(x), `x of ${i}`).toEqual(unknown);
        const y = flat();
        y[i] = { x: 1, y: bad };
        expect(assessHandFlatness(y), `y of ${i}`).toEqual(unknown);
      }
    },
  );
  it("a missing or malformed point", () => {
    const hand = flat() as unknown[];
    hand[7] = null;
    expect(assessHandFlatness(hand as never)).toEqual(unknown);
    hand[7] = { x: "1", y: 2 };
    expect(assessHandFlatness(hand as never)).toEqual(unknown);
    hand[7] = undefined;
    expect(assessHandFlatness(hand as never)).toEqual(unknown);
  });
  it("a palm of zero length (wrist on the middle knuckle)", () => {
    const hand = flat();
    hand[0] = { ...hand[9] };
    expect(assessHandFlatness(hand)).toEqual(unknown);
  });
  it("every point on one spot", () => {
    const hand = Array.from({ length: 21 }, () => ({ x: 5, y: 5 }));
    expect(assessHandFlatness(hand)).toEqual(unknown);
  });
  it("a finger whose joints sit on one spot", () => {
    const hand = flat();
    for (let i = 5; i <= 8; i++) hand[i] = { x: 3, y: 3 };
    expect(assessHandFlatness(hand)).toEqual(unknown);
  });
  it("a throwing point accessor does not escape", () => {
    const hand = flat();
    hand[3] = {
      get x(): number {
        throw new Error("boom");
      },
      y: 1,
    };
    expect(() => assessHandFlatness(hand)).not.toThrow();
    expect(assessHandFlatness(hand)).toEqual(unknown);
  });
});

describe("the output is only a grade and two finite numbers or null", () => {
  it("the grades are the contract's buckets", () => {
    const grades = new Set([
      assessHandFlatness(curledHandPx(0)).pose,
      assessHandFlatness(curledHandPx(0.5)).pose,
      assessHandFlatness(curledHandPx(1)).pose,
      assessHandFlatness(null).pose,
    ]);
    expect(grades).toEqual(new Set(HAND_POSE_BUCKETS));
  });
  it("has exactly three keys, and no number is NaN or infinite", () => {
    for (const hand of [
      syntheticHand({ curl: 0 }),
      syntheticHand({ curl: 1 }),
      null,
    ]) {
      const out = assessHandFlatness(hand);
      expect(Object.keys(out).sort()).toEqual([
        "fingerStraightMin",
        "pose",
        "reachMean",
      ]);
      for (const v of [out.reachMean, out.fingerStraightMin])
        expect(v === null || Number.isFinite(v)).toBe(true);
    }
  });
  it("does not change the landmarks it is given", () => {
    const hand = syntheticHand({ curl: 0.5 });
    const copy = JSON.parse(JSON.stringify(hand));
    assessHandFlatness(hand);
    expect(hand).toEqual(copy);
  });
});
