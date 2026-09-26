/**
 * `detectPaperQuad` against synthetic photos of a blank sheet
 * (`tests/unit/helpers/synthetic-paper.ts`): random perspective, uneven
 * lighting, noise, a slight blur pass and — for a subset of cases — a
 * skin-tone hand/wrist occluder crossing the bottom edge. The generator
 * knows the exact (sub-pixel) corners it rendered, so these are true
 * numeric accuracy tests, not just "did it find something".
 */
import { describe, expect, it } from "vitest";
import { detectPaperQuad } from "../../src/client/paper/detect";
import {
  buildPaperHomography,
  localScaleMmPerPx,
  quadCentroid,
} from "../../src/client/paper/homography";
import { generateSyntheticPaper } from "./helpers/synthetic-paper";
import { PAPER_EDGE_LIMITS } from "../../src/lib/contracts/measurement";
import {
  applyHomography,
  estimateHomography,
  type Point2,
} from "../../src/client/geometry/homography";

/**
 * The generator's exact (noiseless) sheet-mm → image-px homography,
 * reconstructed from its 4 known true corners — a 4-point DLT fit passes
 * through its own correspondences exactly, so this recovers the same
 * pinhole projection `generateSyntheticPaper` used internally. Lets tests
 * project HELD-OUT mm points (not the 4 corners `detectPaperQuad` itself
 * returns) into the image, for a non-tautological accuracy check — see
 * this describe block's own comment for why the corners-only version was
 * tautological.
 */
function trueMmToPxHomography(trueCorners: readonly Point2[]) {
  const mmCorners: Point2[] = [
    { x: 0, y: 0 },
    { x: 210, y: 0 },
    { x: 210, y: 297 },
    { x: 0, y: 297 },
  ];
  return estimateHomography(
    mmCorners.map((src, i) => ({ src, dst: trueCorners[i] })),
  );
}

const SEED_COUNT = 20;
const SEED_BASE = 100000;

function seeds(): number[] {
  return Array.from({ length: SEED_COUNT }, (_, i) => SEED_BASE + i * 7919);
}

function maxCornerErrorPx(
  detected: readonly Point2[],
  truth: readonly Point2[],
): number {
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    worst = Math.max(
      worst,
      Math.hypot(detected[i].x - truth[i].x, detected[i].y - truth[i].y),
    );
  }
  return worst;
}

describe("detectPaperQuad — corner accuracy on synthetic photos (1000px wide)", () => {
  const width = 1000;
  const height = 750;

  it.each(seeds())("seed %i: corner error <= 1.0px", (seed) => {
    const occluder = seed % 3 === 0;
    const case_ = generateSyntheticPaper({ width, height, seed, occluder });
    const imageData = {
      width,
      height,
      data: case_.data,
    } as unknown as ImageData;
    const result = detectPaperQuad(imageData, "a4");

    expect(result.corners).not.toBeNull();
    const err = maxCornerErrorPx(result.corners!, case_.trueCorners);
    expect(err).toBeLessThanOrEqual(1.0);

    // Coverage and residual should be sensible: full when unoccluded,
    // reduced but still well above the gate floor when occluded; residual
    // always tiny for a flat, undistorted sheet.
    if (occluder) {
      expect(result.minSideCoverage).toBeGreaterThanOrEqual(
        PAPER_EDGE_LIMITS.minSideCoverage,
      );
      expect(result.minSideCoverage).toBeLessThan(1);
    } else {
      expect(result.minSideCoverage).toBe(1);
    }
    expect(result.edgeFitResidualPx).toBeGreaterThanOrEqual(0);
    expect(result.edgeFitResidualPx).toBeLessThan(3);
    expect(result.cornersSeen).toBe(4);
    expect(result.cornersFound).toEqual([true, true, true, true]);
  });
});

describe("detectPaperQuad — corner accuracy on synthetic photos (640px wide)", () => {
  const width = 640;
  const height = 480;

  it.each(seeds())("seed %i: corner error <= 1.5px", (seed) => {
    const occluder = seed % 3 === 0;
    const case_ = generateSyntheticPaper({ width, height, seed, occluder });
    const imageData = {
      width,
      height,
      data: case_.data,
    } as unknown as ImageData;
    const result = detectPaperQuad(imageData, "a4");

    expect(result.corners).not.toBeNull();
    const err = maxCornerErrorPx(result.corners!, case_.trueCorners);
    expect(err).toBeLessThanOrEqual(1.5);
  });
});

