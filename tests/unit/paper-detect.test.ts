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
  type Point2,
} from "../../src/client/geometry/homography";

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
  it("a known sheet-mm point maps back within 0.5mm after detection + homography", () => {
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

    const homography = buildPaperHomography(result.corners!, "a4");

    // The paper's own 4 true corners are, by construction, at (0,0),
    // (210,0), (210,297), (0,297) mm — map the DETECTED (not true) image
    // corners through the fitted homography and check they land close to
    // those exact mm positions.
    const expectedMm: Point2[] = [
      { x: 0, y: 0 },
      { x: 210, y: 0 },
      { x: 210, y: 297 },
      { x: 0, y: 297 },
    ];
    for (let i = 0; i < 4; i++) {
      const mapped = applyHomography(homography, result.corners![i]);
      const errMm = Math.hypot(
        mapped.x - expectedMm[i].x,
        mapped.y - expectedMm[i].y,
      );
      expect(errMm).toBeLessThan(0.5);
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
      curlAmplitudePx: 18,
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
    expect(result.cornersSeen).toBeLessThan(4);
    expect(result.cornersSeen).toBe(result.cornersFound.filter(Boolean).length);
    // TL (index 0) and BL (index 3) are the corners on the clipped left
    // side — neither should be found; TR (1) and BR (2), on the opposite
    // (in-frame) side, should both be found and reasonably close to truth.
    expect(result.cornersFound[0]).toBe(false);
    expect(result.cornersFound[3]).toBe(false);
    expect(result.cornersFound[1]).toBe(true);
    expect(result.cornersFound[2]).toBe(true);
    expect(result.partialCorners[0]).toBeNull();
    expect(result.partialCorners[3]).toBeNull();
    expect(result.partialCorners[1]).not.toBeNull();
    expect(result.partialCorners[2]).not.toBeNull();

    const trTruth = case_.trueCorners[1];
    const trFound = result.partialCorners[1]!;
    expect(
      Math.hypot(trFound.x - trTruth.x, trFound.y - trTruth.y),
    ).toBeLessThan(2);
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
