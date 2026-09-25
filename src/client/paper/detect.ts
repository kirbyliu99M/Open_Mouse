/**
 * Plain-paper quad detection (2026-09-25 direction change, see
 * `src/lib/contracts/measurement.ts`'s `PAPER_SIZES_MM` header): find a
 * blank A4/Letter sheet's own 4 corners in a photo, the way a document
 * scanner does — no printed markers, no bank card.
 *
 * `detectPaperQuad` is the seam a separate builder's live camera
 * viewfinder codes against (see that worktree's
 * `src/client/camera/quad-source.ts`), and what `src/client/photo/
 * pipeline.ts`'s `paper-edge` calibration path calls at full photo
 * resolution. Pure — only reads `frame.data`, never touches the DOM — and
 * deterministic (the one source of randomness, RANSAC's sampling, is
 * seeded with a fixed constant in `quad-math.ts`).
 *
 * ── Algorithm ─────────────────────────────────────────────────────────
 * 1. Grayscale + a light box blur (stabilises the threshold and the
 *    connected-component step against sensor noise).
 * 2. Otsu's method picks a global brightness threshold; a pixel also
 *    needs LOW SATURATION to count as "paper" (rejects a skin-tone hand
 *    resting on the sheet, and a colourful background, even when both are
 *    bright).
 * 3. The largest connected bright/low-saturation region is "the paper".
 *    Below 10% of the frame's area, there's no usable paper at all.
 * 4. Boundary points, at sub-pixel precision: for every row, the
 *    left/right-most transition from background into the component
 *    (linearly interpolating the blurred grayscale value across the
 *    threshold crossing); for every column, the same top/bottom. Skipped
 *    wherever the component already touches that side of the frame — a
 *    clipped edge has no real transition to find.
 * 5. A coarse quad: convex hull of all boundary points (a hand/wrist
 *    crossing one edge cuts a CONCAVE notch out of the paper region, so
 *    it never survives into the hull — the hull already approximates the
 *    true corners even under occlusion), simplified to exactly 4 vertices
 *    (Visvalingam–Whyatt), ordered TL/TR/BR/BL.
 * 6. Each boundary point is assigned to whichever of the coarse quad's 4
 *    sides it's nearest (gated by a maximum distance, which alone
 *    rejects most occluder-boundary points outright). Each side is then
 *    fit independently with RANSAC + a total-least-squares refit — this
 *    is what catches the occluder points the distance gate didn't: they
 *    don't lie on the same line as the rest of that side.
 * 7. Each corner is the intersection of its two adjacent fitted side
 *    lines, ONLY when both were genuinely fit from image evidence (never
 *    a coarse-quad fallback) — that per-corner result is `partialCorners`
 *    (`null` for a corner that couldn't be computed, e.g. because the
 *    paper touches the frame edge on one of its sides). `corners` is the
 *    same 4 points, but only when ALL 4 were found — `null` otherwise, so
 *    a caller building a homography never silently gets a guessed corner.
 *    A separate, fallback-inclusive working quad (never exposed) still
 *    backs the sanity checks below, so a paper that's mostly — but not
 *    entirely — in frame still gets a sensible `partialCorners`.
 * 8. Sanity checks (convex, area ≥ 10% of the frame, aspect plausible for
 *    `paperSize` even after perspective) — failing any of them reports no
 *    detection rather than a wrong one.
 *
 * `cornersSeen` is exactly the count of `true` in `cornersFound`
 * (TL/TR/BR/BL, both adjacent sides fit); `minSideCoverage` is the
 * smallest fraction of any side's length that had inlier points spread
 * along it (a bucketed metric, not a min/max span, so a gap hidden in the
 * middle of an otherwise well-covered side still shows up — see
 * `quad-math.ts#computeSideCoverage`); `edgeFitResidualPx` is the WORST
 * side's mean inlier distance to its fitted line (the max over sides, not
 * the average — a single curled side must not be diluted by the other
 * three, typically near-flat, sides).
 */
