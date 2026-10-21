/**
 * A paper frame a person places by hand (V3.2 F2, candidate, 未拍板): the pure
 * geometry behind "手動調整邊框" on the easy scan's failure sheet.
 *
 * R5 (research, 2026-10-21, simulated): four independent corner errors of
 * sigma px on a 1024x1920 photo, paper at 72 % of its width, give a hand-length
 * RMS error of about 0.22 x sigma mm. The homography is therefore the SAME one
 * the detector's corners go through (`buildPaperHomography`); nothing here
 * builds another.
 *
 * What is here:
 *
 * 1. `centredPaperFrame` / `defaultAdjustFrame`: the frame the screen opens
 *    with. The detector's corners where it found them; a corner it could not
 *    find, when three were found, starts visibly INSIDE the sheet: the
 *    parallelogram's fourth corner pulled toward the opposite corner by
 *    `guessInsetFraction` of that diagonal. It is never offered on the
 *    parallelogram itself (R5 E2: biased by 5-8 mm under tilt, simulated;
 *    DESIGN-v3.2 F2: no parallelogram completion), it is marked not detected,
 *    and the screen counts it placed only once it is worked out from its
 *    edges or moved at least `guessMinMoveFraction` of the photo's diagonal
 *    (`paperAdjustState.ts`), so a 1 px nudge does not accept it. Otherwise a
 *    centred portrait sheet 72 % of the photo's width.
 * 2. `solveHiddenCorner`: a corner under the hand, from points the person
 *    marks on its two neighbouring edges where they are visible. Each edge is
 *    the line through its visible neighbouring corner and the marked points;
 *    the corner is where the two lines meet. Refused, with a reason, for
 *    near-parallel edges, a meeting point far outside the photo, or edges that
 *    are mostly hidden (R5 E2c: past 70 % hidden the error grows fast).
 * 3. `checkManualQuad`: obvious mistakes only (crossed or concave frame, two
 *    corners on top of each other or three in a line, corners off the photo,
 *    a frame smaller than the detector's own minimum).
 *    There is deliberately NO aspect-ratio check: R5 E3 found it catches almost
 *    no bad frame (correlation with the hand-length error 0.02-0.22).
 * 4. `orientManualQuad`: labels the four points TL, TR, BR, BL with TL->TR the
 *    paper's short side, the way the detector labels its own corners, so a
 *    frame placed on a landscape sheet is not read 41 % wrong.
 *
 * Every function is pure and deterministic. No pixel of the photo is read here:
 * the person's points are the only input.
 */
import type { Point2 } from "../geometry/homography";
import { MIN_QUAD_AREA_FRACTION, PAPER_DIMENSIONS_MM } from "./detect";
import type { PaperSize } from "./detect";
import { resolveOrientation } from "./orientation";
import {
  isConvexQuad,
  orderQuadCorners,
  polygonArea,
  totalLeastSquaresLine,
  intersectLines,
  lineFromTwoPoints,
  type NormalLine,
} from "./quad-math";

export type Quad4 = readonly [Point2, Point2, Point2, Point2];

export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

