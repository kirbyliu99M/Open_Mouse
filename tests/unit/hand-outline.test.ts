import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARTIFACT_PATHS } from "@/lib/particles/artifacts";
import type { Vec } from "@/lib/particles/geometry";
import {
  DEMO_PX_PER_MM,
  DEMO_STAGE_SCALE,
  OUTLINE_ALPHA,
  OUTLINE_COLOUR,
  OUTLINE_EDGE_PX,
  OUTLINE_FINGERS,
  OUTLINE_PALM,
  distanceToPolyline,
  insideHandOutline,
  outlineInStagePx,
} from "@/lib/particles/hand-outline";
import { parseTargets } from "@/lib/particles/load-targets";
import {
  FINGER_CHAINS,
  LANDMARKS_MM,
  PALM_POLYGON_MM,
  STAGE_SCALE,
  fillTemplateHand,
} from "@/lib/particles/template-hand";

const targets = parseTargets(
  JSON.parse(readFileSync(ARTIFACT_PATHS.targets, "utf8")),
);
const toMm = (x: number, y: number): Vec => [x / STAGE_SCALE, y / STAGE_SCALE];
/** mm on the A4 sheet to the demo's own pixels (its sheet's corner is at (39, 9)). */
const toDemo = ([x, y]: Vec): Vec => [
  39 + x * DEMO_PX_PER_MM,
  9 + y * DEMO_PX_PER_MM,
];

describe("the demo's scale, which every outline size is read in", () => {
  it("puts the template's landmarks where the demo has them, within 2 px", () => {
    // Read off the Pencil demo's "Outline finger" paths: each chain starts at
    // its finger's first landmark and ends at its tip.
    const demo: [number, Vec][] = [
      [1, [159, 330]],
      [4, [73, 234]],
      [5, [165, 228]],
      [8, [145, 109]],
      [9, [205, 222]],
      [12, [205, 86]],
      [13, [241, 228]],
      [16, [261, 112]],
      [17, [274, 245]],
      [20, [307, 155]],
    ];
    for (const [landmark, want] of demo) {
      const got = toDemo(LANDMARKS_MM[landmark]!);
      expect(Math.abs(got[0] - want[0]), `landmark ${landmark} x`).toBeLessThan(
        2,
      );
      expect(Math.abs(got[1] - want[1]), `landmark ${landmark} y`).toBeLessThan(
        2,
      );
    }
    expect(DEMO_STAGE_SCALE).toBeCloseTo(DEMO_PX_PER_MM / STAGE_SCALE, 12);
  });
});

describe("the outline's shapes", () => {
  it("follow the template hand's own five finger chains, thumb first", () => {
    expect(FINGER_CHAINS).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
      [17, 18, 19, 20],
    ]);
    expect(OUTLINE_FINGERS).toHaveLength(5);
    OUTLINE_FINGERS.forEach(({ chain }, i) => {
      expect(chain).toEqual(FINGER_CHAINS[i]!.map((l) => LANDMARKS_MM[l]));
    });
  });

  it("are the demo's widths: thumb 30, index, middle and ring 28, pinky 24 and the palm's stroke 30, each grown by the edge", () => {
    const inDemoPx = OUTLINE_FINGERS.map((f) => f.width * DEMO_PX_PER_MM - 2.4);
    expect(inDemoPx.map((w) => Math.round(w * 1000) / 1000)).toEqual([
      30, 28, 28, 28, 24,
    ]);
    expect(OUTLINE_PALM.width * DEMO_PX_PER_MM - 2.4).toBeCloseTo(30, 9);
    // The thumb is the widest finger and the little finger the narrowest.
    const widths = OUTLINE_FINGERS.map((f) => f.width);
    expect(widths[0]).toBe(Math.max(...widths));
    expect(widths[4]).toBe(Math.min(...widths));
  });

  it("has a palm polygon through the knuckle bases and down to a flat wrist base 40 mm wide", () => {
    const polygon = OUTLINE_PALM.polygon;
    expect(polygon).toHaveLength(6);
    // The knuckle row runs from the index finger's base to the little finger's.
    expect(Math.abs(polygon[0]![0] - LANDMARKS_MM[5]![0])).toBeLessThan(2);
    expect(Math.abs(polygon[1]![0] - LANDMARKS_MM[17]![0])).toBeLessThan(2);
    // The wrist base: two vertices at the same height, as wide as the template's wrist crease.
    const [a, b] = [polygon[3]!, polygon[4]!];
    expect(a[1]).toBeCloseTo(b[1], 9);
    expect(Math.abs(a[0] - b[0])).toBeCloseTo(40, 0);
    expect(Math.abs(a[1] - PALM_POLYGON_MM[0]![1])).toBeLessThan(0.5);
  });

  it("are in stage px as the same shapes (the A4 sheet 340 px wide)", () => {
    const px = outlineInStagePx();
    expect(px.fingers).toHaveLength(5);
    px.fingers.forEach(({ chain, width }, i) => {
      expect(width).toBeCloseTo(OUTLINE_FINGERS[i]!.width * STAGE_SCALE, 9);
      expect(chain[0]![0]).toBeCloseTo(
        OUTLINE_FINGERS[i]!.chain[0]![0] * STAGE_SCALE,
        9,
      );
    });
    expect(px.palm.width).toBeCloseTo(OUTLINE_PALM.width * STAGE_SCALE, 9);
    expect(px.palm.polygon).toHaveLength(OUTLINE_PALM.polygon.length);
  });

  it("is a thin edge in a colour quieter than the landmarks, at the skeleton's opacity", () => {
    expect(OUTLINE_COLOUR).toBe("#5F86C9");
    expect(OUTLINE_ALPHA).toBe(0.9);
    expect(OUTLINE_EDGE_PX).toBe(1);
  });
});