import type { Point2 } from "../geometry/homography";
import {
  clamp,
  computeReportingStats,
  computeSideCoverage,
  convexHull,
  fitLineRansac,
  intersectLines,
  isConvexQuad,
  lineFromTwoPoints,
  mulberry32,
  orderQuadCorners,
  polygonArea,
  simplifyToQuad,
  type NormalLine,
  RANSAC_SEED,
} from "./quad-math";
import { assumedFocalPxFromFov, resolveOrientation } from "./orientation";

export type PaperSize = "a4" | "letter";

/** Portrait mm — must match `PAPER_SIZES_MM` in the contract. Duplicated
 * here (rather than imported) so this module has zero dependency on
 * `src/lib/contracts/`, which only Claude edits; `pipeline.ts` is the one
 * place that must keep these two in sync, and a unit test asserts it. */
export const PAPER_ASPECT: Record<PaperSize, number> = {
  a4: 297 / 210,
  letter: 279.4 / 215.9,
};

/** Same numbers as the contract's `PAPER_SIZES_MM`, kept in this shape for `orientation.ts`'s two-hypothesis test. */
export const PAPER_DIMENSIONS_MM: Record<
  PaperSize,
  { readonly shortMm: number; readonly longMm: number }
> = {
  a4: { shortMm: 210, longMm: 297 },
  letter: { shortMm: 215.9, longMm: 279.4 },
};

export interface DetectPaperQuadOptions {
  /**
   * Real focal length in px for this frame (from EXIF, via
   * `src/client/geometry/exif-focal.ts`), for the orientation/aspect
   * check below. Defaults to an assumed ~70° horizontal FOV when omitted
   * — `detectPaperQuad`'s own signature is a seam another builder's live
   * camera viewfinder already codes against, so this is an ADDITIONAL
   * optional parameter, never a required one.
   */
  readonly focalPxHint?: number;
}

export interface SheetQuadDetection {
  /** The paper's 4 corners (TL, TR, BR, BL), or `null` unless all 4 sides yielded a quad. */
  readonly corners: readonly [Point2, Point2, Point2, Point2] | null;
  /** Corners whose two adjacent sides were both fitted (not a fallback). */
  readonly cornersSeen: 0 | 1 | 2 | 3 | 4;
  /** TL, TR, BR, BL — `true` where both adjacent sides were fitted with enough inliers. `cornersSeen` is exactly the count of `true` here. */
  readonly cornersFound: readonly [boolean, boolean, boolean, boolean];
  /**
   * TL, TR, BR, BL — whichever corners COULD be computed (intersection of
   * two fitted adjacent sides), `null` for the rest. Populated even when
   * `corners` itself is `null` (fewer than 4 found), so a live viewfinder
   * can draw the lock-on brackets it does have while the paper is still
   * only partly in frame.
   */
  readonly partialCorners: readonly [
    Point2 | null,
    Point2 | null,
    Point2 | null,
    Point2 | null,
  ];
  /** Smallest fraction of any side's length actually observed, 0–1. */
  readonly minSideCoverage: number;
  /** Mean inlier distance to its fitted side, in frame px, averaged over fitted sides. */
  readonly edgeFitResidualPx: number;
  /**
   * `true` once a plausible paper-sized rectangle was actually located
   * (passed the connected-component, convexity, area and rectified-aspect
   * checks) — independent of `cornersSeen`, which can still be 0–3 if
   * heavy occlusion kept any individual side from being fit. Lets a
   * caller distinguish "no paper at all" (`false`) from "found the paper,
   * but couldn't pin down every corner" (`true`, `cornersSeen < 4`) —
   * see `checkPaperFound` vs `checkPaperCornersSeen` in
   * `src/client/photo/gates.ts`.
   */
  readonly paperRegionFound: boolean;
}

const NONE: SheetQuadDetection = {
  corners: null,
  cornersSeen: 0,
  cornersFound: [false, false, false, false],
  partialCorners: [null, null, null, null],
  minSideCoverage: 0,
  edgeFitResidualPx: 0,
  paperRegionFound: false,
};

// ── Tunable constants ────────────────────────────────────────────────────

