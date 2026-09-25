import { describe, expect, it } from "vitest";
import {
  HAND_CONNECTIONS,
  KNUCKLE_LANDMARK_IDS,
  computeDimensionLine,
  boxesOverlap,
  separateLabelBoxes,
  buildHandSilhouette,
  silhouetteLandmarksFromHandLandmarks,
  FINGER_WIDTH_FRACTIONS,
  type Point,
  type Box,
} from "../../src/client/geometry/handSilhouette";

describe("HAND_CONNECTIONS", () => {
  it("has exactly the standard 21 MediaPipe Hands edges", () => {
    expect(HAND_CONNECTIONS).toHaveLength(21);
  });

  it("only references valid landmark indices (0-20)", () => {
    for (const [a, b] of HAND_CONNECTIONS) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(20);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(20);
    }
  });

  it("connects the wrist to the thumb and index chains, and pinky MCP", () => {
    const has = (a: number, b: number) =>
      HAND_CONNECTIONS.some(
        ([x, y]) => (x === a && y === b) || (x === b && y === a),
      );
    expect(has(0, 1)).toBe(true);
    expect(has(0, 5)).toBe(true);
    expect(has(0, 17)).toBe(true);
  });
});

describe("KNUCKLE_LANDMARK_IDS", () => {
  it("has the 4 MCPs and the 8 PIP/DIP joints of the four fingers (12 total)", () => {
    expect(KNUCKLE_LANDMARK_IDS).toHaveLength(12);
    expect(new Set(KNUCKLE_LANDMARK_IDS).size).toBe(12);
    for (const id of [5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19]) {
      expect(KNUCKLE_LANDMARK_IDS).toContain(id);
    }
  });

  it("excludes the wrist, thumb, and every fingertip", () => {
    for (const excluded of [0, 1, 2, 3, 4, 8, 12, 16, 20]) {
      expect(KNUCKLE_LANDMARK_IDS).not.toContain(excluded);
    }
  });
});

describe("computeDimensionLine", () => {
  const a: Point = { x: 0, y: 0 };
  const b: Point = { x: 0, y: 100 }; // vertical segment, e.g. hand length

  it("offsets the whole line to one side without changing its length", () => {
    const geo = computeDimensionLine(a, b, 20, 1);
    const offsetLen = Math.hypot(
      geo.offsetEnd.x - geo.offsetStart.x,
      geo.offsetEnd.y - geo.offsetStart.y,
    );
    expect(offsetLen).toBeCloseTo(100, 5);
    // Perpendicular to a vertical segment is horizontal — which exact sign
    // "side" maps to is an implementation choice; what matters is it's a
    // real perpendicular offset, and side=-1 (below) is the opposite one.
    expect(Math.abs(geo.offsetStart.x)).toBeCloseTo(20, 5);
    expect(geo.offsetEnd.x).toBeCloseTo(geo.offsetStart.x, 5);
  });

  it("offsets to the opposite side for side=-1", () => {
    const plus = computeDimensionLine(a, b, 20, 1);
    const minus = computeDimensionLine(a, b, 20, -1);
    expect(minus.offsetStart.x).toBeCloseTo(-plus.offsetStart.x, 5);
  });

  it("connectors run from the real points out to the offset line", () => {
    const geo = computeDimensionLine(a, b, 20, 1);
    expect(geo.startConnector[0]).toEqual(a);
    expect(geo.startConnector[1]).toEqual(geo.offsetStart);
    expect(geo.endConnector[0]).toEqual(b);
    expect(geo.endConnector[1]).toEqual(geo.offsetEnd);
  });

  it("ticks are centred on the offset line and run perpendicular to it", () => {
    const geo = computeDimensionLine(a, b, 20, 1, 10);
    const tickMidX = (geo.startTick[0].x + geo.startTick[1].x) / 2;
    const tickMidY = (geo.startTick[0].y + geo.startTick[1].y) / 2;
    expect(tickMidX).toBeCloseTo(geo.offsetStart.x, 5);
    expect(tickMidY).toBeCloseTo(geo.offsetStart.y, 5);
    const tickLen = Math.hypot(
      geo.startTick[1].x - geo.startTick[0].x,
      geo.startTick[1].y - geo.startTick[0].y,
    );
    expect(tickLen).toBeCloseTo(10, 5);
  });

  it("places the label further out along the same offset side, at the midpoint", () => {
    const geo = computeDimensionLine(a, b, 20, 1, 10, 14);
    // Further out than the offset line itself (20), same sign/side.
    expect(Math.abs(geo.labelAnchor.x)).toBeCloseTo(34, 5); // 20 (offset) + 14 (label push)
    expect(Math.sign(geo.labelAnchor.x)).toBe(Math.sign(geo.offsetStart.x));
    expect(geo.labelAnchor.y).toBeCloseTo(50, 5); // midpoint of a/b in y
  });
});

