import { describe, expect, it } from "vitest";
import {
  EDGES,
  edgeAngle,
  edgeTransform,
} from "../../src/client/camera/edgeGeometry";
import type { Point } from "../../src/client/camera/quad";

/** An upright sheet as the dots see it: TL, TR, BR, BL. */
const SHEET: readonly Point[] = [
  { x: 30, y: 166 },
  { x: 362, y: 166 },
  { x: 362, y: 640 },
  { x: 30, y: 640 },
];

describe("EDGES", () => {
  it("joins all four corners, each edge once, and none points left or up on an upright sheet", () => {
    expect(EDGES).toHaveLength(4);
    const seen = new Set(EDGES.map(([a, b]) => `${a}-${b}`));
    expect(seen.size).toBe(4);
    for (const [from, to] of EDGES) {
      const dx = SHEET[to].x - SHEET[from].x;
      const dy = SHEET[to].y - SHEET[from].y;
      expect(dx >= 0 && dy >= 0, `${from}->${to}`).toBe(true);
    }
    // Every corner is used by exactly two edges.
    const uses = [0, 0, 0, 0];
    for (const [a, b] of EDGES) {
      uses[a] += 1;
      uses[b] += 1;
    }
    expect(uses).toEqual([2, 2, 2, 2]);
  });
});

describe("edgeAngle: no jump when an edge crosses level or upright", () => {
  // Sweep the cross-axis offset of the far end of each edge from -1.5 to +1.5
  // px, 0.05 px at a time: the paper's edge wobbling about level (or about
  // upright) as it is held.
  const STEP = 0.05;
  const MAX_JUMP = 0.1; // rad

  it.each(EDGES.map(([from, to]) => [from, to] as const))(
    "edge %i -> %i is continuous",
    (from, to) => {
      const horizontal = SHEET[from].y === SHEET[to].y;
      let previous: number | null = null;
      for (let offset = -1.5; offset <= 1.5 + 1e-9; offset += STEP) {
        const end: Point = horizontal
          ? { x: SHEET[to].x, y: SHEET[to].y + offset }
          : { x: SHEET[to].x + offset, y: SHEET[to].y };
        const angle = edgeAngle(SHEET[from], end);
        if (previous !== null)
          expect(Math.abs(angle - previous), `offset ${offset}`).toBeLessThan(
            MAX_JUMP,
          );
        previous = angle;
      }
    },
  );

  it("would have spun the old bottom edge (BR to BL) a full turn", () => {
    // Why the list runs BL to BR: pointing left, atan2 wraps at level.
    const above = edgeAngle(SHEET[2], { x: SHEET[3].x, y: SHEET[3].y - 0.5 });
    const below = edgeAngle(SHEET[2], { x: SHEET[3].x, y: SHEET[3].y + 0.5 });
    expect(Math.abs(above - below)).toBeGreaterThan(6);
  });

  it("holds for a level sheet tilted up to 5 degrees either way", () => {
    // Tilting the whole sheet a little each way: no edge wraps.
    for (let degrees = -5; degrees <= 5; degrees += 0.1) {
      const t = (degrees * Math.PI) / 180;
      const rotate = (p: Point): Point => ({
        x: 196 + (p.x - 196) * Math.cos(t) - (p.y - 403) * Math.sin(t),
        y: 403 + (p.x - 196) * Math.sin(t) + (p.y - 403) * Math.cos(t),
      });
      for (const [from, to] of EDGES) {
        const angle = edgeAngle(rotate(SHEET[from]), rotate(SHEET[to]));
        expect(Math.abs(angle)).toBeLessThan(Math.PI * 0.6);
      }
    }
  });
});

describe("edgeTransform", () => {
  it("puts a 1 px element on the edge: start, angle, length", () => {
    expect(edgeTransform({ x: 10, y: 20 }, { x: 10, y: 120 })).toBe(
      `translate3d(10px, 20px, 0) rotate(${Math.PI / 2}rad) scaleX(100)`,
    );
    expect(edgeTransform({ x: 0, y: 0 }, { x: 30, y: 40 })).toContain(
      "scaleX(50)",
    );
  });
});
