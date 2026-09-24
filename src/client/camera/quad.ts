/**
 * Pure geometry for the live camera capture overlay
 * (docs/design/camera-capture-2026-09-25/README.md): the sheet-quad
 * skew/size checks that feed the cue line, plus the letterboxing math that
 * maps a `<video>` element's actual rendered rectangle inside its
 * container so the marker-bracket overlay lines up with it. No DOM/Canvas
 * dependency — everything here takes plain numbers/points.
 */
import { CAMERA_CONSTANTS } from "./constants";
import { SHEET } from "../../lib/contracts/measurement";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Four corners of the tracked sheet quad, clockwise from top-left. */
export interface Quad {
  readonly topLeft: Point;
  readonly topRight: Point;
  readonly bottomRight: Point;
  readonly bottomLeft: Point;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Interior angle at `corner`, given its two neighbours, in degrees. */
function angleAtDeg(prev: Point, corner: Point, next: Point): number {
  const v1 = { x: prev.x - corner.x, y: prev.y - corner.y };
  const v2 = { x: next.x - corner.x, y: next.y - corner.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);
  if (mag1 === 0 || mag2 === 0) return 90; // degenerate — don't report a false skew
  const cos = Math.min(1, Math.max(-1, dot / (mag1 * mag2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export interface QuadSkew {
  /** top-edge length ÷ bottom-edge length. */
  readonly topBottomRatio: number;
  /** left-edge length ÷ right-edge length. */
  readonly leftRightRatio: number;
  /** Largest deviation from 90° across the four corners. */
  readonly maxAngleDeviationDeg: number;
}

/** Edge-length ratios and corner-angle deviation for a detected sheet quad. */
export function computeQuadSkew(quad: Quad): QuadSkew {
  const { topLeft, topRight, bottomRight, bottomLeft } = quad;
  const topLen = dist(topLeft, topRight);
  const bottomLen = dist(bottomLeft, bottomRight);
  const leftLen = dist(topLeft, bottomLeft);
  const rightLen = dist(topRight, bottomRight);

  const angles = [
    angleAtDeg(bottomLeft, topLeft, topRight),
    angleAtDeg(topLeft, topRight, bottomRight),
    angleAtDeg(topRight, bottomRight, bottomLeft),
    angleAtDeg(bottomRight, bottomLeft, topLeft),
  ];
  const maxAngleDeviationDeg = Math.max(...angles.map((a) => Math.abs(a - 90)));

  return {
    topBottomRatio: bottomLen === 0 ? Infinity : topLen / bottomLen,
    leftRightRatio: rightLen === 0 ? Infinity : leftLen / rightLen,
    maxAngleDeviationDeg,
  };
}

/** True when the quad is skewed enough to trigger "Hold the phone flat above the sheet". */
export function isQuadSkewed(
  skew: QuadSkew,
  thresholds: {
    minOppositeEdgeRatio: number;
    maxOppositeEdgeRatio: number;
    maxAngleDeviationDeg: number;
  } = CAMERA_CONSTANTS.skew,
): boolean {
  const { minOppositeEdgeRatio, maxOppositeEdgeRatio, maxAngleDeviationDeg } =
    thresholds;
  const ratioOut = (r: number) =>
    r < minOppositeEdgeRatio || r > maxOppositeEdgeRatio;
  return (
    ratioOut(skew.topBottomRatio) ||
    ratioOut(skew.leftRightRatio) ||
    skew.maxAngleDeviationDeg > maxAngleDeviationDeg
  );
}

/** Sheet quad's average width (mean of its top and bottom edges) as a fraction of the frame width. */
export function computeQuadWidthFraction(
  quad: Quad,
  frameWidth: number,
): number {
  if (frameWidth <= 0) {
    throw new RangeError(
      `computeQuadWidthFraction needs a positive frameWidth, got ${frameWidth}.`,
    );
  }
  const topLen = dist(quad.topLeft, quad.topRight);
  const bottomLen = dist(quad.bottomLeft, quad.bottomRight);
  return (topLen + bottomLen) / 2 / frameWidth;
}

export type QuadSizeStatus = "too-far" | "too-close" | "ok";

/** "Move closer" / "Move back a little" / neither, from the quad's width fraction. */
export function computeQuadSizeStatus(
  widthFraction: number,
  thresholds: {
    minWidthFraction: number;
    maxWidthFraction: number;
  } = CAMERA_CONSTANTS.size,
): QuadSizeStatus {
  if (widthFraction < thresholds.minWidthFraction) return "too-far";
  if (widthFraction > thresholds.maxWidthFraction) return "too-close";
  return "ok";
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The rectangle a `<video>` (or `<img>`) with `object-fit: contain` actually
 * renders into, given its container box and the media's natural size —
 * i.e. the letterboxed/pillarboxed content rect, in the container's own
 * coordinate space. Used to position the marker-bracket overlay exactly
 * over the visible video, regardless of aspect-ratio mismatch between the
 * camera's stream and the viewport.
 */
export function computeContainRect(
  containerWidth: number,
  containerHeight: number,
  mediaWidth: number,
  mediaHeight: number,
): Rect {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    mediaWidth <= 0 ||
    mediaHeight <= 0
  ) {
    throw new RangeError(
      "computeContainRect needs positive container and media dimensions.",
    );
  }
  const containerAspect = containerWidth / containerHeight;
  const mediaAspect = mediaWidth / mediaHeight;

  if (mediaAspect > containerAspect) {
    // Media is relatively wider — full width, letterboxed top/bottom.
    const width = containerWidth;
    const height = width / mediaAspect;
    return { x: 0, y: (containerHeight - height) / 2, width, height };
  }
  // Media is relatively taller (or equal) — full height, pillarboxed sides.
  const height = containerHeight;
  const width = height * mediaAspect;
  return { x: (containerWidth - width) / 2, y: 0, width, height };
}

function centroid(corners: readonly Point[]): Point {
  const sum = corners.reduce((acc, c) => ({ x: acc.x + c.x, y: acc.y + c.y }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / corners.length, y: sum.y / corners.length };
}

export interface TrackedMarker {
  readonly id: number;
  readonly corners: readonly Point[];
}

/**
 * Builds the tracked sheet quad from the live loop's detected flat-flap
 * markers, one bracket per marker centroid — `layout.ts`'s own convention
 * (`SHEET.flatMarkerIds`, clockwise from top-left) fixes which marker id is
 * which corner. Returns `null` unless all four ids 0-3 are present exactly
 * once, matching `buildMarkerCorrespondences` in src/client/photo/markers.ts.
 */
export function buildTrackedQuad(
  markers: readonly TrackedMarker[],
): Quad | null {
  const [tlId, trId, brId, blId] = SHEET.flatMarkerIds;
  const byId = new Map(markers.map((m) => [m.id, m]));
  const tl = byId.get(tlId);
  const tr = byId.get(trId);
  const br = byId.get(brId);
  const bl = byId.get(blId);
  if (!tl || !tr || !br || !bl) return null;
  return {
    topLeft: centroid(tl.corners),
    topRight: centroid(tr.corners),
    bottomRight: centroid(br.corners),
    bottomLeft: centroid(bl.corners),
  };
}

/** Maps a point in media-native pixel space into the container's coordinate space, given the contain rect. */
export function mapMediaPointToContainer(
  point: Point,
  containRect: Rect,
  mediaWidth: number,
  mediaHeight: number,
): Point {
  return {
    x: containRect.x + (point.x / mediaWidth) * containRect.width,
    y: containRect.y + (point.y / mediaHeight) * containRect.height,
  };
}
