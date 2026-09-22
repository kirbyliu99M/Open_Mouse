import { describe, expect, it } from "vitest";
import { handMeasurementsSchema } from "../../src/lib/contracts/measurement";
import {
  applyHomography,
  type Homography,
  type Point2,
} from "../../src/client/geometry/homography";
import {
  computeHandMeasurements,
  type Landmark,
} from "../../src/client/geometry/measurements";

// A synthetic hand, laid out directly in sheet mm with hand-plausible
// distances. Index 5-6-7-8 (the index finger) is deliberately curled so the
// straight-line distance(5,8) is noticeably shorter than chain(5,6,7,8) —
// exercising the "chains sum segments, not a straight line" contract rule.
const MM_LANDMARKS: readonly Point2[] = [
  { x: 100, y: 0 }, // 0 wrist
  { x: 85, y: 20 }, // 1 thumb CMC
  { x: 70, y: 45 }, // 2 thumb MCP
  { x: 55, y: 65 }, // 3 thumb IP
  { x: 45, y: 85 }, // 4 thumb TIP
  { x: 80, y: 100 }, // 5 index MCP
  { x: 75, y: 135 }, // 6 index PIP
  { x: 65, y: 150 }, // 7 index DIP
  { x: 55, y: 145 }, // 8 index TIP (curled back toward the palm)
  { x: 100, y: 105 }, // 9 middle MCP
  { x: 100, y: 140 }, // 10 middle PIP
  { x: 100, y: 165 }, // 11 middle DIP
  { x: 100, y: 190 }, // 12 middle TIP
  { x: 130, y: 99 }, // 13 ring MCP
  { x: 131, y: 133 }, // 14 ring PIP
  { x: 131, y: 157 }, // 15 ring DIP
  { x: 131, y: 177 }, // 16 ring TIP
  { x: 160, y: 98 }, // 17 pinky MCP
  { x: 162, y: 122 }, // 18 pinky PIP
  { x: 163, y: 140 }, // 19 pinky DIP
  { x: 163, y: 155 }, // 20 pinky TIP
];

function dist(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function chainDist(
  points: readonly Point2[],
  indices: readonly number[],
): number {
  let total = 0;
  for (let i = 1; i < indices.length; i++)
    total += dist(points[indices[i - 1]], points[indices[i]]);
  return total;
}

// A mild perspective transform, image px -> sheet mm.
const HOMOGRAPHY: Homography = [
  [0.2, 0.01, -20],
  [-0.005, 0.19, -15],
  [0.00002, -0.00001, 1],
];

function invertHomography(h: Homography): Homography {
  const [[a, b, c], [d, e, f], [g, hh, i]] = h;
  const det = a * (e * i - f * hh) - b * (d * i - f * g) + c * (d * hh - e * g);
  const invDet = 1 / det;
  return [
    [
      (e * i - f * hh) * invDet,
      (c * hh - b * i) * invDet,
      (b * f - c * e) * invDet,
    ],
    [
      (f * g - d * i) * invDet,
      (a * i - c * g) * invDet,
      (c * d - a * f) * invDet,
    ],
    [
      (d * hh - e * g) * invDet,
      (b * g - a * hh) * invDet,
      (a * e - b * d) * invDet,
    ],
  ];
}

const INVERSE_HOMOGRAPHY = invertHomography(HOMOGRAPHY);

// "Photograph" the synthetic hand: image px such that applying HOMOGRAPHY to
// them reproduces MM_LANDMARKS exactly.
const IMAGE_LANDMARKS: readonly Landmark[] = MM_LANDMARKS.map((p) =>
  applyHomography(INVERSE_HOMOGRAPHY, p),
);

describe("computeHandMeasurements", () => {
  it("recovers every MEASUREMENT_DEFINITIONS field within 0.01 mm", () => {
    const result = computeHandMeasurements(IMAGE_LANDMARKS, HOMOGRAPHY);

    expect(result.handLengthMm).toBeCloseTo(
      dist(MM_LANDMARKS[0], MM_LANDMARKS[12]),
      2,
    );
    expect(result.palmLengthMm).toBeCloseTo(
      dist(MM_LANDMARKS[0], MM_LANDMARKS[9]),
      2,
    );
    expect(result.palmWidthMm).toBeCloseTo(
      dist(MM_LANDMARKS[5], MM_LANDMARKS[17]),
      2,
    );
    expect(result.thumbLengthMm).toBeCloseTo(
      chainDist(MM_LANDMARKS, [2, 3, 4]),
      2,
    );
    expect(result.indexLengthMm).toBeCloseTo(
      chainDist(MM_LANDMARKS, [5, 6, 7, 8]),
      2,
    );
    expect(result.middleLengthMm).toBeCloseTo(
      chainDist(MM_LANDMARKS, [9, 10, 11, 12]),
      2,
    );
    expect(result.ringLengthMm).toBeCloseTo(
      chainDist(MM_LANDMARKS, [13, 14, 15, 16]),
      2,
    );
    expect(result.pinkyLengthMm).toBeCloseTo(
      chainDist(MM_LANDMARKS, [17, 18, 19, 20]),
      2,
    );
  });

  it("sums chain segments rather than taking the straight line for a curled finger", () => {
    const result = computeHandMeasurements(IMAGE_LANDMARKS, HOMOGRAPHY);
    const straightLine = dist(MM_LANDMARKS[5], MM_LANDMARKS[8]);
    const chainSum = chainDist(MM_LANDMARKS, [5, 6, 7, 8]);

    // The synthetic index finger is curled, so the straight line undercounts.
    expect(chainSum).toBeGreaterThan(straightLine + 5);
    expect(result.indexLengthMm).toBeCloseTo(chainSum, 2);
    expect(result.indexLengthMm).not.toBeCloseTo(straightLine, 0);
  });

  it("parses with handMeasurementsSchema", () => {
    const result = computeHandMeasurements(IMAGE_LANDMARKS, HOMOGRAPHY);
    expect(handMeasurementsSchema.safeParse(result).success).toBe(true);
  });

  it("throws a clear error when given anything other than 21 landmarks", () => {
    expect(() =>
      computeHandMeasurements(IMAGE_LANDMARKS.slice(0, 20), HOMOGRAPHY),
    ).toThrow(/21 MediaPipe landmarks/);
  });
});
