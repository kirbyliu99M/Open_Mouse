import { describe, expect, it } from "vitest";
import {
  applyHomography,
  estimateHomography,
  reprojectionErrorMm,
  type Homography,
  type PointCorrespondence,
} from "../../src/client/geometry/homography";

// A plausible, non-degenerate perspective transform: image px -> sheet mm.
// Small off-diagonal and bottom-row terms model a camera that isn't
// perfectly fronto-parallel to the sheet.
const TRUE_HOMOGRAPHY: Homography = [
  [0.192, 0.006, -18.4],
  [-0.004, 0.191, -12.7],
  [0.00003, -0.00002, 1],
];

// 16 image-px points in general position (no 3 collinear), loosely modelling
// four ~25 mm marker squares near the corners of a photographed sheet.
const SRC_POINTS = [
  { x: 80, y: 90 },
  { x: 210, y: 88 },
  { x: 212, y: 218 },
  { x: 82, y: 220 },
  { x: 1080, y: 95 },
  { x: 1205, y: 92 },
  { x: 1208, y: 222 },
  { x: 1083, y: 225 },
  { x: 1075, y: 1180 },
  { x: 1200, y: 1177 },
  { x: 1202, y: 1305 },
  { x: 1078, y: 1308 },
  { x: 78, y: 1170 },
  { x: 205, y: 1168 },
  { x: 208, y: 1298 },
  { x: 80, y: 1300 },
];

function buildExactCorrespondences(): PointCorrespondence[] {
  return SRC_POINTS.map((src) => ({
    src,
    dst: applyHomography(TRUE_HOMOGRAPHY, src),
  }));
}

// Deterministic PRNG (mulberry32) + Box–Muller, so the noise test is
// reproducible rather than occasionally flaky.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

describe("estimateHomography", () => {
  it("recovers an exact homography from 4 points, round-trip error < 1e-6 mm", () => {
    const correspondences = buildExactCorrespondences().slice(0, 4);
    const recovered = estimateHomography(correspondences);
    expect(reprojectionErrorMm(recovered, correspondences)).toBeLessThan(1e-6);
  });

  it("recovers an exact homography from all 16 marker corners, round-trip error < 1e-6 mm", () => {
    const correspondences = buildExactCorrespondences();
    const recovered = estimateHomography(correspondences);
    expect(reprojectionErrorMm(recovered, correspondences)).toBeLessThan(1e-6);
  });

  it("stays within ~0.5 mm of truth for 16 points under Gaussian pixel noise", () => {
    const rand = mulberry32(20260921);
    const clean = buildExactCorrespondences();
    const noiseStdPx = 0.3;
    const noisy: PointCorrespondence[] = clean.map(({ src, dst }) => ({
      src: {
        x: src.x + gaussian(rand) * noiseStdPx,
        y: src.y + gaussian(rand) * noiseStdPx,
      },
      dst,
    }));

    const recovered = estimateHomography(noisy);
    // What matters for downstream measurements is whether the recovered
    // mapping still lands close to the true mm positions, not the fit
    // residual against the noisy training data itself.
    const error = reprojectionErrorMm(recovered, clean);
    expect(error).toBeLessThan(0.5);
  });

  it("throws a clear error for fewer than 4 correspondences", () => {
    const correspondences = buildExactCorrespondences().slice(0, 3);
    expect(() => estimateHomography(correspondences)).toThrow(/at least 4/i);
  });

  it("throws a clear error for collinear (degenerate) source points", () => {
    const collinear: PointCorrespondence[] = [0, 1, 2, 3].map((i) => ({
      src: { x: 10 + i * 20, y: 5 + i * 20 }, // all on the line y = x - 5
      dst: { x: i * 10, y: i * 5 },
    }));
    expect(() => estimateHomography(collinear)).toThrow(
      /degenerate|collinear/i,
    );
  });
});

describe("applyHomography", () => {
  it("maps a point through a simple translation", () => {
    const h: Homography = [
      [1, 0, 5],
      [0, 1, -3],
      [0, 0, 1],
    ];
    const result = applyHomography(h, { x: 10, y: 20 });
    expect(result.x).toBeCloseTo(15, 9);
    expect(result.y).toBeCloseTo(17, 9);
  });

  it("performs the perspective divide", () => {
    const h: Homography = [
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ];
    // Uniform scale-by-2 in the top rows and w, so the perspective divide
    // cancels it out and the point is unchanged.
    const result = applyHomography(h, { x: 7, y: -4 });
    expect(result.x).toBeCloseTo(7, 9);
    expect(result.y).toBeCloseTo(-4, 9);
  });
});

describe("reprojectionErrorMm", () => {
  it("is ~0 for a homography evaluated on its own defining correspondences", () => {
    const correspondences = buildExactCorrespondences();
    expect(reprojectionErrorMm(TRUE_HOMOGRAPHY, correspondences)).toBeLessThan(
      1e-9,
    );
  });
});