describe("what the outline holds", () => {
  it("holds every particle of the page's hand (the generated targets' 1,400 points)", () => {
    const outside = targets.hand.points.filter((p) => {
      return !insideHandOutline(toMm(p.x, p.y));
    });
    expect(targets.hand.points.length).toBeGreaterThanOrEqual(1000);
    expect(outside).toEqual([]);
  });

  it("holds every particle the template can place, over many seeds (20,000 points)", () => {
    let checked = 0;
    for (const seed of [1, 7, 20261003, 99, 123456]) {
      for (const p of fillTemplateHand(4000, seed)) {
        checked += 1;
        expect(insideHandOutline(toMm(p.x, p.y)), `seed ${seed}`).toBe(true);
      }
    }
    expect(checked).toBe(20000);
  });

  it("holds all 21 landmarks, comfortably inside: each at least 6 mm from the edge", () => {
    for (const [i, landmark] of LANDMARKS_MM.entries()) {
      expect(insideHandOutline(landmark), `landmark ${i}`).toBe(true);
    }
    // A fingertip's centre is a full half-width inside its finger's outline.
    for (const { chain, width } of OUTLINE_FINGERS) {
      const tip = chain.at(-1)!;
      expect(insideHandOutline([tip[0], tip[1] - width / 2 + 0.2])).toBe(true);
      expect(insideHandOutline([tip[0], tip[1] - width / 2 - 0.2])).toBe(false);
    }
  });

  it("keeps the fingers apart at their tips and holds nothing outside the hand", () => {
    // The gaps between the fingertips are open.
    for (const gap of [
      [95, 64],
      [135, 62],
      [168, 82],
    ] as const) {
      expect(insideHandOutline(gap), `gap ${gap}`).toBe(false);
    }
    // The sheet's corners, the measurement ruler and the empty paper are outside.
    for (const away of [
      [0, 0],
      [210, 0],
      [210, 297],
      [0, 297],
      [222, 100],
      [105, 290],
      [10, 100],
    ] as const) {
      expect(insideHandOutline(away), `away ${away}`).toBe(false);
    }
  });
});

describe("the wrist: a rounded flat base, not a sharp point", () => {
  const [left, right] = [OUTLINE_PALM.polygon[4]!, OUTLINE_PALM.polygon[3]!];
  const half = OUTLINE_PALM.width / 2;

  it("is flat: along the base the outline is level, half a stroke below the polygon", () => {
    for (let t = 0.1; t <= 0.9; t += 0.2) {
      const x = left[0] + (right[0] - left[0]) * t;
      expect(insideHandOutline([x, left[1] + half - 0.2])).toBe(true);
      expect(insideHandOutline([x, left[1] + half + 0.2])).toBe(false);
    }
  });

  it("is rounded at both corners: the square corner is outside, the arc is inside", () => {
    for (const [corner, side] of [
      [left, -1],
      [right, 1],
    ] as const) {
      // The corner of a square stroke would be here.
      expect(
        insideHandOutline([
          corner[0] + side * half * 0.95,
          corner[1] + half * 0.95,
        ]),
      ).toBe(false);
      // The round join's arc passes just inside this point.
      const arc = Math.SQRT1_2 * (half - 0.2);
      expect(insideHandOutline([corner[0] + side * arc, corner[1] + arc])).toBe(
        true,
      );
    }
  });

  it("is wider than the wrist's own crease by the stroke: about 40 mm plus the stroke's two halves", () => {
    // The widest part of the base's outline, at the level of the polygon's base.
    const y = left[1];
    let leftmost = Infinity;
    let rightmost = -Infinity;
    for (let x = 60; x <= 170; x += 0.05) {
      if (insideHandOutline([x, y])) {
        leftmost = Math.min(leftmost, x);
        rightmost = Math.max(rightmost, x);
      }
    }
    // On the base's own level the palm side edges are further out than the base,
    // so check the row just under it: the rounded base is at most 40 mm + stroke.
    expect(rightmost - leftmost).toBeGreaterThan(40);
    const under = left[1] + half * 0.9;
    let w = 0;
    for (let x = 60; x <= 170; x += 0.05)
      if (insideHandOutline([x, under])) w += 0.05;
    expect(w).toBeLessThan(40 + OUTLINE_PALM.width);
    expect(w).toBeGreaterThan(40);
  });
});

describe("distanceToPolyline", () => {
  it("is the distance to the nearest point of the path, open or closed", () => {
    const path: Vec[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    expect(distanceToPolyline([5, 3], path)).toBeCloseTo(3, 12);
    expect(distanceToPolyline([12, 5], path)).toBeCloseTo(2, 12);
    expect(distanceToPolyline([-3, -4], path)).toBeCloseTo(5, 12);
    // Closed, the edge back to the start counts too.
    expect(distanceToPolyline([4, 6], path, true)).toBeCloseTo(
      Math.SQRT1_2 * 2,
      9,
    );
    expect(distanceToPolyline([4, 6], path)).toBeCloseTo(6, 12);
  });
});