describe("boxesOverlap / separateLabelBoxes", () => {
  it("detects overlap for concentric boxes", () => {
    const a: Box = { x: 0, y: 0, width: 40, height: 20 };
    const b: Box = { x: 5, y: 0, width: 40, height: 20 };
    expect(boxesOverlap(a, b)).toBe(true);
  });

  it("detects no overlap for well-separated boxes", () => {
    const a: Box = { x: 0, y: 0, width: 40, height: 20 };
    const b: Box = { x: 500, y: 500, width: 40, height: 20 };
    expect(boxesOverlap(a, b)).toBe(false);
  });

  it("separateLabelBoxes pushes two overlapping boxes apart until clear", () => {
    const a: Box = { x: 0, y: 0, width: 60, height: 24 };
    const b: Box = { x: 10, y: 0, width: 60, height: 24 };
    const [ra, rb] = separateLabelBoxes(a, b);
    expect(boxesOverlap(ra, rb)).toBe(false);
    // Symmetric push: both moved away from the midpoint.
    expect(ra.x).toBeLessThan(a.x);
    expect(rb.x).toBeGreaterThan(b.x);
  });

  it("separateLabelBoxes is a no-op when boxes don't overlap", () => {
    const a: Box = { x: 0, y: 0, width: 10, height: 10 };
    const b: Box = { x: 1000, y: 1000, width: 10, height: 10 };
    const [ra, rb] = separateLabelBoxes(a, b);
    expect(ra).toEqual(a);
    expect(rb).toEqual(b);
  });
});

