/**
 * V3.2 F19 (candidate): the pure pieces — the hand-and-arm mask
 * (handMask.ts), a side's ends (quad-math.ts), when the pipeline looks a
 * second time and which answer it keeps (secondLook.ts), the live hint, and
 * the covered-edge relief (gates.ts, not wired: it needs a contract change).
 */
import { describe, expect, it } from "vitest";
import type { Point2 } from "../../src/client/geometry/homography";
import {
  HAND_MASK,
  buildHandMask,
  excludeCoveredPoints,
  handLandmarksOf,
  isCoveredByHand,
  rasterizeHandMask,
} from "../../src/client/paper/handMask";
import { sideEndsSeen } from "../../src/client/paper/quad-math";
import {
  adoptSecondLook,
  planSecondLook,
} from "../../src/client/paper/secondLook";
import {
  PAPER_EDGE_HIDDEN_RELIEF,
  coveredEdgeTolerated,
} from "../../src/client/photo/gates";
import { liveHandHint } from "../../src/client/camera/noSheetCapture";
import { PAPER_EDGE_LIMITS } from "../../src/lib/contracts/measurement";

/** A simple upright hand: wrist at (200, 400), knuckles 100 px above it, palm width (5 to 17) 80 px. */
function uprightHand(): Point2[] {
  const pts: Point2[] = [];
  for (let i = 0; i < 21; i++) pts.push({ x: 200, y: 350 });
  pts[0] = { x: 200, y: 400 };
  pts[5] = { x: 160, y: 300 };
  pts[9] = { x: 190, y: 295 };
  pts[13] = { x: 215, y: 298 };
  pts[17] = { x: 240, y: 305 };
  pts[8] = { x: 160, y: 200 };
  pts[12] = { x: 190, y: 190 };
  pts[16] = { x: 215, y: 200 };
  pts[20] = { x: 240, y: 230 };
  pts[4] = { x: 110, y: 330 };
  return pts;
}

describe("buildHandMask", () => {
  it("is null without 21 finite landmarks or with a palm under 1 px", () => {
    expect(buildHandMask(null, 640, 480)).toBeNull();
    expect(buildHandMask(uprightHand().slice(0, 20), 640, 480)).toBeNull();
    const nan = uprightHand();
    nan[3] = { x: Number.NaN, y: 1 };
    expect(buildHandMask(nan, 640, 480)).toBeNull();
    const tiny = uprightHand();
    tiny[17] = { ...tiny[5]! };
    expect(buildHandMask(tiny, 640, 480)).toBeNull();
  });

  it("sizes the margin in palm widths and runs the arm away from the middle knuckle, past the frame", () => {
    const mask = buildHandMask(uprightHand(), 640, 480)!;
    const palmWidth = Math.hypot(240 - 160, 305 - 300);
    expect(mask.marginPx).toBeCloseTo(HAND_MASK.marginPalmWidths * palmWidth);
    // The arm leaves the wrist downwards (the knuckles are above it).
    const far = mask.arm[1]!;
    expect(far.y).toBeGreaterThan(480);
    // Covered: the palm, the fingertips, a point down the arm off the frame's
    // bottom, a point just past a fingertip within the margin.
    for (const p of [
      { x: 200, y: 330 },
      { x: 190, y: 190 },
      { x: 205, y: 470 },
      { x: 190, y: 190 - 0.9 * mask.marginPx },
    ])
      expect(isCoveredByHand(p, mask), JSON.stringify(p)).toBe(true);
    // Not covered: well beside the hand, above the fingers past the margin,
    // beside the arm past its half width and margin.
    const armEdge = HAND_MASK.armHalfWidthPalmWidths * palmWidth;
    for (const p of [
      { x: 500, y: 300 },
      { x: 190, y: 190 - 3 * mask.marginPx },
      { x: 200 + armEdge + 1.6 * mask.marginPx, y: 470 },
    ])
      expect(isCoveredByHand(p, mask), JSON.stringify(p)).toBe(false);
  });

  it("excludeCoveredPoints keeps the order of the rest and counts what it left out", () => {
    const mask = buildHandMask(uprightHand(), 640, 480)!;
    const pts = [
      { x: 10, y: 10 },
      { x: 200, y: 330 },
      { x: 600, y: 50 },
    ];
    expect(excludeCoveredPoints(pts, mask)).toStrictEqual({
      kept: [pts[0], pts[2]],
      excluded: 1,
    });
  });

  it("rasterizeHandMask marks exactly the pixel centres isCoveredByHand covers", () => {
    const W = 320;
    const H = 480;
    const mask = buildHandMask(uprightHand(), W, H)!;
    const raster = rasterizeHandMask(mask, W, H);
    let mismatches = 0;
    let marked = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const covered = isCoveredByHand({ x: x + 0.5, y: y + 0.5 }, mask);
        if (covered !== (raster[y * W + x] === 1)) mismatches++;
        if (covered) marked++;
      }
    expect(mismatches).toBe(0);
    expect(marked).toBeGreaterThan(1000);
  });

  it("handLandmarksOf copies 21 finite points and refuses anything less", () => {
    const hand = uprightHand();
    const copy = handLandmarksOf(hand)!;
    expect(copy).toStrictEqual(hand);
    expect(copy[0]).not.toBe(hand[0]);
    expect(handLandmarksOf(hand.slice(0, 5))).toBeNull();
    expect(handLandmarksOf(undefined)).toBeNull();
  });
});

