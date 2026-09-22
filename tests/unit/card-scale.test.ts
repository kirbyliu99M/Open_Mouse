import { describe, expect, it } from "vitest";
import {
  ID1_CARD_MM,
  MAX_SCALE_DISAGREEMENT,
  calibrationEvidenceSchema,
} from "../../src/lib/contracts/measurement";
import {
  applyHomography,
  type Homography,
  type Point2,
} from "../../src/client/geometry/homography";
import {
  computeCardScaleRatio,
  type CardCorners,
} from "../../src/client/geometry/card-scale";

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

// The homography the sheet's own markers produce, mapping image px -> sheet
// mm. It is what it is regardless of the card test below; only the card's
// TRUE physical position (independent of any printer scaling) changes.
const SHEET_HOMOGRAPHY: Homography = [
  [0.2, 0.008, -20],
  [-0.004, 0.199, -16],
  [0.00001, -0.000015, 1],
];
const INVERSE_SHEET_HOMOGRAPHY = invertHomography(SHEET_HOMOGRAPHY);

/**
 * Build the card's 4 image-px corners such that mapping them through
 * SHEET_HOMOGRAPHY and scaling by `printScale` reproduces a card of
 * `printScale × ID1_CARD_MM`. printScale = 1 means the sheet was printed at
 * the correct 100%; printScale = 1/0.97 models a page printed at 97% (the
 * sheet's mm frame reads everything about 1/0.97 too large).
 */
function buildCardCorners(
  printScale: number,
  options: {
    startCorner?: number;
    reversed?: boolean;
    landscape?: boolean;
  } = {},
): CardCorners {
  const { startCorner = 0, reversed = false, landscape = true } = options;
  const w = (landscape ? ID1_CARD_MM.width : ID1_CARD_MM.height) * printScale;
  const h = (landscape ? ID1_CARD_MM.height : ID1_CARD_MM.width) * printScale;
  const centre = { x: 105, y: 190 }; // arbitrary sheet-mm position, inside the flap
  const mmCorners: Point2[] = [
    { x: centre.x - w / 2, y: centre.y - h / 2 },
    { x: centre.x + w / 2, y: centre.y - h / 2 },
    { x: centre.x + w / 2, y: centre.y + h / 2 },
    { x: centre.x - w / 2, y: centre.y + h / 2 },
  ];
  let ordered = mmCorners;
  if (reversed) ordered = [ordered[0], ...ordered.slice(1).reverse()];
  ordered = [...ordered.slice(startCorner), ...ordered.slice(0, startCorner)];

  return ordered.map((p) =>
    applyHomography(INVERSE_SHEET_HOMOGRAPHY, p),
  ) as unknown as CardCorners;
}

describe("computeCardScaleRatio", () => {
  it("returns ~1.000 for a correctly scaled card", () => {
    const corners = buildCardCorners(1);
    expect(computeCardScaleRatio(corners, SHEET_HOMOGRAPHY)).toBeCloseTo(1, 3);
  });

  it("returns ~1.031 for a sheet printed at 97%, and calibrationEvidenceSchema rejects it", () => {
    const corners = buildCardCorners(1 / 0.97);
    const ratio = computeCardScaleRatio(corners, SHEET_HOMOGRAPHY);
    expect(ratio).toBeCloseTo(1.031, 2);
    expect(Math.abs(ratio - 1)).toBeGreaterThan(MAX_SCALE_DISAGREEMENT);

    const evidence = {
      markerIds: [0, 1, 2, 3],
      reprojectionErrorMm: 0.3,
      cardScaleRatio: ratio,
      parallaxCorrected: true,
    };
    const result = calibrationEvidenceSchema.safeParse(evidence);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/printer/);
  });

  it("accepts a correctly scaled card under calibrationEvidenceSchema", () => {
    const corners = buildCardCorners(1);
    const ratio = computeCardScaleRatio(corners, SHEET_HOMOGRAPHY);
    const evidence = {
      markerIds: [0, 1, 2, 3],
      reprojectionErrorMm: 0.3,
      cardScaleRatio: ratio,
      parallaxCorrected: true,
    };
    expect(calibrationEvidenceSchema.safeParse(evidence).success).toBe(true);
  });

  it("is invariant to which corner is listed first", () => {
    const base = computeCardScaleRatio(
      buildCardCorners(1.02, { startCorner: 0 }),
      SHEET_HOMOGRAPHY,
    );
    for (const startCorner of [1, 2, 3]) {
      const ratio = computeCardScaleRatio(
        buildCardCorners(1.02, { startCorner }),
        SHEET_HOMOGRAPHY,
      );
      expect(ratio).toBeCloseTo(base, 9);
    }
  });

  it("is invariant to winding direction (clockwise vs counter-clockwise)", () => {
    const forward = computeCardScaleRatio(
      buildCardCorners(1.02, { reversed: false }),
      SHEET_HOMOGRAPHY,
    );
    const reversed = computeCardScaleRatio(
      buildCardCorners(1.02, { reversed: true }),
      SHEET_HOMOGRAPHY,
    );
    expect(reversed).toBeCloseTo(forward, 9);
  });

  it("is invariant to portrait vs landscape photo orientation", () => {
    const landscape = computeCardScaleRatio(
      buildCardCorners(1.02, { landscape: true }),
      SHEET_HOMOGRAPHY,
    );
    const portrait = computeCardScaleRatio(
      buildCardCorners(1.02, { landscape: false }),
      SHEET_HOMOGRAPHY,
    );
    expect(portrait).toBeCloseTo(landscape, 9);
  });
});