describe("detectPaperQuad — end-to-end numeric check via the homography", () => {
  /**
   * NOT the same check as "does `buildPaperHomography(result.corners!)`
   * map `result.corners!` back to (0,0)/(210,0)/.../(0,297)" — that would
   * be tautological (a 4-point DLT homography passes through its own 4
   * defining correspondences almost exactly regardless of whether those
   * corners are anywhere near the truth; PR #59 review, M1). This instead
   * measures a HELD-OUT 170mm and 257mm segment — two points nowhere near
   * any of the 4 corners — projected into the image via the generator's
   * OWN exact pinhole homography, then measured back out in mm via the
   * DETECTED homography, and compared to their true mm length.
   */
  it("a held-out 170mm/257mm segment measures back within 0.5mm", () => {
    const width = 1000;
    const height = 750;
    const seed = SEED_BASE + 3;
    const case_ = generateSyntheticPaper({
      width,
      height,
      seed,
      occluder: false,
    });
    const imageData = {
      width,
      height,
      data: case_.data,
    } as unknown as ImageData;
    const result = detectPaperQuad(imageData, "a4");
    expect(result.corners).not.toBeNull();

    const detectedHomography = buildPaperHomography(result.corners!, "a4");
    const trueMmToPx = trueMmToPxHomography(case_.trueCorners);

    const segments: readonly [Point2, Point2][] = [
      [
        { x: 20, y: 150 },
        { x: 190, y: 150 },
      ], // 170mm, across the short axis
      [
        { x: 105, y: 20 },
        { x: 105, y: 277 },
      ], // 257mm, along the long axis
    ];
    for (const [a, b] of segments) {
      const trueLengthMm = Math.hypot(a.x - b.x, a.y - b.y);
      const pxA = applyHomography(trueMmToPx, a);
      const pxB = applyHomography(trueMmToPx, b);
      const measuredA = applyHomography(detectedHomography, pxA);
      const measuredB = applyHomography(detectedHomography, pxB);
      const measuredLengthMm = Math.hypot(
        measuredA.x - measuredB.x,
        measuredA.y - measuredB.y,
      );
      expect(Math.abs(measuredLengthMm - trueLengthMm)).toBeLessThan(0.5);
    }
  });
});

describe("detectPaperQuad — a curled/lifted edge", () => {
  it("reports an edge-fit residual above PAPER_EDGE_LIMITS.maxEdgeFitResidualMm", () => {
    const width = 1000;
    const height = 750;
    const case_ = generateSyntheticPaper({
      width,
      height,
      seed: SEED_BASE + 42,
      curledSideIndex: 1,
      curlAmplitudePx: 8,
    });
    const imageData = {
      width,
      height,
      data: case_.data,
    } as unknown as ImageData;
    const result = detectPaperQuad(imageData, "a4");
    expect(result.corners).not.toBeNull();

    const homography = buildPaperHomography(result.corners!, "a4");
    const scale = localScaleMmPerPx(homography, quadCentroid(result.corners!));
    const residualMm = result.edgeFitResidualPx * scale;

    expect(residualMm).toBeGreaterThan(PAPER_EDGE_LIMITS.maxEdgeFitResidualMm);
  });

  it("a flat sheet's residual stays comfortably under the limit", () => {
    const width = 640;
    const height = 480;
    const case_ = generateSyntheticPaper({
      width,
      height,
      seed: SEED_BASE + 1,
    });
    const imageData = {
      width,
      height,
      data: case_.data,
    } as unknown as ImageData;
    const result = detectPaperQuad(imageData, "a4");
    expect(result.corners).not.toBeNull();

    const homography = buildPaperHomography(result.corners!, "a4");
    const scale = localScaleMmPerPx(homography, quadCentroid(result.corners!));
    const residualMm = result.edgeFitResidualPx * scale;
    expect(residualMm).toBeLessThan(PAPER_EDGE_LIMITS.maxEdgeFitResidualMm);
  });
});