const BLUR_RADIUS_PX = 1;
/** Skin and most colourful backgrounds exceed this; blank paper doesn't. */
const MAX_PAPER_SATURATION = 0.22;
const MIN_PAPER_AREA_FRACTION = 0.1;
const MIN_QUAD_AREA_FRACTION = 0.08;
/** How far (px) a boundary point may be from the coarse side line and still be assigned to it. */
const SIDE_ASSIGNMENT_MAX_DISTANCE_FRACTION = 0.05;
const RANSAC_ITERATIONS = 50;
const RANSAC_MIN_POINTS = 6;
const COVERAGE_BINS = 40;
/**
 * `RANSAC_INLIER_THRESHOLD_PX` / `REPORTING_THRESHOLD_PX` below are
 * defined at this reference long-edge size and then SCALED by the actual
 * frame's long edge (2026-09-25 PR #59 review, B4): a fixed pixel
 * tolerance means the same physical curl reads a smaller residual at
 * higher resolution (more px per mm narrows how much of the bow a fixed
 * px window admits) — measured at ~3× the mm-per-px error between a
 * 1000px-wide and a 3000px-wide frame of the same scene before this fix.
 * `decodePhoto` caps photos at 3000px, so that's the resolution
 * `runPhotoPipeline` actually calls this at.
 */
const REFERENCE_LONG_EDGE_PX = 1000;
const RANSAC_INLIER_THRESHOLD_PX_AT_REFERENCE = 2;
/** Wider than the RANSAC fit threshold on purpose — see `computeReportingStats`'s doc comment. */
const REPORTING_THRESHOLD_PX_AT_REFERENCE = 18;

function resolutionScale(width: number, height: number): number {
  return Math.max(width, height) / REFERENCE_LONG_EDGE_PX;
}
/**
 * Orientation/aspect sanity (2026-09-25 PR #59 review, B1 + B3): a
 * rectified aspect must fall within this fraction of the paper's own
 * width/height ratio, AND the winning orientation hypothesis's
 * `orientation.ts#resolveOrientation` residual (0 = perfect rectangle at
 * the assumed/EXIF focal length) must stay under this bound. Both
 * empirically checked against a hand/wood/lightgrey/perspective sweep
 * (residual ≤ ~0.12) and against a shadow-band / touching-second-object
 * merged-region sweep (residual ≥ ~0.32, rectified aspect off by ≥30%) —
 * see this PR's review response for the exact numbers.
 */
const ASPECT_TOLERANCE_FRACTION = 0.08;
const MAX_ORIENTATION_RESIDUAL = 0.2;
/**
 * The connected component's raw pixel count must stay within this
 * fraction of the fitted quad's own polygon area. A hand/wrist sitting ON
 * the paper legitimately makes the component SMALLER than the quad (its
 * pixels are excluded from "paper" by the saturation gate — normal, down
 * to ~0.72 in testing, so `MIN` stays generous); a background that Otsu
 * can't cleanly separate from the paper merges them into one giant
 * component and makes it much LARGER than any sensible quad fit inside it
 * (~3× in testing) — `MAX` is what actually catches that.
 */
const MIN_COMPONENT_TO_QUAD_AREA_RATIO = 0.5;
const MAX_COMPONENT_TO_QUAD_AREA_RATIO = 1.3;

// ── Pixel-array helpers ──────────────────────────────────────────────────

function computeGrayscaleAndSaturation(
  data: Uint8ClampedArray,
  pixelCount: number,
): { gray: Float32Array; sat: Float32Array } {
  const gray = new Float32Array(pixelCount);
  const sat = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    sat[i] = max > 0 ? (max - min) / max : 0;
  }
  return { gray, sat };
}

/** Separable box blur, edge-clamped, O(width×height) regardless of radius. */
function boxBlur(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  if (radius <= 0) return src.slice();
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  const norm = 1 / (2 * radius + 1);

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      sum += src[rowOff + clamp(x, 0, width - 1)];
    }
    for (let x = 0; x < width; x++) {
      tmp[rowOff + x] = sum * norm;
      const addX = clamp(x + radius + 1, 0, width - 1);
      const subX = clamp(x - radius, 0, width - 1);
      sum += src[rowOff + addX] - src[rowOff + subX];
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += tmp[clamp(y, 0, height - 1) * width + x];
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum * norm;
      const addY = clamp(y + radius + 1, 0, height - 1);
      const subY = clamp(y - radius, 0, height - 1);
      sum += tmp[addY * width + x] - tmp[subY * width + x];
    }
  }
  return out;
}

