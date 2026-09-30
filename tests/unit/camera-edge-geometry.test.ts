import { describe, expect, it } from "vitest";
import {
  EDGES,
  edgeTransform,
  placeEdge,
  placeEdges,
  unwrapAngle,
} from "../../src/client/camera/edgeGeometry";
import type { Point } from "../../src/client/camera/quad";

/** An upright sheet as the dots see it: TL, TR, BR, BL. */
const SHEET: readonly Point[] = [
  { x: 30, y: 166 },
  { x: 362, y: 166 },
  { x: 362, y: 640 },
  { x: 30, y: 640 },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("EDGES", () => {
  it("joins each corner to the next, all four sides once", () => {
    expect(EDGES).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ]);
    const uses = [0, 0, 0, 0];
    for (const [a, b] of EDGES) {
      uses[a] += 1;
      uses[b] += 1;
    }
    expect(uses).toEqual([2, 2, 2, 2]);
  });
});

describe("unwrapAngle", () => {
  it("with no previous angle gives the one in (-pi/2, pi/2]", () => {
    for (let raw = -10; raw <= 10; raw += 0.01) {
      const angle = unwrapAngle(raw, null);
      expect(angle).toBeGreaterThan(-Math.PI / 2 - 1e-9);
      expect(angle).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    }
  });

  it("keeps the same line: the result differs from the input by a whole number of pi", () => {
    const random = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const raw = (random() * 2 - 1) * 20;
      const previous = (random() * 2 - 1) * 20;
      const turns = (unwrapAngle(raw, previous) - raw) / Math.PI;
      expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-9);
    }
  });

  it("for any sequence of angles, however wild, never moves more than pi/2 per step", () => {
    const random = mulberry32(12345);
    let previous: number | null = null;
    let largest = 0;
    for (let i = 0; i < 5000; i++) {
      // Jumps of every size, including straight across +-pi and whole turns.
      const raw = (random() * 2 - 1) * 12 * (i % 7 === 0 ? 1 : 0.05);
      const angle = unwrapAngle(raw, previous);
      if (previous !== null)
        largest = Math.max(largest, Math.abs(angle - previous));
      previous = angle;
    }
    expect(largest).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
  });

  it("does not drift: a steady slow turn keeps turning instead of wrapping back", () => {
    let previous: number | null = null;
    const out: number[] = [];
    for (let deg = 0; deg <= 720; deg += 1) {
      const raw = Math.atan2(
        Math.sin((deg * Math.PI) / 180),
        Math.cos((deg * Math.PI) / 180),
      );
      previous = unwrapAngle(raw, previous);
      out.push(previous);
    }
    for (let i = 1; i < out.length; i++)
      expect(Math.abs(out[i] - out[i - 1])).toBeLessThan(0.02);
    // Two full turns of a line is four times pi round.
    expect(out[out.length - 1] - out[0]).toBeGreaterThan(Math.PI * 3.9);
  });
});

describe("placeEdge: the same segment whichever corner is which", () => {
  const endsOf = (edge: ReturnType<typeof placeEdge>) => {
    const half = edge.length / 2;
    return [
      {
        x: edge.centre.x + Math.cos(edge.angle) * half,
        y: edge.centre.y + Math.sin(edge.angle) * half,
      },
      {
        x: edge.centre.x - Math.cos(edge.angle) * half,
        y: edge.centre.y - Math.sin(edge.angle) * half,
      },
    ];
  };
  const sameSegment = (ends: Point[], a: Point, b: Point) => {
    const d = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
    return (
      d(ends[0], a) + d(ends[1], b) < 1e-6 ||
      d(ends[0], b) + d(ends[1], a) < 1e-6
    );
  };

  it("for random segments, in either direction and from any previous angle", () => {
    const random = mulberry32(99);
    for (let i = 0; i < 500; i++) {
      const a = { x: random() * 400, y: random() * 800 };
      const b = { x: random() * 400, y: random() * 800 };
      const previous = i % 3 === 0 ? null : (random() * 2 - 1) * 15;
      expect(sameSegment(endsOf(placeEdge(a, b, previous)), a, b)).toBe(true);
      expect(sameSegment(endsOf(placeEdge(b, a, previous)), a, b)).toBe(true);
    }
  });

  it("for all eight ways of labelling the corners of a sheet (four cyclic shifts, each way round), the four drawn segments are the same four", () => {
    const side = (a: Point, b: Point) =>
      [a, b]
        .map((p) => `${p.x},${p.y}`)
        .sort()
        .join("|");
    const expected = EDGES.map(([from, to]) =>
      side(SHEET[from], SHEET[to]),
    ).sort();
    for (const reversed of [false, true]) {
      for (let shift = 0; shift < 4; shift++) {
        const order = [0, 1, 2, 3].map((i) => (reversed ? 3 - i : i));
        const labelled = order.map((i) => SHEET[(i + shift) % 4]);
        const { placements } = placeEdges(labelled, [null, null, null, null]);
        const drawn = placements
          .map((edge) => {
            const ends = endsOf(edge);
            // Match each drawn end back to a corner of the sheet.
            const names = ends.map((end) =>
              SHEET.find((c) => Math.hypot(c.x - end.x, c.y - end.y) < 1e-6),
            );
            expect(names.every(Boolean)).toBe(true);
            return side(names[0]!, names[1]!);
          })
          .sort();
        expect(drawn, `shift ${shift}${reversed ? " reversed" : ""}`).toEqual(
          expected,
        );
      }
    }
  });
});

describe("the outline when the paper wobbles about level or upright", () => {
  // The far end of each side moves from -1.5 to +1.5 px across the side's
  // axis, 0.05 px at a time: the edge wobbling about level (or upright).
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
        const { angle } = placeEdge(SHEET[from], end, previous);
        if (previous !== null)
          expect(Math.abs(angle - previous), `offset ${offset}`).toBeLessThan(
            MAX_JUMP,
          );
        previous = angle;
      }
    },
  );

  it("is continuous the other way round too: the far end wobbling before the near one", () => {
    // Bottom side drawn right to left (as an old labelling did), level +-1.5 px.
    let previous: number | null = null;
    for (let offset = -1.5; offset <= 1.5 + 1e-9; offset += STEP) {
      const { angle } = placeEdge(
        SHEET[2],
        { x: SHEET[3].x, y: SHEET[3].y + offset },
        previous,
      );
      if (previous !== null)
        expect(Math.abs(angle - previous)).toBeLessThan(MAX_JUMP);
      previous = angle;
    }
  });
});

describe("edgeTransform", () => {
  it("puts the element's middle on the segment's middle, turned and stretched", () => {
    const edge = placeEdge({ x: 10, y: 20 }, { x: 10, y: 120 }, null);
    expect(edgeTransform(edge)).toBe(
      `translate3d(10px, 70px, 0) rotate(${Math.PI / 2}rad) scaleX(100)`,
    );
    expect(
      edgeTransform(placeEdge({ x: 0, y: 0 }, { x: 30, y: 40 }, null)),
    ).toContain("scaleX(50)");
  });
});
