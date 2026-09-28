/**
 * Pure hand-overlay geometry shared by two draw sites: the measured-state
 * skeleton overlay (`ScanClient.tsx`'s "ok" branch, real MediaPipe
 * landmarks) and the live-viewfinder hand ghost (`src/client/camera/
 * handGhost.ts`, no real landmarks yet — a synthesised 21-point layout
 * standing in for them). Neither draw site does its own geometry; both
 * call into this file. Nothing here computes a measurement — every
 * function takes plain points already known to the caller (real landmarks
 * or synthesised ones) and returns plain draw geometry (lines, a path
 * string, dimension-line ticks, label positions).
 */
import { LANDMARK } from "../../lib/contracts/measurement";

export interface Point {
  readonly x: number;
  readonly y: number;
}

// ── Skeleton (MediaPipe HAND_CONNECTIONS) ───────────────────────────────

/** The standard 21-edge MediaPipe Hands skeleton, landmark-index pairs. */
export const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4], // thumb
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8], // index
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12], // middle (palm cross-connection 5-9)
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16], // ring (palm cross-connection 9-13)
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20], // pinky (palm cross-connection 13-17)
  [0, 17], // palm base to pinky MCP
];

/**
 * The MCP (5, 9, 13, 17) and PIP/DIP joints of the four fingers —
 * "the knuckles" — emphasised as larger accent dots in the measured-state
 * overlay. Excludes the thumb (no PIP/DIP) and every fingertip.
 */
export const KNUCKLE_LANDMARK_IDS: readonly number[] = [
  LANDMARK.index[0],
  LANDMARK.index[1],
  LANDMARK.index[2],
  LANDMARK.middle[0],
  LANDMARK.middle[1],
  LANDMARK.middle[2],
  LANDMARK.ring[0],
  LANDMARK.ring[1],
  LANDMARK.ring[2],
  LANDMARK.pinky[0],
  LANDMARK.pinky[1],
  LANDMARK.pinky[2],
];