/** Otsu's method: the brightness threshold maximising between-class variance. */
function computeOtsuThreshold(gray: Float32Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) {
    hist[clamp(Math.round(gray[i]), 0, 255)]++;
  }
  const total = gray.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];

  let sumB = 0;
  let weightB = 0;
  let bestVariance = -1;
  let bestThreshold = 127;
  for (let t = 0; t < 256; t++) {
    weightB += hist[t];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * hist[t];
    const meanB = sumB / weightB;
    const meanF = (sumAll - sumB) / weightF;
    const between = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (between > bestVariance) {
      bestVariance = between;
      bestThreshold = t;
    }
  }
  return bestThreshold;
}

interface Components {
  readonly labels: Int32Array;
  readonly areas: readonly number[];
  readonly touchesBorder: readonly boolean[];
}

/** 4-connected flood fill labelling every connected mask region, iterative (no recursion depth limit). */
function labelComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): Components {
  const n = width * height;
  const labels = new Int32Array(n).fill(-1);
  const areas: number[] = [];
  const touchesBorder: boolean[] = [];
  const stack = new Int32Array(n);

  let nextLabel = 0;
  for (let start = 0; start < n; start++) {
    if (mask[start] === 0 || labels[start] !== -1) continue;
    const label = nextLabel++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;
    let area = 0;
    let touches = false;
    while (sp > 0) {
      const idx = stack[--sp];
      area++;
      const x = idx % width;
      const y = (idx / width) | 0;
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        touches = true;
      }
      if (x > 0) {
        const ni = idx - 1;
        if (mask[ni] && labels[ni] === -1) {
          labels[ni] = label;
          stack[sp++] = ni;
        }
      }
      if (x < width - 1) {
        const ni = idx + 1;
        if (mask[ni] && labels[ni] === -1) {
          labels[ni] = label;
          stack[sp++] = ni;
        }
      }
      if (y > 0) {
        const ni = idx - width;
        if (mask[ni] && labels[ni] === -1) {
          labels[ni] = label;
          stack[sp++] = ni;
        }
      }
      if (y < height - 1) {
        const ni = idx + width;
        if (mask[ni] && labels[ni] === -1) {
          labels[ni] = label;
          stack[sp++] = ni;
        }
      }
    }
    areas.push(area);
    touchesBorder.push(touches);
  }
  return { labels, areas, touchesBorder };
}

export interface BoundaryCandidates {
  /** Points from horizontal (row) scans — well-conditioned for near-VERTICAL sides. */
  readonly rowPoints: Point2[];
  /** Points from vertical (column) scans — well-conditioned for near-HORIZONTAL sides. */
  readonly colPoints: Point2[];
}

/**
 * How far (px) beyond the crossing to sample a "confirmed background" /
 * "confirmed paper" pair for `localCrossingLevel` below.
 */
const LOCAL_LEVEL_OFFSET_PX = 4;

/**
 * Sub-pixel boundary candidates: for every row, the left/right-most
 * transition into the chosen component (linearly interpolating the
 * blurred grayscale across a LOCALLY estimated crossing level); for every
 * column, the same top/bottom. A row/column where the component already
 * reaches that frame edge has no real transition and contributes nothing
 * there.
 *
 * The crossing level is estimated LOCALLY (a background sample and a
 * paper sample a few px further out along the same scan line, averaged —
 * `localCrossingLevel`) rather than using the single global Otsu
 * threshold for every interpolation: under uneven lighting the
 * background/paper brightness gap itself drifts across the frame, so a
 * fixed global cutoff crosses the real (antialiased) edge ramp off-centre
 * by an amount that tracks the local light level — worth close to a full
 * pixel of corner error in testing before this fix. The global Otsu
 * threshold is still what defines the connected-component mask itself
 * (`detectPaperQuad`); only this local refinement step reads it as a
 * fallback (near a frame edge, where no far sample exists).
 *
 * Kept as two separate lists rather than one merged list: interpolating a
 * ROW scan across a side that runs nearly HORIZONTAL (nearly parallel to
 * the scan direction) is poorly conditioned — small pixel noise swings
 * the crossing position by much more than a sub-pixel amount — and
 * symmetrically for a COLUMN scan across a near-vertical side. Each side
 * is later fit from only the well-conditioned list for its own
 * orientation (`detectPaperQuad`), which is what keeps corner accuracy
 * sub-pixel; mixing both in unconditionally cost roughly 1 px of extra
 * corner error in testing.
 *
 * Positions are pixel-CENTRE coordinates (`gray[y*width+x]` is the sample
 * at continuous position `(x+0.5, y+0.5)`), matching the convention the
 * homography and every other geometry module in this app already uses
 * for "image px".
 */