/** The named limits of a placed frame. Numbers, so a review can argue with them. */
export const MANUAL_QUAD_LIMITS = {
  /** The centred starting frame's width, as a share of the photo's width (R5's 72 % scene). */
  defaultWidthFraction: 0.72,
  /** ...and at most this share of the photo's height, for a photo that is not tall enough. */
  defaultMaxHeightFraction: 0.9,
  /** A frame must cover at least this share of the photo: the detector's own floor. */
  minAreaFraction: MIN_QUAD_AREA_FRACTION,
  /**
   * How far outside the photo a corner may lie, as a share of the photo's
   * width (x) or height (y): a sheet corner just out of frame. A dragged
   * corner may go this far too (F10, R6 F2: clamping it to the photo's edge
   * widened the palm by 1.0 mm with the corner 2 % out, simulated), as may a
   * corner worked out from two edges; no further.
   */
  maxOutsideFraction: 0.1,
  /** Two edges meeting at less than this many degrees are too close to parallel to say where. */
  minEdgeAngleDeg: 20,
  /**
   * The visible part of each edge (from its visible corner to the farthest
   * marked point) must be at least this share of the edge up to the worked-out
   * corner. R5 E2c (simulated, pitch 8 deg, sigma 3 px): 70 % hidden gives a
   * hand-length RMS of 1.42 mm, 80 % gives 2.15 mm, 90 % gives 4.50 mm.
   */
  minVisibleEdgeFraction: 0.3,
  /** A marked point closer than this share of the photo's diagonal to its edge's corner says nothing about the edge's direction. */
  minPointSpacingFraction: 0.03,
  /**
   * Two corners closer than this share of the photo's diagonal are taken to be
   * one (a frame with a corner dragged onto another's place): the homography
   * cannot be built from it. 0.02 of a 1024x1920 photo is 44 px, about 12 mm
   * on a sheet 72 % of the photo's width (simulated); a real sheet's corners
   * are far further apart than that, given `minAreaFraction`.
   */
  minCornerSpacingFraction: 0.02,
  /**
   * Every interior angle must be at least this many degrees (and at most 180
   * minus it): an angle near 0 or 180 is three corners in a line, which
   * leaves the homography singular. A sheet seen even under strong tilt keeps
   * its corners far from that; this only catches a frame that is not a
   * quadrilateral.
   */
  minCornerAngleDeg: 10,
  /**
   * The corner the detector did not find, when it found the other three,
   * starts this share of the way from the parallelogram's fourth corner back
   * toward the opposite corner: visibly off the sheet's corner, so it must
   * really be dragged there (or worked out from its edges).
   */
  guessInsetFraction: 0.25,
  /**
   * ...and it counts as placed by a drag or arrow keys only once it is at
   * least this share of the photo's diagonal from where it started (0.03 of a
   * 1024x1920 photo is 65 px; the inset start is about 5 times that from the
   * parallelogram corner on R5's scene, simulated). Working it out from its
   * edges places it whatever the distance.
   */
  guessMinMoveFraction: 0.03,
} as const;

/** The corner order every paper quad uses: 0 = TL, 1 = TR, 2 = BR, 3 = BL. */
export const CORNER_INDICES = [0, 1, 2, 3] as const;
export type CornerIndex = (typeof CORNER_INDICES)[number];

/** The two corners next to `index` (the ends of its two edges), previous first. */
export function neighbourCorners(
  index: CornerIndex,
): readonly [CornerIndex, CornerIndex] {
  return [((index + 3) % 4) as CornerIndex, ((index + 1) % 4) as CornerIndex];
}

/**
 * A portrait sheet of `paperSize`, centred in the photo, 72 % of its width
 * (smaller when the photo is not tall enough for that).
 */
export function centredPaperFrame(
  image: FrameSize,
  paperSize: PaperSize,
): Quad4 {
  if (!(image.width > 0) || !(image.height > 0)) {
    throw new RangeError("centredPaperFrame needs a positive photo size.");
  }
  const { shortMm, longMm } = PAPER_DIMENSIONS_MM[paperSize];
  const aspect = longMm / shortMm;
  let width = image.width * MANUAL_QUAD_LIMITS.defaultWidthFraction;
  let height = width * aspect;
  const maxHeight = image.height * MANUAL_QUAD_LIMITS.defaultMaxHeightFraction;
  if (height > maxHeight) {
    height = maxHeight;
    width = height / aspect;
  }
  const x0 = (image.width - width) / 2;
  const y0 = (image.height - height) / 2;
  return [
    { x: x0, y: y0 },
    { x: x0 + width, y: y0 },
    { x: x0 + width, y: y0 + height },
    { x: x0, y: y0 + height },
  ];
}

