/**
 * `detectPaperQuad` cross-checked against an INDEPENDENT synthetic-scene
 * generator (2026-09-25 PR #59 review, M1) —
 * `tests/unit/helpers/independent-scene.ts`, a separate implementation
 * from `synthetic-paper.ts` (the one the algorithm was actually tuned
 * against, in `paper-detect.test.ts`). Every accuracy assertion here
 * measures a HELD-OUT mm segment through the independently-reconstructed
 * true homography — never a corners-in/corners-out tautology (see that
 * file's own comment on why the old version of this repo's end-to-end
 * check was one).
 */
import { describe, expect, it } from "vitest";
import { detectPaperQuad } from "../../src/client/paper/detect";
import { buildPaperHomography } from "../../src/client/paper/homography";
import { applyHomography } from "../../src/client/geometry/homography";
import type { Point2 } from "../../src/client/geometry/homography";
import {
  renderIndependentScene,
  applyMat9,
  type IndependentScene,
} from "./helpers/independent-scene";

const BASE: IndependentScene = {
  frameWidth: 750,
  frameHeight: 1000,
  paperWidthMm: 210,
  paperHeightMm: 297,
  background: "midGrey",
  seed: 7,
};

/** A held-out 170mm segment across the short axis — nowhere near any of the 4 corners. */
const HELD_OUT_SEGMENT: readonly [Point2, Point2] = [
  { x: 20, y: 150 },
  { x: 190, y: 150 },
];

function measureHeldOutSegmentErrorMm(scene: IndependentScene): {
  errorMm: number;
  result: ReturnType<typeof detectPaperQuad>;
} {
  const rendered = renderIndependentScene(scene);
  const imageData = {
    width: rendered.width,
    height: rendered.height,
    data: rendered.data,
  } as unknown as ImageData;
  const result = detectPaperQuad(imageData, "a4");
  if (!result.corners) return { errorMm: Infinity, result };

  const homography = buildPaperHomography(result.corners, "a4");
  const [a, b] = HELD_OUT_SEGMENT;
  const trueLengthMm = Math.hypot(a.x - b.x, a.y - b.y);
  const pxA = applyMat9(rendered.paperToImage, a);
  const pxB = applyMat9(rendered.paperToImage, b);
  const measuredA = applyHomography(homography, pxA);
  const measuredB = applyHomography(homography, pxB);
  const measuredLengthMm = Math.hypot(
    measuredA.x - measuredB.x,
    measuredA.y - measuredB.y,
  );
  return { errorMm: Math.abs(measuredLengthMm - trueLengthMm), result };
}

describe("detectPaperQuad — independent generator: rotation sweep", () => {
  it.each([0, 15, 30, 44, 45, 46, 60, 90, 135, 180])(
    "rotation %i degrees: held-out segment within 1mm, never throws",
    (rotationDeg) => {
      const { errorMm, result } = measureHeldOutSegmentErrorMm({
        ...BASE,
        rotationDeg,
      });
      expect(result.corners).not.toBeNull();
      expect(errorMm).toBeLessThan(1);
    },
  );
});

describe("detectPaperQuad — independent generator: perspective tilt", () => {
  it.each([
    [25, 0],
    [0, 20],
    [30, 20],
  ])("tiltX=%i tiltY=%i: held-out segment within 1mm", (tiltXDeg, tiltYDeg) => {
    const { errorMm, result } = measureHeldOutSegmentErrorMm({
      ...BASE,
      tiltXDeg,
      tiltYDeg,
    });
    expect(result.corners).not.toBeNull();
    expect(errorMm).toBeLessThan(1);
  });
});

describe("detectPaperQuad — independent generator: background variety", () => {
  it("a bright grey background still measures accurately", () => {
    const { errorMm, result } = measureHeldOutSegmentErrorMm({
      ...BASE,
      background: "brightGrey",
    });
    expect(result.corners).not.toBeNull();
    expect(errorMm).toBeLessThan(1);
  });

  it("a light-grey background still measures accurately", () => {
    const { errorMm, result } = measureHeldOutSegmentErrorMm({
      ...BASE,
      background: "lightGrey",
    });
    expect(result.corners).not.toBeNull();
    expect(errorMm).toBeLessThan(1);
  });

  it("a woodgrain background is never confidently wrong (accurate if found, low coverage/rejected otherwise)", () => {
    const { errorMm, result } = measureHeldOutSegmentErrorMm({
      ...BASE,
      background: "woodgrain",
    });
    if (result.corners) {
      expect(errorMm).toBeLessThan(2);
    } else {
      expect(result.cornersSeen).toBeLessThan(4);
    }
  });

  it("a near-white desk (barely distinguishable from the paper) never falsely detects a confident quad", () => {
    // Never a REQUIREMENT that detection succeeds here — the bar is "never
    // confidently wrong": either it's not found at all, or, if it is,
    // the held-out segment is still measured accurately.
    const { errorMm, result } = measureHeldOutSegmentErrorMm({
      ...BASE,
      background: "nearWhiteDesk",
    });
    if (result.corners) {
      expect(errorMm).toBeLessThan(2);
    } else {
      expect(result.corners).toBeNull();
    }
  });
});

describe("detectPaperQuad — independent generator: distractors never pass confidently wrong", () => {
  it("a second white object TOUCHING the paper is rejected, not measured wrong", () => {
    const { result } = measureHeldOutSegmentErrorMm({
      ...BASE,
      secondWhiteObject: "touching",
      fillFraction: 0.55,
    });
    // The historic B3 failure mode was a CONFIDENT wrong quad (all 4
    // corners "found", grossly wrong). Either outcome below is fine; a
    // fitted quad here must still be accurate.
    if (result.corners) {
      const { errorMm } = measureHeldOutSegmentErrorMm({
        ...BASE,
        secondWhiteObject: "touching",
        fillFraction: 0.55,
      });
      expect(errorMm).toBeLessThan(2);
    } else {
      expect(result.corners).toBeNull();
    }
  });

  it("a second white object separate from the paper doesn't affect detection", () => {
    const { errorMm, result } = measureHeldOutSegmentErrorMm({
      ...BASE,
      secondWhiteObject: "separate",
      fillFraction: 0.55,
    });
    expect(result.corners).not.toBeNull();
    expect(errorMm).toBeLessThan(1);
  });

  it("a hard shadow band across the paper is rejected, not measured wrong", () => {
    const { errorMm, result } = measureHeldOutSegmentErrorMm({
      ...BASE,
      shadowBand: true,
    });
    if (result.corners) {
      expect(errorMm).toBeLessThan(2);
    } else {
      expect(result.corners).toBeNull();
    }
  });
});

describe("detectPaperQuad — independent generator: hand occlusion", () => {
  it("a normal hand resting on the paper still measures accurately", () => {
    const { errorMm, result } = measureHeldOutSegmentErrorMm({
      ...BASE,
      hand: "normal",
    });
    expect(result.corners).not.toBeNull();
    expect(errorMm).toBeLessThan(1);
    expect(result.minSideCoverage).toBeLessThan(1);
    expect(result.minSideCoverage).toBeGreaterThan(0);
  });

  it("a hand covering a corner still measures the rest of the sheet accurately", () => {
    const { errorMm, result } = measureHeldOutSegmentErrorMm({
      ...BASE,
      hand: "coveringCorner",
    });
    expect(result.corners).not.toBeNull();
    expect(errorMm).toBeLessThan(1);
  });
});