function collectBoundaryCandidates(
  labels: Int32Array,
  bestLabel: number,
  gray: Float32Array,
  threshold: number,
  width: number,
  height: number,
): BoundaryCandidates {
  const rowPoints: Point2[] = [];
  const colPoints: Point2[] = [];
  const isComponent = (idx: number) => labels[idx] === bestLabel;
  const interp = (
    level: number,
    outsideVal: number,
    insideVal: number,
    outsidePos: number,
    insidePos: number,
  ): number => {
    if (insideVal === outsideVal) return (outsidePos + insidePos) / 2;
    const t = (level - outsideVal) / (insideVal - outsideVal);
    return outsidePos + clamp(t, 0, 1) * (insidePos - outsidePos);
  };
  /** Average of a far-background and a far-paper sample, or the global Otsu threshold near a frame edge. */
  const localCrossingLevel = (farOutsideIdx: number, farInsideIdx: number) =>
    (gray[farOutsideIdx] + gray[farInsideIdx]) / 2;

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    const yc = y + 0.5;
    let xLeft = 0;
    while (xLeft < width && !isComponent(rowOff + xLeft)) xLeft++;
    if (xLeft > 0 && xLeft < width) {
      const farOut = Math.max(0, xLeft - 1 - LOCAL_LEVEL_OFFSET_PX);
      const farIn = Math.min(width - 1, xLeft + LOCAL_LEVEL_OFFSET_PX);
      const level =
        farOut < xLeft - 1 && farIn > xLeft
          ? localCrossingLevel(rowOff + farOut, rowOff + farIn)
          : threshold;
      const xf = interp(
        level,
        gray[rowOff + xLeft - 1],
        gray[rowOff + xLeft],
        xLeft - 0.5,
        xLeft + 0.5,
      );
      rowPoints.push({ x: xf, y: yc });
    }
    let xRight = width - 1;
    while (xRight >= 0 && !isComponent(rowOff + xRight)) xRight--;
    if (xRight >= 0 && xRight < width - 1) {
      const farOut = Math.min(width - 1, xRight + 1 + LOCAL_LEVEL_OFFSET_PX);
      const farIn = Math.max(0, xRight - LOCAL_LEVEL_OFFSET_PX);
      const level =
        farOut > xRight + 1 && farIn < xRight
          ? localCrossingLevel(rowOff + farOut, rowOff + farIn)
          : threshold;
      const xf = interp(
        level,
        gray[rowOff + xRight + 1],
        gray[rowOff + xRight],
        xRight + 1.5,
        xRight + 0.5,
      );
      rowPoints.push({ x: xf, y: yc });
    }
  }

  for (let x = 0; x < width; x++) {
    const xc = x + 0.5;
    let yTop = 0;
    while (yTop < height && !isComponent(yTop * width + x)) yTop++;
    if (yTop > 0 && yTop < height) {
      const farOut = Math.max(0, yTop - 1 - LOCAL_LEVEL_OFFSET_PX);
      const farIn = Math.min(height - 1, yTop + LOCAL_LEVEL_OFFSET_PX);
      const level =
        farOut < yTop - 1 && farIn > yTop
          ? localCrossingLevel(farOut * width + x, farIn * width + x)
          : threshold;
      const yf = interp(
        level,
        gray[(yTop - 1) * width + x],
        gray[yTop * width + x],
        yTop - 0.5,
        yTop + 0.5,
      );
      colPoints.push({ x: xc, y: yf });
    }
    let yBottom = height - 1;
    while (yBottom >= 0 && !isComponent(yBottom * width + x)) yBottom--;
    if (yBottom >= 0 && yBottom < height - 1) {
      const farOut = Math.min(height - 1, yBottom + 1 + LOCAL_LEVEL_OFFSET_PX);
      const farIn = Math.max(0, yBottom - LOCAL_LEVEL_OFFSET_PX);
      const level =
        farOut > yBottom + 1 && farIn < yBottom
          ? localCrossingLevel(farOut * width + x, farIn * width + x)
          : threshold;
      const yf = interp(
        level,
        gray[(yBottom + 1) * width + x],
        gray[yBottom * width + x],
        yBottom + 1.5,
        yBottom + 0.5,
      );
      colPoints.push({ x: xc, y: yf });
    }
  }

  return { rowPoints, colPoints };
}