describe("detectPaperQuad — paper touching the frame edge", () => {
  it("reports cornersSeen < 4, with the two in-frame corners in partialCorners", () => {
    const width = 1000;
    const height = 750;
    const case_ = generateSyntheticPaper({
      width,
      height,
      seed: SEED_BASE + 42,
      clipLeftSide: true,
    });
    const imageData = {
      width,
      height,
      data: case_.data,
    } as unknown as ImageData;
    const result = detectPaperQuad(imageData, "a4");

    expect(result.corners).toBeNull();
    expect(result.cornersSeen).toBe(2);
    expect(result.cornersSeen).toBe(result.cornersFound.filter(Boolean).length);
    // Exactly one side's 2 corners should be found — `detectPaperQuad`
    // labels TL/TR/BR/BL by image geometry (nearest-top-left, then
    // rectified-aspect orientation), not by this fixture's own
    // clipLeftSide-relative labelling, so don't assume which 2 indices —
    // just that they're adjacent (one true side) and land close to the
    // true corners on the paper's in-frame side (truth indices 1 and 2,
    // the only ones NOT pushed off-canvas by clipLeftSide).
    const foundIdx = [0, 1, 2, 3].filter((i) => result.cornersFound[i]);
    expect(foundIdx).toHaveLength(2);
    const isAdjacent =
      (foundIdx[1] - foundIdx[0] + 4) % 4 === 1 ||
      (foundIdx[0] - foundIdx[1] + 4) % 4 === 1;
    expect(isAdjacent).toBe(true);
    for (const i of foundIdx) expect(result.partialCorners[i]).not.toBeNull();
    for (const i of [0, 1, 2, 3].filter((i) => !foundIdx.includes(i))) {
      expect(result.partialCorners[i]).toBeNull();
    }

    const inFrameTruth = [case_.trueCorners[1], case_.trueCorners[2]];
    for (const i of foundIdx) {
      const found = result.partialCorners[i]!;
      const bestErr = Math.min(
        ...inFrameTruth.map((t) => Math.hypot(found.x - t.x, found.y - t.y)),
      );
      expect(bestErr).toBeLessThan(2);
    }
  });
});

describe("detectPaperQuad — no paper in frame", () => {
  it("returns null corners and cornersSeen 0 for a uniform background", () => {
    const width = 800;
    const height = 600;
    const n = width * height;
    const data = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      data[i * 4] = 120;
      data[i * 4 + 1] = 120;
      data[i * 4 + 2] = 120;
      data[i * 4 + 3] = 255;
    }
    const imageData = { width, height, data } as unknown as ImageData;
    const result = detectPaperQuad(imageData, "a4");
    expect(result.corners).toBeNull();
    expect(result.cornersSeen).toBe(0);
    expect(result.cornersFound).toEqual([false, false, false, false]);
    expect(result.partialCorners).toEqual([null, null, null, null]);
    expect(result.minSideCoverage).toBe(0);
  });

  it("returns null for a paper region under the 10% area floor", () => {
    const width = 800;
    const height = 600;
    const case_ = generateSyntheticPaper({
      width,
      height,
      seed: SEED_BASE + 1,
      noiseAmplitude: 2,
    });
    // Shrink the whole photo's paper down by only rendering a small
    // sub-region of a much-larger synthetic canvas is overkill here —
    // instead, directly assert on a tiny image where the margins alone
    // guarantee the paper is under 10% of the frame's area.
    const tinyWidth = 300;
    const tinyHeight = 225;
    const n = tinyWidth * tinyHeight;
    const data = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      data[i * 4] = 110;
      data[i * 4 + 1] = 110;
      data[i * 4 + 2] = 110;
      data[i * 4 + 3] = 255;
    }
    // A small bright square in one corner, well under 10% of the frame.
    const size = 40; // 40*40 = 1600px, frame is 67500px (~2.4%)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * tinyWidth + x) * 4;
        data[idx] = 240;
        data[idx + 1] = 240;
        data[idx + 2] = 240;
        data[idx + 3] = 255;
      }
    }
    const imageData = {
      width: tinyWidth,
      height: tinyHeight,
      data,
    } as unknown as ImageData;
    const result = detectPaperQuad(imageData, "a4");
    expect(result.corners).toBeNull();
    expect(result.cornersSeen).toBe(0);
    void case_; // generated only to keep the seed helper exercised; unused otherwise
  });
});

describe("detectPaperQuad — determinism", () => {
  it("returns byte-identical results across repeated calls on the same frame", () => {
    const width = 640;
    const height = 480;
    const case_ = generateSyntheticPaper({
      width,
      height,
      seed: SEED_BASE + 7,
      occluder: true,
    });
    const imageData = {
      width,
      height,
      data: case_.data,
    } as unknown as ImageData;
    const a = detectPaperQuad(imageData, "a4");
    const b = detectPaperQuad(imageData, "a4");
    expect(a).toEqual(b);
  });
});