export interface DefaultAdjustFrame {
  readonly corners: Quad4;
  /** Which corners are the detector's own (true) and which only a starting guess (false). */
  readonly detected: readonly [boolean, boolean, boolean, boolean];
  /**
   * Where the frame came from, for the record and for the words on screen.
   * `guess` (F10): the detector's rough quad around the bright region
   * (`guessCorners`), with any corner it did find in place of the rough one.
   */
  readonly from: "detected" | "partial" | "guess" | "centred";
}

/**
 * The frame the adjustment screen opens with, in the photo's pixels (F10,
 * Kirby's second phone test 2026-10-21/22: always a best guess, never the
 * centred sheet when anything better is known). In order:
 *
 * 1. `corners` (all four found);
 * 2. `partialCorners` when three of them were found (the fourth a start
 *    inside the sheet, a guess);
 * 3. `guessCorners`, the detector's rough quad around the bright region, with
 *    each corner it did find (`partialCorners`) in place of the rough one;
 * 4. the centred sheet.
 *
 * A start that would itself fail `checkManualQuad` falls through to the next.
 */
export function defaultAdjustFrame(input: {
  readonly corners?: Quad4 | null;
  readonly partialCorners?: readonly (Point2 | null)[] | null;
  /** F10: the detector's rough quad on a failure (`paperGuessCorners`). */
  readonly guessCorners?: Quad4 | null;
  readonly image: FrameSize;
  readonly paperSize: PaperSize;
}): DefaultAdjustFrame {
  const centred: DefaultAdjustFrame = {
    corners: centredPaperFrame(input.image, input.paperSize),
    detected: [false, false, false, false],
    from: "centred",
  };
  if (input.corners && checkManualQuad(input.corners, input.image).ok) {
    return {
      corners: copyQuad(input.corners),
      detected: [true, true, true, true],
      from: "detected",
    };
  }
  const partial = input.partialCorners;
  if (partial && partial.length === 4) {
    const found = partial.map((p) => p !== null && isFinitePoint(p));
    const count = found.filter(Boolean).length;
    if (count === 4) {
      const quad = partial as unknown as Quad4;
      if (checkManualQuad(quad, input.image).ok)
        return {
          corners: copyQuad(quad),
          detected: [true, true, true, true],
          from: "detected",
        };
    }
    if (count === 3) {
      const missing = found.indexOf(false) as CornerIndex;
      const [prev, next] = neighbourCorners(missing);
      const opposite = ((missing + 2) % 4) as CornerIndex;
      const a = partial[prev]!;
      const b = partial[next]!;
      const o = partial[opposite]!;
      // The parallelogram's corner is only the direction: the start is pulled
      // inside the sheet, off that biased point (see the module comment).
      const t = 1 - MANUAL_QUAD_LIMITS.guessInsetFraction;
      const guess = {
        x: o.x + (a.x + b.x - 2 * o.x) * t,
        y: o.y + (a.y + b.y - 2 * o.y) * t,
      };
      const corners = CORNER_INDICES.map((i) =>
        i === missing ? guess : { x: partial[i]!.x, y: partial[i]!.y },
      ) as unknown as Quad4;
      if (checkManualQuad(corners, input.image).ok)
        return {
          corners,
          detected: CORNER_INDICES.map((i) => i !== missing) as unknown as [
            boolean,
            boolean,
            boolean,
            boolean,
          ],
          from: "partial",
        };
    }
  }
  const guess = input.guessCorners;
  if (guess && guess.length === 4 && guess.every(isFinitePoint)) {
    const found =
      partial && partial.length === 4
        ? partial.map((p) => p !== null && isFinitePoint(p))
        : [false, false, false, false];
    const merged = CORNER_INDICES.map((i) =>
      found[i] ? { x: partial![i]!.x, y: partial![i]!.y } : { ...guess[i] },
    ) as unknown as Quad4;
    if (found.some(Boolean) && checkManualQuad(merged, input.image).ok)
      return {
        corners: merged,
        detected: found as unknown as [boolean, boolean, boolean, boolean],
        from: "guess",
      };
    if (checkManualQuad(guess, input.image).ok)
      return {
        corners: copyQuad(guess),
        detected: [false, false, false, false],
        from: "guess",
      };
  }
  return centred;
}