// ── Side assembly ─────────────────────────────────────────────────────────

interface CoarseSide {
  readonly start: Point2;
  readonly end: Point2;
  readonly line: NormalLine;
}

function buildCoarseSides(
  quad: readonly [Point2, Point2, Point2, Point2],
): (CoarseSide | null)[] {
  const sides: (CoarseSide | null)[] = [];
  for (let i = 0; i < 4; i++) {
    const start = quad[i];
    const end = quad[(i + 1) % 4];
    const line = lineFromTwoPoints(start, end);
    sides.push(line ? { start, end, line } : null);
  }
  return sides;
}

/**
 * Assign each point to whichever side in `allowedIndices` its coarse line
 * is nearest, gated by `maxDistancePx` (rejects points near neither —
 * chiefly hand/wrist-occluder boundary points, which sit well inside the
 * quad rather than on any true side).
 */
function assignToSides(
  points: readonly Point2[],
  sides: readonly (CoarseSide | null)[],
  allowedIndices: readonly number[],
  maxDistancePx: number,
): Point2[][] {
  const buckets: Point2[][] = [[], [], [], []];
  for (const p of points) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (const i of allowedIndices) {
      const side = sides[i];
      if (!side) continue;
      const d = Math.abs(side.line.nx * p.x + side.line.ny * p.y - side.line.c);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestDist <= maxDistancePx) {
      buckets[bestIdx].push(p);
    }
  }
  return buckets;
}

/**
 * `"h"` (more horizontal than vertical) sides are best sampled by COLUMN
 * scans; `"v"` sides by ROW scans — see `collectBoundaryCandidates`'s doc
 * comment for why mixing both in is a real (~1 px) accuracy cost.
 */
function classifySideOrientation(side: CoarseSide | null): "h" | "v" {
  if (!side) return "h";
  const dx = Math.abs(side.end.x - side.start.x);
  const dy = Math.abs(side.end.y - side.start.y);
  return dx >= dy ? "h" : "v";
}

/**
 * Run detection on one already-decoded video/photo frame. `paperSize`
 * only affects the final aspect-ratio sanity check (corner geometry
 * itself is derived purely from the image). Deterministic; no DOM access
 * beyond reading `frame.data`.
 */
export function detectPaperQuad(
  frame: ImageData,
  paperSize: PaperSize,
  options: DetectPaperQuadOptions = {},
): SheetQuadDetection {
  // Never throw (2026-09-25 PR #59 review, B2): any geometric failure —
  // expected (e.g. a genuinely ambiguous/degenerate quad) or not — reports
  // "no detection" rather than propagating. `pipeline.ts` also wraps its
  // own call defensively, but the contract this module promises its
  // caller (the live camera viewfinder in another worktree, called up to
  // 8×/s) is that it never throws in the first place.
  try {
    return detectPaperQuadImpl(frame, paperSize, options);
  } catch {
    return NONE;
  }
}