// ── Dimension lines (hand length / palm width) ──────────────────────────

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(v: Point): Point {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

/** 90°-rotated unit vector — `side` picks which of the two perpendiculars. */
function perpendicular(direction: Point, side: 1 | -1): Point {
  return { x: -direction.y * side, y: direction.x * side };
}

export interface DimensionLineGeometry {
  /** The offset line itself, parallel to `a`→`b`, pushed `offsetPx` to one side. */
  readonly offsetStart: Point;
  readonly offsetEnd: Point;
  /** Short perpendicular hash marks at each end of the offset line. */
  readonly startTick: readonly [Point, Point];
  readonly endTick: readonly [Point, Point];
  /** "Extension lines" from the real points out to the offset line. */
  readonly startConnector: readonly [Point, Point];
  readonly endConnector: readonly [Point, Point];
  /** Where a label beside this line would sit, before collision resolution. */
  readonly labelAnchor: Point;
}

/**
 * A technical-drawing-style dimension line for the segment `a`→`b`: drawn
 * `offsetPx` to one `side` of the real points (so it never crosses the
 * skeleton), with perpendicular end ticks and extension-line connectors
 * back to the real points.
 */
export function computeDimensionLine(
  a: Point,
  b: Point,
  offsetPx: number,
  side: 1 | -1,
  tickLengthPx = 10,
  labelOffsetPx = 14,
): DimensionLineGeometry {
  const direction = normalize({ x: b.x - a.x, y: b.y - a.y });
  const perp = perpendicular(direction, side);
  const push = (p: Point, d: number): Point => ({
    x: p.x + perp.x * d,
    y: p.y + perp.y * d,
  });

  const offsetStart = push(a, offsetPx);
  const offsetEnd = push(b, offsetPx);
  const half = tickLengthPx / 2;
  // Ticks are short segments centred ON the offset line, running along the
  // same perpendicular axis as the offset itself.
  const startTick: readonly [Point, Point] = [
    { x: offsetStart.x - perp.x * half, y: offsetStart.y - perp.y * half },
    { x: offsetStart.x + perp.x * half, y: offsetStart.y + perp.y * half },
  ];
  const endTick: readonly [Point, Point] = [
    { x: offsetEnd.x - perp.x * half, y: offsetEnd.y - perp.y * half },
    { x: offsetEnd.x + perp.x * half, y: offsetEnd.y + perp.y * half },
  ];

  const mid = {
    x: (offsetStart.x + offsetEnd.x) / 2,
    y: (offsetStart.y + offsetEnd.y) / 2,
  };
  const labelAnchor = push(mid, labelOffsetPx);

  return {
    offsetStart,
    offsetEnd,
    startTick,
    endTick,
    startConnector: [a, offsetStart],
    endConnector: [b, offsetEnd],
    labelAnchor,
  };
}

// ── Label overlap resolution ────────────────────────────────────────────

export interface Box {
  /** Centre. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width &&
    Math.abs(a.y - b.y) * 2 < a.height + b.height
  );
}

/**
 * Given two label boxes (already positioned beside their own dimension
 * line), push them apart along the axis between their centres until they
 * no longer overlap each other. A small, deterministic, pure declutter —
 * not a general layout solver, which two labels don't need.
 */
export function separateLabelBoxes(
  a: Box,
  b: Box,
  stepPx = 4,
  maxIterations = 60,
): readonly [Box, Box] {
  let boxA = a;
  let boxB = b;
  let iterations = 0;
  while (boxesOverlap(boxA, boxB) && iterations < maxIterations) {
    const dx = boxB.x - boxA.x;
    const dy = boxB.y - boxA.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    boxA = { ...boxA, x: boxA.x - ux * stepPx, y: boxA.y - uy * stepPx };
    boxB = { ...boxB, x: boxB.x + ux * stepPx, y: boxB.y + uy * stepPx };
    iterations++;
  }
  return [boxA, boxB];
}

// ── Hand silhouette (capsule fingers + rounded palm) ────────────────────

/** Finger stroke width as a fraction of palm width (index↔pinky MCP distance). */
export const FINGER_WIDTH_FRACTIONS = {
  index: 0.19,
  middle: 0.2,
  ring: 0.19,
  pinky: 0.16,
  thumb: 0.24,
} as const;

export interface HandCapsule {
  readonly from: Point;
  readonly to: Point;
  readonly widthPx: number;
}

export interface HandSilhouetteGeometry {
  /** Index, middle, ring, pinky — MCP → tip, near-constant width, round-capped. */
  readonly fingers: readonly [
    HandCapsule,
    HandCapsule,
    HandCapsule,
    HandCapsule,
  ];
  /** Base → tip, thicker, angled. */
  readonly thumb: HandCapsule;
  /** Filled, rounded top/sides, straight wrist edge — draw BEHIND the finger/thumb capsules. */
  readonly palmPathD: string;
}

function catmullRomOpenPathD(points: readonly Point[]): string {
  const n = points.length;
  if (n < 2) return "";
  if (n === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }
  const at = (i: number) => points[Math.max(0, Math.min(n - 1, i))];
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const cp1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const cp2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${p2.x} ${p2.y}`;
  }
  return d;
}

export interface HandSilhouetteLandmarks {
  readonly wrist: Point;
  readonly indexMcp: Point;
  readonly indexTip: Point;
  readonly middleMcp: Point;
  readonly middleTip: Point;
  readonly ringMcp: Point;
  readonly ringTip: Point;
  readonly pinkyMcp: Point;
  readonly pinkyTip: Point;
  readonly thumbBase: Point;
  readonly thumbTip: Point;
}

/** Pulls the 11 points `buildHandSilhouette` needs out of a full 21-point MediaPipe-shaped landmark array. */
export function silhouetteLandmarksFromHandLandmarks(
  landmarks: readonly Point[],
): HandSilhouetteLandmarks {
  return {
    wrist: landmarks[LANDMARK.wrist],
    indexMcp: landmarks[LANDMARK.index[0]],
    indexTip: landmarks[LANDMARK.index[3]],
    middleMcp: landmarks[LANDMARK.middle[0]],
    middleTip: landmarks[LANDMARK.middle[3]],
    ringMcp: landmarks[LANDMARK.ring[0]],
    ringTip: landmarks[LANDMARK.ring[3]],
    pinkyMcp: landmarks[LANDMARK.pinky[0]],
    pinkyTip: landmarks[LANDMARK.pinky[3]],
    thumbBase: landmarks[LANDMARK.thumb[1]],
    thumbTip: landmarks[LANDMARK.thumb[3]],
  };
}

/**
 * Builds the hand silhouette (4 finger capsules + thumb capsule + a filled
 * palm path) from 11 named points — real landmarks
 * (`silhouetteLandmarksFromHandLandmarks`) or synthesised ones (the live
 * viewfinder's hand ghost). Every proportion (finger width, palm breadth,
 * wrist width) is derived from the points' OWN distances (palm width =
 * index↔pinky MCP), never a fixed pixel constant, so the same function
 * works at any resolution.
 */
export function buildHandSilhouette(
  points: HandSilhouetteLandmarks,
): HandSilhouetteGeometry {
  const {
    wrist,
    indexMcp,
    indexTip,
    middleMcp,
    middleTip,
    ringMcp,
    ringTip,
    pinkyMcp,
    pinkyTip,
    thumbBase,
    thumbTip,
  } = points;

  const palmWidthPx = dist(indexMcp, pinkyMcp);
  const palmAxis = normalize({
    x: pinkyMcp.x - indexMcp.x,
    y: pinkyMcp.y - indexMcp.y,
  });

  const fingers: [HandCapsule, HandCapsule, HandCapsule, HandCapsule] = [
    {
      from: indexMcp,
      to: indexTip,
      widthPx: palmWidthPx * FINGER_WIDTH_FRACTIONS.index,
    },
    {
      from: middleMcp,
      to: middleTip,
      widthPx: palmWidthPx * FINGER_WIDTH_FRACTIONS.middle,
    },
    {
      from: ringMcp,
      to: ringTip,
      widthPx: palmWidthPx * FINGER_WIDTH_FRACTIONS.ring,
    },
    {
      from: pinkyMcp,
      to: pinkyTip,
      widthPx: palmWidthPx * FINGER_WIDTH_FRACTIONS.pinky,
    },
  ];
  const thumb: HandCapsule = {
    from: thumbBase,
    to: thumbTip,
    widthPx: palmWidthPx * FINGER_WIDTH_FRACTIONS.thumb,
  };

  // Palm: broad + rounded top/sides, a dead-straight wrist edge. Padded
  // slightly beyond the raw index/pinky MCP span so the palm reads wider
  // than the fingers sitting on top of it, and bulged slightly past the
  // knuckle line (harmlessly hidden under the finger capsules) so the top
  // isn't a flat line either.
  const outward = (p: Point, sign: 1 | -1, amount: number): Point => ({
    x: p.x + palmAxis.x * amount * sign,
    y: p.y + palmAxis.y * amount * sign,
  });
  const indexOuter = outward(indexMcp, -1, palmWidthPx * 0.12);
  const pinkyOuter = outward(pinkyMcp, 1, palmWidthPx * 0.12);
  const knuckleMid = {
    x: (indexMcp.x + pinkyMcp.x) / 2,
    y: (indexMcp.y + pinkyMcp.y) / 2,
  };
  const towardFingers = normalize({
    x: knuckleMid.x - wrist.x,
    y: knuckleMid.y - wrist.y,
  });
  const topBulge = {
    x: knuckleMid.x + towardFingers.x * palmWidthPx * 0.1,
    y: knuckleMid.y + towardFingers.y * palmWidthPx * 0.1,
  };
  const wristHalfWidth = palmWidthPx * 0.32;
  const wristIndexSide = outward(wrist, -1, wristHalfWidth);
  const wristPinkySide = outward(wrist, 1, wristHalfWidth);

  const palmPathD =
    catmullRomOpenPathD([
      wristIndexSide,
      indexOuter,
      topBulge,
      pinkyOuter,
      wristPinkySide,
    ]) + ` L ${wristIndexSide.x} ${wristIndexSide.y} Z`;

  return { fingers, thumb, palmPathD };
}
