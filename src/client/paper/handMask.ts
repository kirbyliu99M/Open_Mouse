/**
 * V3.2 F19 (candidate, 未拍板; Kirby 2026-10-25): where the hand and the arm
 * lie in a frame, from MediaPipe's 21 hand landmarks, so the paper detector
 * can leave out what they cover.
 *
 * Measured on the S25 and a second person's iPhone (2026-10-23/24, 實測):
 * with the arm over the sheet's bottom edge the worst side's residual rose to
 * 8.343 mm and 3.805 mm (flat: 0.42-0.74), and a sheet cut in two by the arm
 * was not found (`region_split`). F16 (模擬) showed tilt and ordinary lens
 * distortion do not raise the residual, so the likely cause is boundary
 * points of the hand, the arm or their shadow taken for the sheet's edge.
 *
 * The mask is two convex polygons, each widened by a margin:
 * - the hand: the convex hull of the 21 landmarks (joint centres, so the skin
 *   outline and the fingers' thickness are what the margin is for);
 * - the arm: a band from the wrist (0), away from the middle knuckle (9),
 *   out past the frame's edge.
 * Sizes are in palm widths (index knuckle 5 to little-finger knuckle 17), so
 * the mask scales with the hand in the frame and needs no mm.
 *
 * "Widened by a margin" is the offset of every edge's half-plane, not a
 * rounded Minkowski sum: the corners stick out a little further than the
 * margin (by at most margin × (1/sin(θ/2) − 1) at a corner of angle θ). A
 * mask only ever leaves points out, so a slightly larger one is the safe
 * side, and the test is one dot product per edge.
 *
 * Pure; no pixels are read. With no landmarks the detector builds no mask and
 * nothing it does changes.
 */
import type { Point2 } from "../geometry/homography";
import { convexHull } from "./quad-math";

/**
 * The mask's named sizes (candidate 未拍板), in palm widths (5 to 17).
 *
 * - `marginPalmWidths` 0.35: the landmarks are joint centres, about 8-10 mm
 *   inside the skin; a finger is about 16-20 mm thick; an arm's soft shadow
 *   on the sheet adds about as much again. A palm width (joint centres) is
 *   about 65-80 mm, so 0.35 of it is about 23-28 mm (模擬 estimate, from
 *   typical adult sizes, not measured on these photos).
 * - `armHalfWidthPalmWidths` 0.6: a forearm near the wrist is about as wide
 *   as the palm's skin outline (palm width + about 20 mm) and widens towards
 *   the elbow; half of 1.2 palm widths, plus the margin, covers a forearm up
 *   to about 1.9 palm widths across (about 125-150 mm).
 * - `armLengthFrameDiagonals` 1.0: the band runs past the frame's edge from
 *   anywhere in the frame.
 */
export const HAND_MASK = {
  marginPalmWidths: 0.35,
  armHalfWidthPalmWidths: 0.6,
  armLengthFrameDiagonals: 1,
} as const;

/** MediaPipe landmark indices the mask reads. */
const WRIST = 0;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;

/** A convex polygon whose edges are stored as inward unit normals. */
interface ConvexRegion {
  readonly vertices: readonly Point2[];
  /** Per edge: inward unit normal (nx, ny) and offset c, inside where nx·x + ny·y − c ≥ 0. */
  readonly edges: readonly {
    readonly nx: number;
    readonly ny: number;
    readonly c: number;
  }[];
}

export interface HandMask {
  /** The hand's convex hull (landmark joint centres). */
  readonly hand: readonly Point2[];
  /** The arm band's four corners: two at the wrist, two past the frame. */
  readonly arm: readonly [Point2, Point2, Point2, Point2];
  /** How far beyond either polygon still counts as covered, in px. */
  readonly marginPx: number;
  /** Internal: both polygons as half-planes. */
  readonly regions: readonly ConvexRegion[];
}

function isFinitePoint(p: Point2 | undefined): p is Point2 {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** A convex polygon (any winding, at least 3 distinct vertices) as inward half-planes; `null` when degenerate. */
function toConvexRegion(vertices: readonly Point2[]): ConvexRegion | null {
  if (vertices.length < 3) return null;
  let area2 = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    area2 += a.x * b.y - b.x * a.y;
  }
  if (!(Math.abs(area2) > 1e-9)) return null;
  const winding = area2 > 0 ? 1 : -1;
  const edges: { nx: number; ny: number; c: number }[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    // Inward normal: for a counter-clockwise (positive area) polygon in these
    // coordinates, (-ey, ex) points inside.
    const nx = (winding * -ey) / len;
    const ny = (winding * ex) / len;
    edges.push({ nx, ny, c: nx * a.x + ny * a.y });
  }
  return edges.length >= 3 ? { vertices, edges } : null;
}

/**
 * The corners of `region` widened by `margin`: where each two neighbouring
 * offset edges meet. A pair that is (nearly) parallel keeps the original
 * vertex pushed out along the edge normal.
 */