function detectPaperQuadImpl(
  frame: ImageData,
  paperSize: PaperSize,
  options: DetectPaperQuadOptions,
): SheetQuadDetection {
  const { width, height, data } = frame;
  const pixelCount = width * height;
  if (width < 20 || height < 20) return NONE;

  const scale = resolutionScale(width, height);
  const ransacInlierThresholdPx =
    RANSAC_INLIER_THRESHOLD_PX_AT_REFERENCE * scale;
  const reportingThresholdPx = REPORTING_THRESHOLD_PX_AT_REFERENCE * scale;

  const { gray, sat } = computeGrayscaleAndSaturation(data, pixelCount);
  const blurredGray = boxBlur(gray, width, height, BLUR_RADIUS_PX);
  const blurredSat = boxBlur(sat, width, height, BLUR_RADIUS_PX);
  const threshold = computeOtsuThreshold(blurredGray);

  const mask = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    mask[i] =
      blurredGray[i] >= threshold && blurredSat[i] <= MAX_PAPER_SATURATION
        ? 1
        : 0;
  }

  const { labels, areas } = labelComponents(mask, width, height);
  if (areas.length === 0) return NONE;
  let bestLabel = 0;
  let bestArea = areas[0];
  for (let i = 1; i < areas.length; i++) {
    if (areas[i] > bestArea) {
      bestArea = areas[i];
      bestLabel = i;
    }
  }
  if (bestArea < MIN_PAPER_AREA_FRACTION * pixelCount) return NONE;

  const { rowPoints, colPoints } = collectBoundaryCandidates(
    labels,
    bestLabel,
    blurredGray,
    threshold,
    width,
    height,
  );
  if (rowPoints.length + colPoints.length < 4 * RANSAC_MIN_POINTS) return NONE;

  const hull = convexHull(rowPoints.concat(colPoints));
  const coarseQuad = simplifyToQuad(hull);
  if (!coarseQuad) return NONE;
  const ordered = orderQuadCorners(coarseQuad);

  const diag = Math.hypot(width, height);
  const maxAssignDistance = diag * SIDE_ASSIGNMENT_MAX_DISTANCE_FRACTION;
  const coarseSides = buildCoarseSides(ordered);
  const orientations = coarseSides.map(classifySideOrientation);
  const hIndices = [0, 1, 2, 3].filter((i) => orientations[i] === "h");
  const vIndices = [0, 1, 2, 3].filter((i) => orientations[i] === "v");
  const hBuckets = assignToSides(
    colPoints,
    coarseSides,
    hIndices,
    maxAssignDistance,
  );
  const vBuckets = assignToSides(
    rowPoints,
    coarseSides,
    vIndices,
    maxAssignDistance,
  );
  const buckets = [0, 1, 2, 3].map((i) =>
    orientations[i] === "h" ? hBuckets[i] : vBuckets[i],
  );

  const rng = mulberry32(RANSAC_SEED);
  const fits = buckets.map((pts) =>
    fitLineRansac(pts, {
      iterations: RANSAC_ITERATIONS,
      inlierThresholdPx: ransacInlierThresholdPx,
      minPoints: RANSAC_MIN_POINTS,
      rng,
    }),
  );

  const finalLinesOrNull: (NormalLine | null)[] = fits.map((fit, i) => {
    const coarse = coarseSides[i];
    if (fit) return fit.line;
    if (coarse) return coarse.line;
    return null; // degenerate input (e.g. 3 near-collinear coarse corners) — no detection, not a throw.
  });
  if (finalLinesOrNull.some((line) => line === null)) return NONE;
  const finalLines = finalLinesOrNull as NormalLine[];

  // Working quad: EVERY side present, falling back to the coarse line
  // where a side couldn't be fit. Used only internally, for the sanity
  // checks below and as segment endpoints for coverage binning — never
  // exposed directly (see `corners` vs `partialCorners` below).
  let workingCorners: [Point2, Point2, Point2, Point2];
  try {
    const c0 = intersectLines(finalLines[3], finalLines[0]);
    const c1 = intersectLines(finalLines[0], finalLines[1]);
    const c2 = intersectLines(finalLines[1], finalLines[2]);
    const c3 = intersectLines(finalLines[2], finalLines[3]);
    if (!c0 || !c1 || !c2 || !c3) return NONE;
    workingCorners = [c0, c1, c2, c3];
  } catch {
    return NONE;
  }

  if (!isConvexQuad(workingCorners)) return NONE;
  if (polygonArea(workingCorners) < MIN_QUAD_AREA_FRACTION * pixelCount) {
    return NONE;
  }

  // Component-vs-quad area consistency (B3): a merged/attached second
  // bright object (a touching receipt, a shadow band splitting the sheet)
  // can still fit a perfectly convex quad, but that quad won't actually
  // match the connected component it was fit from.
  const quadArea = polygonArea(workingCorners);
  const componentToQuadAreaRatio = bestArea / quadArea;
  if (
    componentToQuadAreaRatio < MIN_COMPONENT_TO_QUAD_AREA_RATIO ||
    componentToQuadAreaRatio > MAX_COMPONENT_TO_QUAD_AREA_RATIO
  ) {
    return NONE;
  }

  // Orientation + rectified aspect (B1 + B3): which of the quad's two axes
  // is the paper's WIDTH, and does the quad even look like the right
  // rectangle at all (real EXIF focal length if the caller has one, else
  // an assumed phone FOV) — see orientation.ts's header for the math.
  const { shortMm, longMm } = PAPER_DIMENSIONS_MM[paperSize];
  const principalPoint: Point2 = { x: width / 2, y: height / 2 };
  const focalPx = options.focalPxHint ?? assumedFocalPxFromFov(width);
  const orientation = resolveOrientation(
    workingCorners,
    shortMm,
    longMm,
    principalPoint,
    focalPx,
  );
  if (!orientation || orientation.residual > MAX_ORIENTATION_RESIDUAL) {
    return NONE;
  }
  const expectedRectifiedAspect = orientation.rotateBy1
    ? longMm / shortMm
    : shortMm / longMm;
  const aspectError =
    Math.abs(orientation.rectifiedAspect - expectedRectifiedAspect) /
    expectedRectifiedAspect;
  if (aspectError > ASPECT_TOLERANCE_FRACTION) return NONE;

  // Relabel so TL→TR is always the paper's WIDTH (short) side, exactly
  // like a photo shot upright would have given `buildPaperHomography`
  // for free — a plain cyclic rotation of every per-side/per-corner array
  // in lockstep.
  if (orientation.rotateBy1) {
    workingCorners = [
      workingCorners[1],
      workingCorners[2],
      workingCorners[3],
      workingCorners[0],
    ];
    fits.push(fits.shift()!);
    buckets.push(buckets.shift()!);
    coarseSides.push(coarseSides.shift()!);
  }

  // partialCorners[i] uses ONLY genuinely fitted lines (never the coarse
  // fallback `finalLines` above) — a corner counts as "found" exactly
  // when both its adjacent sides were actually fit from image evidence.
  const partialCorners: [
    Point2 | null,
    Point2 | null,
    Point2 | null,
    Point2 | null,
  ] = [null, null, null, null];
  const cornersFound: [boolean, boolean, boolean, boolean] = [
    false,
    false,
    false,
    false,
  ];
  let cornersSeen = 0;
  for (let i = 0; i < 4; i++) {
    const prevFit = fits[(i + 3) % 4];
    const thisFit = fits[i];
    if (prevFit && thisFit) {
      const corner = intersectLines(prevFit.line, thisFit.line);
      if (corner) {
        partialCorners[i] = corner;
        cornersFound[i] = true;
        cornersSeen++;
      }
    }
  }

  let coverageMin = 1;
  let residualMax = 0;
  for (let i = 0; i < 4; i++) {
    const fit = fits[i];
    const segStart = workingCorners[i];
    const segEnd = workingCorners[(i + 1) % 4];
    if (!fit) {
      coverageMin = 0;
      continue;
    }
    const reporting = computeReportingStats(
      buckets[i],
      fit.line,
      reportingThresholdPx,
    );
    const coverage = computeSideCoverage(
      reporting.points,
      segStart,
      segEnd,
      COVERAGE_BINS,
    );
    coverageMin = Math.min(coverageMin, coverage);
    // The WORST side, not the average: a single curled side must not be
    // diluted by the other three (typically near-flat) sides — see this
    // function's header comment.
    residualMax = Math.max(residualMax, reporting.meanResidualPx);
  }

  return {
    corners:
      cornersSeen === 4
        ? (partialCorners as [Point2, Point2, Point2, Point2])
        : null,
    cornersSeen: cornersSeen as 0 | 1 | 2 | 3 | 4,
    cornersFound,
    partialCorners,
    minSideCoverage: coverageMin,
    edgeFitResidualPx: residualMax,
    paperRegionFound: true,
  };
}
