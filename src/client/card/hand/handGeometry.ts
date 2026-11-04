/**
 * Scan lab L10 P1 (2026-11-02, candidate 未拍板): plain geometry on the 21
 * MediaPipe hand landmarks, for the hand-placement guides
 * (`guides/*.ts`) and the hand record. Every function is pure and takes the
 * points in any one 2D frame (image px, or the view's 0..1 frame); ratios and
 * angles do not depend on which.
 *
 * Image convention: x right, y DOWN. "Up" in the picture is -y. The person
 * holds the phone upright above a palm-down hand, fingers toward the top of
 * the picture.
 */

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** MediaPipe hand landmark indices used here. */
export const LM = {
  wrist: 0,
  thumbCmc: 1,
  thumbMcp: 2,
  thumbIp: 3,
  thumbTip: 4,
  indexMcp: 5,
  indexTip: 8,
  middleMcp: 9,
  middleTip: 12,
  ringMcp: 13,
  ringTip: 16,
  pinkyMcp: 17,
  pinkyTip: 20,
} as const;

/** Each finger's chain, base to tip (the thumb from its MCP, 2-3-4). */
export const FINGER_CHAINS = {
  thumb: [2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
} as const;

export type FingerName = keyof typeof FINGER_CHAINS;

export const LANDMARK_COUNT = 21;

/** Whether `points` is 21 finite points. */
export function isHand(points: readonly Pt[] | null | undefined): boolean {
  return (
    Array.isArray(points) &&
    points.length === LANDMARK_COUNT &&
    points.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
  );
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Hand length as the scan defines it: wrist (0) to middle fingertip (12). */
export function handLength(points: readonly Pt[]): number {
  return dist(points[LM.wrist], points[LM.middleTip]);
}

/** Hand width as the scan defines it: index MCP (5) to pinky MCP (17). */
export function handWidth(points: readonly Pt[]): number {
  return dist(points[LM.indexMcp], points[LM.pinkyMcp]);
}

/**
 * Per finger: straight base-to-tip distance over the summed segment lengths
 * (1 = straight; a curled finger is well under). `null` for a finger whose
 * segments add up to zero.
 */
export function fingerStraightness(
  points: readonly Pt[],
): Record<FingerName, number | null> {
  const out = {} as Record<FingerName, number | null>;
  for (const [name, chain] of Object.entries(FINGER_CHAINS) as [
    FingerName,
    readonly number[],
  ][]) {
    let path = 0;
    for (let i = 1; i < chain.length; i++)
      path += dist(points[chain[i - 1]], points[chain[i]]);
    const straight = dist(points[chain[0]], points[chain[chain.length - 1]]);
    out[name] = path > 0 ? straight / path : null;
  }
  return out;
}

/** The smallest straightness of the four fingers (thumb left out); `null` if none. */
export function minFingerStraightness(points: readonly Pt[]): number | null {
  const s = fingerStraightness(points);
  const values = [s.index, s.middle, s.ring, s.pinky].filter(
    (v): v is number => v !== null,
  );
  return values.length ? Math.min(...values) : null;
}

/**
 * Gaps between neighbouring fingertips (8-12, 12-16, 16-20) over the hand
 * length: how far the fingers are spread. Recorded only (Kirby 2026-11-02:
 * the spread is natural, not checked). `null` for a zero hand length.
 */
export function fingertipGaps(points: readonly Pt[]): {
  readonly indexMiddle: number;
  readonly middleRing: number;
  readonly ringPinky: number;
} | null {
  const L = handLength(points);
  if (!(L > 0)) return null;
  return {
    indexMiddle: dist(points[8], points[12]) / L,
    middleRing: dist(points[12], points[16]) / L,
    ringPinky: dist(points[16], points[20]) / L,
  };
}

/**
 * Signed angle, degrees, of the vector a→b against the picture's up (-y):
 * 0 = pointing straight up, positive = leaning right (clockwise on screen).
 */
export function angleFromUpDeg(a: Pt, b: Pt): number {
  return (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
}

/** The hand's axis (0→9) against the picture's up, signed degrees. */
export function handAxisDeg(points: readonly Pt[]): number {
  return angleFromUpDeg(points[LM.wrist], points[LM.middleMcp]);
}

/** Unsigned angle between two vectors from the same origin, degrees. */
export function angleBetweenDeg(o: Pt, a: Pt, b: Pt): number {
  const ax = a.x - o.x;
  const ay = a.y - o.y;
  const bx = b.x - o.x;
  const by = b.y - o.y;
  const na = Math.hypot(ax, ay);
  const nb = Math.hypot(bx, by);
  if (!(na > 0 && nb > 0)) return NaN;
  const c = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (na * nb)));
  return (Math.acos(c) * 180) / Math.PI;
}

/**
 * Wrist-deviation stand-ins (proposal §3): angles at the wrist between 0→9
 * and 0→5, and between 0→9 and 0→17, degrees.
 */
export function wristAngles(points: readonly Pt[]): {
  readonly middleToIndexDeg: number;
  readonly middleToPinkyDeg: number;
} {
  const o = points[LM.wrist];
  return {
    middleToIndexDeg: angleBetweenDeg(o, points[LM.middleMcp], points[5]),
    middleToPinkyDeg: angleBetweenDeg(o, points[LM.middleMcp], points[17]),
  };
}

/**
 * Which hand, from the thumb tip's side of the wrist→middle-MCP axis, for a
 * palm-DOWN hand seen from above in an unmirrored picture: thumb on the
 * left of the axis (looking along it) = right hand. Not MediaPipe's own
 * label (that one is for palms; `normalizeHandedness` in landmarks.ts).
 * `null` when the thumb lies on the axis.
 */
export function thumbSideHand(points: readonly Pt[]): "left" | "right" | null {
  const o = points[LM.wrist];
  const a = points[LM.middleMcp];
  const t = points[LM.thumbTip];
  const cross = (a.x - o.x) * (t.y - o.y) - (a.y - o.y) * (t.x - o.x);
  if (cross === 0 || !Number.isFinite(cross)) return null;
  return cross < 0 ? "right" : "left";
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Bounding box of the given landmarks (all 21 by default). */
export function boundingBox(
  points: readonly Pt[],
  indices?: readonly number[],
): Rect {
  const chosen = indices ? indices.map((i) => points[i]) : points;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of chosen) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * How far `inner` sticks out of `outer` on each side (0 when inside), in the
 * points' own units.
 */
export function overflow(
  inner: Rect,
  outer: Rect,
): {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
} {
  return {
    left: Math.max(0, outer.x - inner.x),
    right: Math.max(0, inner.x + inner.width - (outer.x + outer.width)),
    top: Math.max(0, outer.y - inner.y),
    bottom: Math.max(0, inner.y + inner.height - (outer.y + outer.height)),
  };
}

/**
 * The largest movement of any landmark between two readings, over the
 * frame's diagonal (the scan's steadiness measure, as a fraction). `null`
 * when either reading is missing or the diagonal is zero.
 */
export function movementFraction(
  previous: readonly Pt[] | null,
  current: readonly Pt[] | null,
  frame: { readonly width: number; readonly height: number },
): number | null {
  if (!previous || !current || previous.length !== current.length) return null;
  const diagonal = Math.hypot(frame.width, frame.height);
  if (!(diagonal > 0) || current.length === 0) return null;
  let most = 0;
  for (let i = 0; i < current.length; i++)
    most = Math.max(most, dist(previous[i], current[i]));
  return most / diagonal;
}

/**
 * MediaPipe's relative depth at the wrist minus the mean at the four finger
 * MCPs (5, 9, 13, 17): recorded to see later whether a lifted hand shows.
 */
export function zWristMinusMcp(z: readonly number[] | null): number | null {
  if (!z || z.length !== LANDMARK_COUNT) return null;
  const mcp = (z[5] + z[9] + z[13] + z[17]) / 4;
  const v = z[0] - mcp;
  return Number.isFinite(v) ? v : null;
}

/** All the posture figures the record keeps, from one set of points. */
export function postureOf(
  points: readonly Pt[],
  z: readonly number[] | null = null,
) {
  return {
    fingerStraightness: fingerStraightness(points),
    minFingerStraightness: minFingerStraightness(points),
    fingertipGaps: fingertipGaps(points),
    handAxisDeg: handAxisDeg(points),
    wristAngles: wristAngles(points),
    thumbSideHand: thumbSideHand(points),
    zWristMinusMcp: zWristMinusMcp(z),
  };
}

export type Posture = ReturnType<typeof postureOf>;