// ── Checks ────────────────────────────────────────────────────────────────

export type ManualQuadProblem =
  | "not_finite"
  | "self_intersecting"
  | "not_convex"
  /** Two corners on one point, or three in a line: not a quadrilateral. */
  | "degenerate"
  | "outside_image"
  | "too_small";

export type ManualQuadCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly problem: ManualQuadProblem };

/** `true` when segments ab and cd cross at a point inside both (touching ends do not count). */
function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
function orient(o: Point2, a: Point2, b: Point2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function isFinitePoint(p: Point2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Whether a placed frame is usable: four finite points, not crossed, convex,
 * no two corners closer than `minCornerSpacingFraction` of the diagonal and no
 * interior angle within `minCornerAngleDeg` of 0 or 180 (`degenerate`),
 * every corner on the photo or at most `maxOutsideFraction` beyond it, and at
 * least `minAreaFraction` of the photo. The order may be either way round;
 * `orientManualQuad` labels it afterwards. No aspect-ratio check (see the
 * module comment).
 */
export function checkManualQuad(
  corners: Quad4,
  image: FrameSize,
): ManualQuadCheck {
  if (!corners.every(isFinitePoint))
    return { ok: false, problem: "not_finite" };
  if (
    segmentsCross(corners[0], corners[1], corners[2], corners[3]) ||
    segmentsCross(corners[1], corners[2], corners[3], corners[0])
  )
    return { ok: false, problem: "self_intersecting" };
  if (!isConvexQuad(corners)) return { ok: false, problem: "not_convex" };
  if (isDegenerateQuad(corners, image))
    return { ok: false, problem: "degenerate" };
  if (!corners.every((p) => withinImage(p, image)))
    return { ok: false, problem: "outside_image" };
  if (
    polygonArea(corners) <
    MANUAL_QUAD_LIMITS.minAreaFraction * image.width * image.height
  )
    return { ok: false, problem: "too_small" };
  return { ok: true };
}

/**
 * Two corners (nearly) on one point, or a corner whose two edges (nearly) lie
 * on one line. `isConvexQuad` skips a vertex whose cross product is 0 and the
 * crossing test ignores touching ends, so without this a triangle with a
 * doubled corner passes and the homography throws later.
 */
function isDegenerateQuad(corners: Quad4, image: FrameSize): boolean {
  const minSpacing =
    Math.hypot(image.width, image.height) *
    MANUAL_QUAD_LIMITS.minCornerSpacingFraction;
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++)
      if (
        Math.hypot(corners[i].x - corners[j].x, corners[i].y - corners[j].y) <
        minSpacing
      )
        return true;
  const minSin = Math.sin(
    (MANUAL_QUAD_LIMITS.minCornerAngleDeg * Math.PI) / 180,
  );
  for (let i = 0; i < 4; i++) {
    const p = corners[(i + 3) % 4];
    const c = corners[i];
    const n = corners[(i + 1) % 4];
    const lengths =
      Math.hypot(p.x - c.x, p.y - c.y) * Math.hypot(n.x - c.x, n.y - c.y);
    // |sin| of the angle at c: 0 for a straight line or a folded-back edge.
    if (Math.abs(orient(c, p, n)) < minSin * lengths) return true;
  }
  return false;
}

/** On the photo, or no more than `maxOutsideFraction` of its size beyond an edge. */
export function withinImage(p: Point2, image: FrameSize): boolean {
  const mx = image.width * MANUAL_QUAD_LIMITS.maxOutsideFraction;
  const my = image.height * MANUAL_QUAD_LIMITS.maxOutsideFraction;
  return (
    p.x >= -mx &&
    p.x <= image.width + mx &&
    p.y >= -my &&
    p.y <= image.height + my
  );
}

// ── A hidden corner from its two edges ────────────────────────────────────

export type HiddenCornerProblem =
  /** Fewer than one usable marked point on an edge, or a point on its corner. */
  | "need_points"
  /** The two edges are too close to parallel to meet at a trustworthy point. */
  | "parallel"
  /** The edges meet on the wrong side of the marked points (a point is past the corner). */
  | "wrong_side"
  /** Too little of an edge is visible for its line to be trusted out to the corner. */
  | "too_hidden"
  /** The edges meet too far outside the photo. */
  | "outside_image";

export type HiddenCornerResult =
  | {
      readonly ok: true;
      readonly corner: Point2;
      /** The smaller of the two edges' visible shares, 0-1. */
      readonly visibleFraction: number;
      /** The angle at which the two edges meet, degrees (0-90). */
      readonly angleDeg: number;
    }
  | { readonly ok: false; readonly problem: HiddenCornerProblem };

export interface EdgeEvidence {
  /** The visible corner at the far end of this edge. */
  readonly from: Point2;
  /** One or more points the person marked where this edge is visible. */
  readonly points: readonly Point2[];
}

interface EdgeLine {
  readonly line: NormalLine;
  /** Unit direction from `from` toward the marked points. */
  readonly dir: Point2;
  /** How far along `dir` the farthest marked point is, px. */
  readonly reach: number;
}

function edgeLine(edge: EdgeEvidence, minSpacing: number): EdgeLine | null {
  const points = edge.points.filter(
    (p) =>
      isFinitePoint(p) &&
      Math.hypot(p.x - edge.from.x, p.y - edge.from.y) >= minSpacing,
  );
  if (points.length === 0 || !isFinitePoint(edge.from)) return null;
  // One point: the line through it and the corner. More: the total-least-
  // squares line through all of them and the corner.
  const line =
    points.length === 1
      ? lineFromTwoPoints(edge.from, points[0])
      : totalLeastSquaresLine([edge.from, ...points]);
  if (!line) return null;
  // The line's direction, pointed from the corner toward the marked points.
  let dir = { x: line.ny, y: -line.nx };
  const far = points.reduce((best, p) =>
    Math.hypot(p.x - edge.from.x, p.y - edge.from.y) >
    Math.hypot(best.x - edge.from.x, best.y - edge.from.y)
      ? p
      : best,
  );
  if ((far.x - edge.from.x) * dir.x + (far.y - edge.from.y) * dir.y < 0)
    dir = { x: -dir.x, y: -dir.y };
  const reach = Math.max(
    ...points.map(
      (p) => (p.x - edge.from.x) * dir.x + (p.y - edge.from.y) * dir.y,
    ),
  );
  return { line, dir, reach };
}

/**
 * Where a hidden corner is, from its two edges (each: the visible corner at its
 * other end and the points marked on it). Refuses rather than guesses: see
 * `HiddenCornerProblem`.
 */
export function solveHiddenCorner(input: {
  readonly edgeA: EdgeEvidence;
  readonly edgeB: EdgeEvidence;
  readonly image: FrameSize;
}): HiddenCornerResult {
  const minSpacing =
    Math.hypot(input.image.width, input.image.height) *
    MANUAL_QUAD_LIMITS.minPointSpacingFraction;
  const a = edgeLine(input.edgeA, minSpacing);
  const b = edgeLine(input.edgeB, minSpacing);
  if (!a || !b) return { ok: false, problem: "need_points" };
  const cos = Math.abs(a.dir.x * b.dir.x + a.dir.y * b.dir.y);
  const angleDeg = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
  if (angleDeg < MANUAL_QUAD_LIMITS.minEdgeAngleDeg)
    return { ok: false, problem: "parallel" };
  const corner = intersectLines(a.line, b.line);
  if (!corner) return { ok: false, problem: "parallel" };
  const along = (e: EdgeLine, from: Point2) =>
    (corner.x - from.x) * e.dir.x + (corner.y - from.y) * e.dir.y;
  const lengthA = along(a, input.edgeA.from);
  const lengthB = along(b, input.edgeB.from);
  // The corner must lie beyond every marked point, seen from its edge's corner.
  if (lengthA <= a.reach || lengthB <= b.reach)
    return { ok: false, problem: "wrong_side" };
  const visibleFraction = Math.min(a.reach / lengthA, b.reach / lengthB);
  if (visibleFraction < MANUAL_QUAD_LIMITS.minVisibleEdgeFraction)
    return { ok: false, problem: "too_hidden" };
  if (!withinImage(corner, input.image))
    return { ok: false, problem: "outside_image" };
  return { ok: true, corner, visibleFraction, angleDeg };
}

// ── Labelling ─────────────────────────────────────────────────────────────

/**
 * The placed frame labelled the way the homography expects: TL, TR, BR, BL in
 * the photo, with TL->TR the paper's SHORT side. The order is the detector's
 * (`orderQuadCorners`: round the centre, starting nearest the photo's top
 * left), and which pair of sides is short is decided as the detector decides
 * it (`resolveOrientation`, at the same focal length). It labels; it never
 * rejects (no aspect check, see the module comment), and never throws: a
 * frame `checkManualQuad` refuses is only ordered. `image` is the analysed
 * photo, whose centre is the principal point.
 */
export function orientManualQuad(
  corners: Quad4,
  paperSize: PaperSize,
  image: FrameSize,
  focalPx: number,
): Quad4 {
  const ordered = orderQuadCorners([
    corners[0],
    corners[1],
    corners[2],
    corners[3],
  ]);
  // A frame that fails the checks has no orientation to find (a doubled
  // corner or three in a line leaves the pose singular, and it throws):
  // it is returned in order, for `evaluateManualPaperCalibration` to turn
  // back with a reason.
  if (!checkManualQuad(ordered, image).ok) return ordered;
  const { shortMm, longMm } = PAPER_DIMENSIONS_MM[paperSize];
  const orientation = resolveOrientation(
    ordered,
    shortMm,
    longMm,
    { x: image.width / 2, y: image.height / 2 },
    focalPx,
  );
  if (orientation?.rotateBy1)
    return [ordered[1], ordered[2], ordered[3], ordered[0]];
  return ordered;
}

// ── Small helpers ─────────────────────────────────────────────────────────

function copyQuad(q: Quad4): Quad4 {
  return [
    { x: q[0].x, y: q[0].y },
    { x: q[1].x, y: q[1].y },
    { x: q[2].x, y: q[2].y },
    { x: q[3].x, y: q[3].y },
  ];
}

/** A quad moved from one frame to another by a plain shift (the decoded photo to the analysed crop). */
export function shiftQuad(q: Quad4, dx: number, dy: number): Quad4 {
  return [
    { x: q[0].x + dx, y: q[0].y + dy },
    { x: q[1].x + dx, y: q[1].y + dy },
    { x: q[2].x + dx, y: q[2].y + dy },
    { x: q[3].x + dx, y: q[3].y + dy },
  ];
}

/** Each corner's distance from its counterpart, px (the accuracy record's only numbers). */
export function cornerDistancesPx(
  a: Quad4,
  b: Quad4,
): readonly [number, number, number, number] {
  return [
    Math.hypot(a[0].x - b[0].x, a[0].y - b[0].y),
    Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y),
    Math.hypot(a[2].x - b[2].x, a[2].y - b[2].y),
    Math.hypot(a[3].x - b[3].x, a[3].y - b[3].y),
  ];
}
