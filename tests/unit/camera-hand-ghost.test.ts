import { describe, expect, it } from "vitest";
import { computeHandGhostGeometry } from "../../src/client/camera/handGhost";
import type { Quad } from "../../src/client/camera/quad";

const SQUARE: Quad = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 100, y: 0 },
  bottomRight: { x: 100, y: 100 },
  bottomLeft: { x: 0, y: 100 },
};

describe("computeHandGhostGeometry", () => {
  it("returns 4 finger capsules, a thumb capsule, and a closed palm path", () => {
    const geo = computeHandGhostGeometry(SQUARE, "right");
    expect(geo.fingers).toHaveLength(4);
    expect(geo.thumb).toBeDefined();
    expect(geo.palmPathD.startsWith("M ")).toBe(true);
    expect(geo.palmPathD.trim().endsWith("Z")).toBe(true);
  });

  it("places the wrist end of the fingers/palm near the bottom edge and fingertips near the top", () => {
    const geo = computeHandGhostGeometry(SQUARE, "right");
    const fingerFromYs = geo.fingers.map((f) => f.from.y);
    const fingerToYs = geo.fingers.map((f) => f.to.y);
    // MCPs (the "from" end) sit below the tips ("to" end) for a hand
    // pointing up out of the quad's top.
    for (let i = 0; i < 4; i++) {
      expect(fingerFromYs[i]).toBeGreaterThan(fingerToYs[i]);
    }
    expect(Math.min(...fingerToYs)).toBeLessThan(15); // near the top
  });

  it("keeps the middle finger the longest and the pinky clearly the narrowest", () => {
    const geo = computeHandGhostGeometry(SQUARE, "right");
    const [index, middle, ring, pinky] = geo.fingers;
    const length = (f: {
      from: { x: number; y: number };
      to: { x: number; y: number };
    }) => Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y);
    expect(length(middle)).toBeGreaterThan(length(index));
    expect(length(middle)).toBeGreaterThan(length(ring));
    expect(length(middle)).toBeGreaterThan(length(pinky));
    expect(pinky.widthPx).toBeLessThan(index.widthPx);
    expect(pinky.widthPx).toBeLessThan(middle.widthPx);
    expect(pinky.widthPx).toBeLessThan(ring.widthPx);
  });

  it("gives the thumb the largest capsule width", () => {
    const geo = computeHandGhostGeometry(SQUARE, "right");
    const widest = Math.max(...geo.fingers.map((f) => f.widthPx));
    expect(geo.thumb.widthPx).toBeGreaterThan(widest);
  });

  it("mirrors left vs. right around the quad's horizontal centre", () => {
    const right = computeHandGhostGeometry(SQUARE, "right");
    const left = computeHandGhostGeometry(SQUARE, "left");
    for (let i = 0; i < 4; i++) {
      expect(left.fingers[i].from.x).toBeCloseTo(
        100 - right.fingers[i].from.x,
        3,
      );
      expect(left.fingers[i].to.x).toBeCloseTo(100 - right.fingers[i].to.x, 3);
    }
    // Thumb genuinely switches sides, not a no-op mirror.
    expect(left.thumb.to.x).not.toBeCloseTo(right.thumb.to.x, 1);
  });

  it("widens proportionally to the quad's own height on a normal quad (not a fixed fraction of quad width)", () => {
    // Same width, two different heights: a "taller" hand-length span
    // should want a wider hand, so its horizontal span should be larger
    // than the shorter quad's, even though both quads are the same width.
    const short: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 100, y: 60 },
      bottomLeft: { x: 0, y: 60 },
    };
    const tall: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 100, y: 200 },
      bottomLeft: { x: 0, y: 200 },
    };
    const spanX = (quad: Quad) => {
      const geo = computeHandGhostGeometry(quad, "right");
      const xs = [
        ...geo.fingers.map((f) => f.from.x),
        ...geo.fingers.map((f) => f.to.x),
        geo.thumb.to.x,
      ];
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spanX(tall)).toBeGreaterThan(spanX(short));
  });

  it("clamps the hand's width so it never blows up past a bounded multiple of the quad's own width on an extreme (tall, narrow) quad", () => {
    // Quad is only 40 units wide but 1000 tall — the "45%-of-length" width
    // would want to be ~10x the quad's own width. MAX_WIDTH_FRACTION caps
    // that so the ghost stays a bounded, sane size instead of exploding.
    const tall: Quad = {
      topLeft: { x: 480, y: 0 },
      topRight: { x: 520, y: 0 },
      bottomRight: { x: 520, y: 1000 },
      bottomLeft: { x: 480, y: 1000 },
    };
    const geo = computeHandGhostGeometry(tall, "right");
    const xs = [
      ...geo.fingers.map((f) => f.from.x),
      ...geo.fingers.map((f) => f.to.x),
      geo.thumb.to.x,
    ];
    const spanX = Math.max(...xs) - Math.min(...xs);
    const quadWidth = 40;
    // Bounded: comfortably wider than a tiny sliver, but never more than
    // ~2x the quad's own width (the clamp, not an unbounded blow-up).
    expect(spanX).toBeGreaterThan(quadWidth * 0.5);
    expect(spanX).toBeLessThan(quadWidth * 2);
  });

  it("follows a non-square tracked quad rather than the caller's raw coordinates", () => {
    const shifted: Quad = {
      topLeft: { x: 200, y: 200 },
      topRight: { x: 400, y: 210 },
      bottomRight: { x: 410, y: 500 },
      bottomLeft: { x: 190, y: 490 },
    };
    const geo = computeHandGhostGeometry(shifted, "right");
    const allPoints = [
      ...geo.fingers.flatMap((f) => [f.from, f.to]),
      geo.thumb.from,
      geo.thumb.to,
    ];
    for (const p of allPoints) {
      expect(p.x).toBeGreaterThan(100);
      expect(p.x).toBeLessThan(500);
      expect(p.y).toBeGreaterThan(150);
      expect(p.y).toBeLessThan(550);
    }
  });
});