function widenedVertices(region: ConvexRegion, margin: number): Point2[] {
  const out: Point2[] = [];
  const n = region.edges.length;
  for (let i = 0; i < n; i++) {
    const a = region.edges[(i + n - 1) % n]!;
    const b = region.edges[i]!;
    const ca = a.c - margin;
    const cb = b.c - margin;
    const det = a.nx * b.ny - b.nx * a.ny;
    if (Math.abs(det) < 1e-9) continue;
    out.push({
      x: (ca * b.ny - cb * a.ny) / det,
      y: (a.nx * cb - b.nx * ca) / det,
    });
  }
  return out;
}

/** Whether `p` lies inside `region` widened by `margin` px (every edge's half-plane offset outward). */
function inWidened(p: Point2, region: ConvexRegion, margin: number): boolean {
  for (const e of region.edges) {
    if (e.nx * p.x + e.ny * p.y - e.c < -margin) return false;
  }
  return true;
}

/**
 * The hand-and-arm mask for one frame, from the 21 landmarks in that
 * frame's px; `null` without 21 finite landmarks or with a palm too small to
 * size anything (under 1 px). `frameWidth`/`frameHeight` only size the arm's
 * length. Pure.
 */
export function buildHandMask(
  landmarks: readonly Point2[] | null | undefined,
  frameWidth: number,
  frameHeight: number,
  limits: {
    readonly marginPalmWidths: number;
    readonly armHalfWidthPalmWidths: number;
    readonly armLengthFrameDiagonals: number;
  } = HAND_MASK,
): HandMask | null {
  if (!landmarks || landmarks.length < 21) return null;
  const pts = landmarks.slice(0, 21);
  if (!pts.every(isFinitePoint)) return null;
  const palmWidth = Math.hypot(
    pts[INDEX_MCP]!.x - pts[PINKY_MCP]!.x,
    pts[INDEX_MCP]!.y - pts[PINKY_MCP]!.y,
  );
  if (!(palmWidth >= 1)) return null;
  const wrist = pts[WRIST]!;
  const middle = pts[MIDDLE_MCP]!;
  const dx = wrist.x - middle.x;
  const dy = wrist.y - middle.y;
  const len = Math.hypot(dx, dy);
  if (!(len >= 1e-6)) return null;
  const ux = dx / len;
  const uy = dy / len;
  const half = limits.armHalfWidthPalmWidths * palmWidth;
  const reach =
    limits.armLengthFrameDiagonals * Math.hypot(frameWidth, frameHeight);
  const px = -uy;
  const py = ux;
  const arm: [Point2, Point2, Point2, Point2] = [
    { x: wrist.x + px * half, y: wrist.y + py * half },
    { x: wrist.x + px * half + ux * reach, y: wrist.y + py * half + uy * reach },
    { x: wrist.x - px * half + ux * reach, y: wrist.y - py * half + uy * reach },
    { x: wrist.x - px * half, y: wrist.y - py * half },
  ];
  const hand = convexHull(pts);
  const regions: ConvexRegion[] = [];
  const handRegion = toConvexRegion(hand);
  if (handRegion) regions.push(handRegion);
  const armRegion = toConvexRegion(arm);
  if (armRegion) regions.push(armRegion);
  if (regions.length === 0) return null;
  return {
    hand,
    arm,
    marginPx: limits.marginPalmWidths * palmWidth,
    regions,
  };
}

/** Whether `p` is covered by the hand or the arm, within the mask's margin. Pure. */
export function isCoveredByHand(p: Point2, mask: HandMask): boolean {
  for (const region of mask.regions) {
    if (inWidened(p, region, mask.marginPx)) return true;
  }
  return false;
}

/** `points` without the ones the hand or the arm cover, and how many were left out. Pure. */
export function excludeCoveredPoints(
  points: readonly Point2[],
  mask: HandMask,
): { readonly kept: Point2[]; readonly excluded: number } {
  const kept: Point2[] = [];
  for (const p of points) if (!isCoveredByHand(p, mask)) kept.push(p);
  return { kept, excluded: points.length - kept.length };
}

/**
 * The mask as pixels of a `width` × `height` frame: 1 where the pixel's
 * centre is covered (`isCoveredByHand`), 0 elsewhere. Only the bounding box
 * of the widened polygons is visited. Pure.
 */
export function rasterizeHandMask(
  mask: HandMask,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (const region of mask.regions) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const v of widenedVertices(region, mask.marginPx)) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
    if (!Number.isFinite(minX + minY + maxX + maxY)) continue;
    const x0 = Math.max(0, Math.floor(minX) - 1);
    const y0 = Math.max(0, Math.floor(minY) - 1);
    const x1 = Math.min(width - 1, Math.ceil(maxX) + 1);
    const y1 = Math.min(height - 1, Math.ceil(maxY) + 1);
    for (let y = y0; y <= y1; y++) {
      const row = y * width;
      for (let x = x0; x <= x1; x++) {
        if (out[row + x]) continue;
        if (inWidened({ x: x + 0.5, y: y + 0.5 }, region, mask.marginPx))
          out[row + x] = 1;
      }
    }
  }
  return out;
}

/** The hand's 21 landmarks as plain points, or `null` without 21 finite ones. Pure. */
export function handLandmarksOf(
  landmarks: readonly Point2[] | null | undefined,
): Point2[] | null {
  if (!landmarks || landmarks.length < 21) return null;
  const pts = landmarks.slice(0, 21);
  if (!pts.every(isFinitePoint)) return null;
  return pts.map((p) => ({ x: p.x, y: p.y }));
}
