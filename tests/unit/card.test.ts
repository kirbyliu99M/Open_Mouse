import { describe, expect, it } from "vitest";
import {
  scoreQuadAsCard,
  selectBestCardCandidate,
  CARD_SCORE_TOLERANCE,
} from "../../src/client/photo/card";
import { ID1_CARD_MM } from "../../src/lib/contracts/measurement";
import type { Point2 } from "../../src/client/geometry/homography";

function rect(x: number, y: number, w: number, h: number): Point2[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

const ID1_RATIO = ID1_CARD_MM.width / ID1_CARD_MM.height; // ~1.586

describe("scoreQuadAsCard", () => {
  it("scores ~0 for a quad with exactly the ID-1 aspect ratio", () => {
    const quad = rect(0, 0, 856, 539.8); // 10x scale of the real mm dims
    const score = scoreQuadAsCard(quad);
    expect(score).not.toBeNull();
    expect(score!).toBeLessThan(0.01);
  });

  it("scores far from 0 for a square", () => {
    const quad = rect(0, 0, 500, 500);
    const score = scoreQuadAsCard(quad);
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(0.5);
  });

  it("is invariant to overall scale (only the ratio matters)", () => {
    const small = scoreQuadAsCard(rect(0, 0, 85.6, 53.98));
    const large = scoreQuadAsCard(rect(0, 0, 856, 539.8));
    expect(small).toBeCloseTo(large!, 6);
  });

  it("returns null for a degenerate (zero-width) quad", () => {
    const degenerate: Point2[] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(scoreQuadAsCard(degenerate)).toBeNull();
  });

  it("returns null for a non-quad (wrong point count)", () => {
    expect(scoreQuadAsCard([{ x: 0, y: 0 }])).toBeNull();
  });
});

describe("selectBestCardCandidate", () => {
  it("picks the candidate closest to the ID-1 ratio", () => {
    const square = rect(0, 0, 300, 300);
    const cardLike = rect(500, 500, 856, 539.8);
    const best = selectBestCardCandidate([square, cardLike]);
    expect(best).not.toBeNull();
    expect(best).toEqual(cardLike);
  });

  it("returns null when no candidate is within tolerance", () => {
    const square = rect(0, 0, 300, 300);
    expect(selectBestCardCandidate([square])).toBeNull();
  });

  it("returns null for an empty candidate list", () => {
    expect(selectBestCardCandidate([])).toBeNull();
  });

  it("respects a custom tolerance", () => {
    // ratio ~1.786 vs ID-1 ~1.586: score ~0.2, outside the default 0.15
    // tolerance but inside a more generous custom one.
    const slightlyOff = rect(0, 0, 964.3, 540);
    expect(scoreQuadAsCard(slightlyOff)!).toBeGreaterThan(CARD_SCORE_TOLERANCE);
    expect(
      selectBestCardCandidate([slightlyOff], CARD_SCORE_TOLERANCE),
    ).toBeNull();
    expect(selectBestCardCandidate([slightlyOff], 0.25)).toEqual(slightlyOff);
  });

  it("confirms ID-1's own aspect ratio is what tolerance is measured against", () => {
    expect(ID1_RATIO).toBeCloseTo(1.5858, 3);
  });
});