describe("sideEndsSeen", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 400, y: 0 };
  it("is true only when points reach both the first and the last tenth", () => {
    expect(
      sideEndsSeen(
        [
          { x: 5, y: 0 },
          { x: 395, y: 1 },
        ],
        a,
        b,
      ),
    ).toBe(true);
    expect(
      sideEndsSeen(
        [
          { x: 5, y: 0 },
          { x: 200, y: 0 },
        ],
        a,
        b,
      ),
    ).toBe(false);
    expect(sideEndsSeen([{ x: 395, y: 0 }], a, b)).toBe(false);
    // Off the segment does not count.
    expect(
      sideEndsSeen(
        [
          { x: -5, y: 0 },
          { x: 405, y: 0 },
        ],
        a,
        b,
      ),
    ).toBe(false);
    expect(sideEndsSeen([{ x: 0, y: 0 }], a, a)).toBe(false);
  });
});

describe("planSecondLook / adoptSecondLook (secondLook.ts)", () => {
  const palm = [{ x: 1, y: 1 }];
  const hand = uprightHand();

  it("no hand and no palm: never a second call", () => {
    expect(
      planSecondLook({
        firstHasCorners: false,
        firstOk: false,
        palm: null,
        holdsPalm: false,
        hand: null,
      }),
    ).toBeNull();
  });

  it("a sheet that held the palm and passed: never a second call (the photo is as it was)", () => {
    expect(
      planSecondLook({
        firstHasCorners: true,
        firstOk: true,
        palm,
        holdsPalm: true,
        hand,
      }),
    ).toBeNull();
  });

  it("F17 only: a passing sheet that does not hold the palm is looked at with the palm, not the hand", () => {
    expect(
      planSecondLook({
        firstHasCorners: true,
        firstOk: true,
        palm,
        holdsPalm: false,
        hand,
      }),
    ).toStrictEqual({ palmPointsPx: palm });
  });

  it("F19: a failed paper check with the hand known carries the hand; with the palm off the sheet, both", () => {
    expect(
      planSecondLook({
        firstHasCorners: true,
        firstOk: false,
        palm,
        holdsPalm: true,
        hand,
      }),
    ).toStrictEqual({ handLandmarksPx: hand });
    expect(
      planSecondLook({
        firstHasCorners: false,
        firstOk: false,
        palm,
        holdsPalm: false,
        hand,
      }),
    ).toStrictEqual({ palmPointsPx: palm, handLandmarksPx: hand });
  });

  it("keeps F17's rule for a palm-only call, and takes a hand call that passes or that found the corners the first did not", () => {
    const palmOnly = { palmPointsPx: palm };
    const withHand = { handLandmarksPx: hand };
    const base = {
      palmChose: false,
      firstHasCorners: true,
      secondHasCorners: true,
      secondOk: true,
    };
    expect(adoptSecondLook({ ...base, plan: palmOnly })).toBe(false);
    expect(adoptSecondLook({ ...base, plan: palmOnly, palmChose: true })).toBe(
      true,
    );
    expect(adoptSecondLook({ ...base, plan: withHand })).toBe(true);
    expect(adoptSecondLook({ ...base, plan: withHand, secondOk: false })).toBe(
      false,
    );
    expect(
      adoptSecondLook({
        ...base,
        plan: withHand,
        secondOk: false,
        firstHasCorners: false,
      }),
    ).toBe(true);
    expect(
      adoptSecondLook({
        ...base,
        plan: withHand,
        secondOk: false,
        firstHasCorners: false,
        secondHasCorners: false,
      }),
    ).toBe(false);
  });
});