describe("silhouetteLandmarksFromHandLandmarks + buildHandSilhouette", () => {
  // A simple, plausible 21-point hand: wrist at bottom, fingers spread
  // upward, matching real MediaPipe landmark index conventions.
  const landmarks: Point[] = [
    { x: 100, y: 200 }, // 0 wrist
    { x: 70, y: 180 }, // 1 thumb CMC
    { x: 55, y: 160 }, // 2 thumb MCP
    { x: 45, y: 140 }, // 3 thumb IP
    { x: 38, y: 120 }, // 4 thumb tip
    { x: 80, y: 140 }, // 5 index MCP
    { x: 78, y: 110 }, // 6 index PIP
    { x: 76, y: 90 }, // 7 index DIP
    { x: 74, y: 70 }, // 8 index tip
    { x: 100, y: 135 }, // 9 middle MCP
    { x: 100, y: 100 }, // 10 middle PIP
    { x: 100, y: 75 }, // 11 middle DIP
    { x: 100, y: 50 }, // 12 middle tip
    { x: 120, y: 140 }, // 13 ring MCP
    { x: 122, y: 108 }, // 14 ring PIP
    { x: 124, y: 88 }, // 15 ring DIP
    { x: 126, y: 68 }, // 16 ring tip
    { x: 140, y: 150 }, // 17 pinky MCP
    { x: 144, y: 125 }, // 18 pinky PIP
    { x: 147, y: 105 }, // 19 pinky DIP
    { x: 150, y: 88 }, // 20 pinky tip
  ];

  it("pulls the 11 named points out of the 21-point array correctly", () => {
    const pts = silhouetteLandmarksFromHandLandmarks(landmarks);
    expect(pts.wrist).toEqual(landmarks[0]);
    expect(pts.indexMcp).toEqual(landmarks[5]);
    expect(pts.indexTip).toEqual(landmarks[8]);
    expect(pts.middleMcp).toEqual(landmarks[9]);
    expect(pts.middleTip).toEqual(landmarks[12]);
    expect(pts.ringMcp).toEqual(landmarks[13]);
    expect(pts.ringTip).toEqual(landmarks[16]);
    expect(pts.pinkyMcp).toEqual(landmarks[17]);
    expect(pts.pinkyTip).toEqual(landmarks[20]);
    expect(pts.thumbBase).toEqual(landmarks[2]);
    expect(pts.thumbTip).toEqual(landmarks[4]);
  });

  it("builds 4 finger capsules from MCP to tip, widths proportional to palm width", () => {
    const pts = silhouetteLandmarksFromHandLandmarks(landmarks);
    const geo = buildHandSilhouette(pts);
    const palmWidthPx = Math.hypot(
      pts.pinkyMcp.x - pts.indexMcp.x,
      pts.pinkyMcp.y - pts.indexMcp.y,
    );

    expect(geo.fingers).toHaveLength(4);
    const [index, middle, ring, pinky] = geo.fingers;
    expect(index.from).toEqual(pts.indexMcp);
    expect(index.to).toEqual(pts.indexTip);
    expect(index.widthPx).toBeCloseTo(
      palmWidthPx * FINGER_WIDTH_FRACTIONS.index,
      5,
    );
    expect(middle.widthPx).toBeCloseTo(
      palmWidthPx * FINGER_WIDTH_FRACTIONS.middle,
      5,
    );
    expect(ring.widthPx).toBeCloseTo(
      palmWidthPx * FINGER_WIDTH_FRACTIONS.ring,
      5,
    );
    expect(pinky.widthPx).toBeCloseTo(
      palmWidthPx * FINGER_WIDTH_FRACTIONS.pinky,
      5,
    );
    // Pinky is clearly the narrowest finger.
    expect(pinky.widthPx).toBeLessThan(index.widthPx);
    expect(pinky.widthPx).toBeLessThan(middle.widthPx);
  });

  it("makes the thumb capsule the thickest", () => {
    const pts = silhouetteLandmarksFromHandLandmarks(landmarks);
    const geo = buildHandSilhouette(pts);
    const widest = Math.max(...geo.fingers.map((f) => f.widthPx));
    expect(geo.thumb.widthPx).toBeGreaterThan(widest);
    expect(geo.thumb.from).toEqual(pts.thumbBase);
    expect(geo.thumb.to).toEqual(pts.thumbTip);
  });

  it("builds a closed palm path (starts with M, ends with Z)", () => {
    const pts = silhouetteLandmarksFromHandLandmarks(landmarks);
    const geo = buildHandSilhouette(pts);
    expect(geo.palmPathD.startsWith("M ")).toBe(true);
    expect(geo.palmPathD.trim().endsWith("Z")).toBe(true);
  });

  it("scales with a bigger hand (double distance apart -> double finger widths)", () => {
    const scaled = landmarks.map((p) => ({ x: p.x * 2, y: p.y * 2 }));
    const smallGeo = buildHandSilhouette(
      silhouetteLandmarksFromHandLandmarks(landmarks),
    );
    const bigGeo = buildHandSilhouette(
      silhouetteLandmarksFromHandLandmarks(scaled),
    );
    expect(bigGeo.fingers[1].widthPx).toBeCloseTo(
      smallGeo.fingers[1].widthPx * 2,
      5,
    );
  });
});