describe("liveHandHint (F19, the live detector's hand)", () => {
  const hand = uprightHand();
  it("gives the 21 landmarks under livePalmHint's conditions only", () => {
    const latest = { atMs: 1000, points: hand };
    expect(
      liveHandHint({ latest, nowMs: 1100, width: 640, height: 480 }),
    ).toStrictEqual(hand);
    expect(
      liveHandHint({ latest, nowMs: 1_000_000, width: 640, height: 480 }),
    ).toBeUndefined();
    expect(
      liveHandHint({ latest, nowMs: 1100, width: 100, height: 100 }),
    ).toBeUndefined();
    expect(
      liveHandHint({ latest: null, nowMs: 1100, width: 640, height: 480 }),
    ).toBeUndefined();
  });
});

describe("coveredEdgeTolerated (candidate, NOT wired: contract change needed)", () => {
  const ends: [boolean, boolean, boolean, boolean] = [true, true, true, true];
  it("the measured case (實測): one side at 22.5 %, its ends seen, the rest complete, four corners", () => {
    expect(
      coveredEdgeTolerated({
        cornersSeen: 4,
        sideCoverages: [1, 0.225, 1, 0.95],
        sideEndsSeen: ends,
      }),
    ).toBe(true);
  });

  it("refuses when the low side's ends are not both seen, it is under the relief floor, two sides are low, or a corner is missing", () => {
    expect(
      coveredEdgeTolerated({
        cornersSeen: 4,
        sideCoverages: [1, 0.225, 1, 0.95],
        sideEndsSeen: [true, false, true, true],
      }),
    ).toBe(false);
    expect(
      coveredEdgeTolerated({
        cornersSeen: 4,
        sideCoverages: [1, PAPER_EDGE_HIDDEN_RELIEF.minCoverage - 0.01, 1, 1],
        sideEndsSeen: ends,
      }),
    ).toBe(false);
    expect(
      coveredEdgeTolerated({
        cornersSeen: 4,
        sideCoverages: [1, 0.3, 0.35, 1],
        sideEndsSeen: ends,
      }),
    ).toBe(false);
    expect(
      coveredEdgeTolerated({
        cornersSeen: 3,
        sideCoverages: [1, 0.3, 1, 1],
        sideEndsSeen: ends,
      }),
    ).toBe(false);
  });

  it("nothing low: nothing to tolerate (the ordinary gate already passes)", () => {
    expect(
      coveredEdgeTolerated({
        cornersSeen: 4,
        sideCoverages: [1, PAPER_EDGE_LIMITS.minSideCoverage, 1, 1],
        sideEndsSeen: ends,
      }),
    ).toBe(false);
  });
});
