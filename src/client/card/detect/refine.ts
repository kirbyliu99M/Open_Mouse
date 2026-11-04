/**
 * Scan Lab card detector (L3a, 2026-10-29), step 2 of 2: FINE corners by
 * edge-line fitting.
 *
 * A card's corners are rounded (ISO/IEC 7810 ID-1: radius about 3.18 mm), so
 * any outline vertex — a contour or hull vertex, which is what `coarse.ts`
 * returns — lands on the arc, inside the true corner (about r(1 - 1/sqrt 2)
 * per axis, 0.9 mm, more after polygon simplification). The corner a
 * homography needs is the intersection of the two straight edges, which is
 * not on the card at all. So, per side:
 *
 * 1. Sample the side every 1 px, but only farther than
 *    `CORNER_EXCLUSION_RADII` x the corner radius from either end, so no
 *    sample falls on an arc.
 * 2. At each sample, read a colour profile across the side (along the side's
 *    normal, which is the edge's gradient direction to within the coarse
 *    quad's angle error; averaged over 5 px along the side against noise) and
 *    take the sub-pixel position of its steepest colour change.
 * 3. RANSAC + total-least-squares line through those points
 *    (`paper/quad-math.ts#fitLineRansac`, the same robust fit the sheet uses).
 *
 * Corners are the intersections of adjacent lines. A second pass repeats
 * 1-3 around the first pass's lines and corners (narrower profiles, exclusion
 * measured from the real corners). Pure and deterministic (RANSAC is seeded).
 *
 * Coordinates: image px (x right, y down, pixel centres at +0.5).
 */
import { ID1_CARD_MM } from "../../../lib/contracts/measurement";
import type { Point2 } from "../../geometry/homography";
import {
  fitLineRansac,
  intersectLines,
  mulberry32,
  RANSAC_SEED,
  type NormalLine,
} from "../../paper/quad-math";
import type { Quad } from "./coarse";
import { sampleRgb, type RgbaImage } from "./image";

/** ISO/IEC 7810 ID-1 corner radius, mm (the standard gives 3.18 +/- 0.30). */
export const CARD_CORNER_RADIUS_MM = 3.18;
/** Edge samples closer than this many corner radii to a corner are dropped. Brief L3a; candidate 未拍板. */
export const CORNER_EXCLUSION_RADII = 1.5;
/** Profile half-width on the first pass: this many mm (floor 4 px) either side of the coarse side. Candidate 未拍板. */
export const FIRST_PASS_HALF_WIDTH_MM = 2;
/** Profile half-width on the second pass, mm (floor 2.5 px). Candidate 未拍板. */
export const SECOND_PASS_HALF_WIDTH_MM = 0.8;
/** Steepest colour change below this (grey levels per px) is not an edge. Candidate 未拍板. */
export const MIN_EDGE_STRENGTH = 6;
/** RANSAC inlier distance to the line, px. Candidate 未拍板. */
export const EDGE_INLIER_THRESHOLD_PX = 1;
/** A side needs at least this fraction of its samples as inliers (and at least 8). Candidate 未拍板. */
export const MIN_INLIER_FRACTION = 0.3;

const PROFILE_STEP_PX = 0.5;
/**
 * L6: with `insideSign`, an edge counts when it is at least this fraction of
 * the profile's steepest. Card back (61, 95, 159) to wood is about 140 grey
 * levels, wood to sheet white about 225, card to the maze mat 90-150, the
 * card's own texture under 15 after the 5-sample average. Candidate 未拍板.
 */
export const FIRST_EDGE_FRACTION = 0.3;
const TANGENTIAL_OFFSETS = [-2, -1, 0, 1, 2];

/**
 * L12 (2026-11-04): a thin band at the card's edge that differs from BOTH
 * the card and the table (a bevelled rim catching light) puts two opposite
 * steps across the edge, and the steepest is often the inner one (rim to
 * card), so the fitted side landed on the rim's inside: on the L12
 * synthetic set (a 0.25 mm light rim on Kirby's black card, 83 cards) the
 * sides sat 0.27 px in (median; 5th percentile 1.3 px), corner error p95
 * 2.2 px against 0.3 px without the rim. The card's edge is the rim's
 * OUTER side, as for a card without a rim (the outline's outermost step).
 * `refineCardQuad(..., outerRim)` reads each fitted side's profile
 * averaged along the side (`sideRimShift`) and moves the side out onto the
 * rim's outer side when it finds one (a band lighter than both sides); a
 * single step (no band) or a dark band is
 * unchanged. Per-sample decisions were tried first and moved sides of
 * L7's band and maze scenes 2 px out onto mat lines; with the outline
 * search it let a wood-grain quad pass on the synthetic set, so only the
 * straight-edge search of a box uses it (`detectCard`). Candidate 未拍板.
 */
export const RIM_MAX_MM = 0.6;
export const RIM_MIN_PX = 1.5;
export const RIM_MIN_FRACTION = 0.35;
/** Added to the search reach for blur (the two lobes of a blurred band sit apart by its width plus about 2 sigma). Candidate 未拍板. */
export const RIM_BLUR_PX = 2;
/** The rim band must differ from both the card and the table by this many grey levels (side-averaged). Candidate 未拍板. */
export const RIM_MIN_BAND_STEP = 4;

/** How one side's edge line was fitted (px of the full image). */
export interface CardSideFit {
  /** Mean perpendicular distance of the used points to the fitted line, px; null if the side was not fitted. */
  readonly residualPx: number | null;
  /** Edge points the final line was fitted to (RANSAC inliers). */
  readonly pointsUsed: number;
  /** Positions sampled along the side (before dropping weak or outlying ones). */
  readonly pointsSampled: number;
}

/** `refineCardQuad`'s output: fitted corners and lines, image px. */
export interface RefineResult {
  /** TL, TR, BR, BL (the coarse quad's order), sub-pixel image px; null when any side could not be fitted. */
  readonly corners: Quad | null;
  /** Per side, 0 = TL-TR, 1 = TR-BR, 2 = BR-BL, 3 = BL-TL. */
  readonly sides: readonly [CardSideFit, CardSideFit, CardSideFit, CardSideFit];
  /** The fitted lines (normal form, image px), same order; null for a side not fitted. */
  readonly lines: readonly (NormalLine | null)[];
}

/** Which mm length each side of `quad` is: the longer opposite pair is the card's long side. */
export function cardSideLengthsMm(
  quad: Quad,
): readonly [number, number, number, number] {
  const len = (i: number) =>
    Math.hypot(
      quad[(i + 1) % 4].x - quad[i].x,
      quad[(i + 1) % 4].y - quad[i].y,
    );
  const longMm = Math.max(ID1_CARD_MM.width, ID1_CARD_MM.height);
  const shortMm = Math.min(ID1_CARD_MM.width, ID1_CARD_MM.height);
  const evenLong = len(0) + len(2) >= len(1) + len(3);
  return evenLong
    ? [longMm, shortMm, longMm, shortMm]
    : [shortMm, longMm, shortMm, longMm];
}

/**
 * Sub-pixel offset (px, along `n`) of the steepest colour change in the
 * profile across `p0`, or null if there is no clear edge within
 * `halfWidthPx`. `d` is the unit side direction, `n` the unit normal.
 *
 * `insideSign` (L6): +1 when the card lies on the +n side, -1 on the -n
 * side; then the edge taken is not the steepest but the FIRST clear one met
 * coming from the card's side (a local peak of at least
 * `FIRST_EDGE_FRACTION` of the steepest). Used for a side lying along the
 * sheet, where a strip of table between the card and the sheet puts the
 * sheet's own, stronger edge a few px outside the card's. 0 (default): the
 * steepest.
 */
export function edgeOffsetAlongNormal(
  img: RgbaImage,
  p0: Point2,
  d: Point2,
  n: Point2,
  halfWidthPx: number,
  colourStep: readonly [number, number, number] | null = null,
  insideSign: -1 | 0 | 1 = 0,
): number | null {
  const K = Math.ceil(halfWidthPx / PROFILE_STEP_PX) + 1;
  const count = 2 * K + 1;
  const prof = new Float64Array(count * 3);
  const c = [0, 0, 0];
  for (let k = -K; k <= K; k++) {
    const off = k * PROFILE_STEP_PX;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const j of TANGENTIAL_OFFSETS) {
      sampleRgb(img, p0.x + n.x * off + d.x * j, p0.y + n.y * off + d.y * j, c);
      r += c[0];
      g += c[1];
      b += c[2];
    }
    const o = (k + K) * 3;
    const m = TANGENTIAL_OFFSETS.length;
    prof[o] = r / m;
    prof[o + 1] = g / m;
    prof[o + 2] = b / m;
  }
  // Strength at sample k: colour difference across 1 px (k-1 to k+1), per px.
  const strength = new Float64Array(count);
  let best = -1;
  let bestK = -1;
  for (let i = 1; i < count - 1; i++) {
    let s = 0;
    if (colourStep) {
      // L5: only the change toward the far side's colour counts (signed).
      for (let ch = 0; ch < 3; ch++) {
        s += (prof[(i + 1) * 3 + ch] - prof[(i - 1) * 3 + ch]) * colourStep[ch];
      }
      strength[i] = s > 0 ? s : 0;
    } else {
      for (let ch = 0; ch < 3; ch++) {
        const diff = prof[(i + 1) * 3 + ch] - prof[(i - 1) * 3 + ch];
        s += diff * diff;
      }
      strength[i] = Math.sqrt(s);
    }
    if (strength[i] > best) {
      best = strength[i];
      bestK = i;
    }
  }
  if (best < MIN_EDGE_STRENGTH) return null;
  if (insideSign !== 0) {
    const thr = Math.max(MIN_EDGE_STRENGTH, FIRST_EDGE_FRACTION * best);
    const from = insideSign > 0 ? count - 2 : 1;
    const step = insideSign > 0 ? -1 : 1;
    for (let i = from; i >= 1 && i <= count - 2; i += step) {
      if (strength[i] < thr) continue;
      let peak = true;
      for (let j = i - 2; j <= i + 2 && peak; j++) {
        if (j >= 1 && j <= count - 2 && strength[j] > strength[i]) peak = false;
      }
      if (peak) {
        bestK = i;
        break;
      }
    }
  }
  // The peak must be interior with room for the centroid window.
  if (bestK < 3 || bestK > count - 4) return null;
  // Centroid of the strength bump (+/- 1.5 px), above the window's floor:
  // unbiased for a symmetric edge profile whatever its sub-pixel phase, where
  // a 3-point parabola is pulled toward the nearest sample on a flat-topped
  // (sharp, anti-aliased) edge.
  let floor = Infinity;
  for (let i = bestK - 3; i <= bestK + 3; i++) {
    floor = Math.min(floor, strength[i]);
  }
  let wsum = 0;
  let isum = 0;
  for (let i = bestK - 3; i <= bestK + 3; i++) {
    const wgt = strength[i] - floor;
    wsum += wgt;
    isum += wgt * i;
  }
  if (wsum <= 0) return null;
  return (isum / wsum - K) * PROFILE_STEP_PX;
}

interface SideSamples {
  readonly points: Point2[];
  readonly sampled: number;
}

/** Colour step across a side under this (RGB distance, grey levels) is too small to steer by; the plain colour gradient is used. Candidate 未拍板. */
export const MIN_COLOUR_STEP = 20;
/** The two colours either side of an edge are read this many mm (floor 5 px) from the coarse side. Candidate 未拍板. */
export const COLOUR_PROBE_MM = 3;

/**
 * L5 (2026-10-30): the unit RGB direction from the colour on the -n side of
 * the side a-b to the colour on its +n side (each the per-channel median over
 * the side's middle 60 %), or null when they barely differ. On Kirby's photo
 * of a dark card on wood the edge is a 7 px ramp whose brightness drop and
 * hue change sit 2-3 px apart, so the plain colour gradient had two humps and
 * the picked edge jumped between them (top side residual 0.57 px); the change
 * toward the card's own colour is one hump.
 */
export function sideColourStep(
  img: RgbaImage,
  a: Point2,
  b: Point2,
  pxPerMm: number,
): [number, number, number] | null {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 1e-6) return null;
  const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const n = { x: -d.y, y: d.x };
  const off = Math.max(5, COLOUR_PROBE_MM * pxPerMm);
  const plus: number[][] = [[], [], []];
  const minus: number[][] = [[], [], []];
  const c = [0, 0, 0];
  for (let t = 0.2 * L; t <= 0.8 * L; t += 2) {
    const px = a.x + d.x * t;
    const py = a.y + d.y * t;
    sampleRgb(img, px + n.x * off, py + n.y * off, c);
    for (let ch = 0; ch < 3; ch++) plus[ch].push(c[ch]);
    sampleRgb(img, px - n.x * off, py - n.y * off, c);
    for (let ch = 0; ch < 3; ch++) minus[ch].push(c[ch]);
  }
  const med = (v: number[]) => {
    v.sort((p, q) => p - q);
    return v[v.length >> 1] ?? 0;
  };
  const step = [0, 1, 2].map((ch) => med(plus[ch]) - med(minus[ch]));
  const len = Math.hypot(step[0], step[1], step[2]);
  if (len < MIN_COLOUR_STEP) return null;
  return [step[0] / len, step[1] / len, step[2] / len];
}

function sampleSide(
  img: RgbaImage,
  a: Point2,
  b: Point2,
  sideMm: number,
  halfWidthMm: number,
  halfWidthFloorPx: number,
  colourStep: readonly [number, number, number] | null,
  inside: Point2 | null = null,
  minHalfWidthPx = 0,
): SideSamples {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 1e-6) return { points: [], sampled: 0 };
  const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const n = { x: -d.y, y: d.x };
  const pxPerMm = L / sideMm;
  const excl = CORNER_EXCLUSION_RADII * CARD_CORNER_RADIUS_MM * pxPerMm;
  const halfWidth = Math.max(
    halfWidthFloorPx,
    halfWidthMm * pxPerMm,
    minHalfWidthPx,
  );
  const insideSign: -1 | 0 | 1 = inside
    ? (inside.x - a.x) * n.x + (inside.y - a.y) * n.y > 0
      ? 1
      : -1
    : 0;
  const points: Point2[] = [];
  let sampled = 0;
  for (let t = excl; t <= L - excl; t += 1) {
    sampled++;
    const p0 = { x: a.x + d.x * t, y: a.y + d.y * t };
    const off = edgeOffsetAlongNormal(
      img,
      p0,
      d,
      n,
      halfWidth,
      colourStep,
      insideSign,
    );
    if (off === null) continue;
    points.push({ x: p0.x + n.x * off, y: p0.y + n.y * off });
  }
  return { points, sampled };
}

function fitSide(samples: SideSamples): {
  line: NormalLine | null;
  fit: CardSideFit;
} {
  const minPoints = Math.max(
    8,
    Math.ceil(MIN_INLIER_FRACTION * samples.sampled),
  );
  const res = fitLineRansac(samples.points, {
    iterations: 100,
    inlierThresholdPx: EDGE_INLIER_THRESHOLD_PX,
    minPoints,
    rng: mulberry32(RANSAC_SEED),
  });
  if (!res) {
    return {
      line: null,
      fit: { residualPx: null, pointsUsed: 0, pointsSampled: samples.sampled },
    };
  }
  return {
    line: res.line,
    fit: {
      residualPx: res.meanResidualPx,
      pointsUsed: res.inliers.length,
      pointsSampled: samples.sampled,
    },
  };
}

function cornersFromLines(lines: readonly (NormalLine | null)[]): Quad | null {
  const out: Point2[] = [];
  for (let i = 0; i < 4; i++) {
    const prev = lines[(i + 3) % 4];
    const cur = lines[i];
    if (!prev || !cur) return null;
    const p = intersectLines(prev, cur);
    if (!p) return null;
    out.push(p);
  }
  return [out[0], out[1], out[2], out[3]];
}

/**
 * Refine a coarse card quad (TL, TR, BR, BL, image px of `img`) to sub-pixel
 * corners by fitting each side's straight edge. Returns `corners: null` (and
 * the per-side record, saying which side failed) when any side has too few
 * edge points — never a guessed corner.
 *
 * `alongSheet` (L6): per side, `true` when it lies along the sheet's edge
 * (`coarse.ts` lays it on the sheet's edge line). Such a side is fitted on
 * the first edge met from the card's side (`edgeOffsetAlongNormal`'s
 * `insideSign`) with the plain colour gradient, in a window at least
 * `alongWindowPx` either side on the first pass: the card may stop up to the
 * masked band's width short of the sheet. Without it, a 0.5-3 mm strip of
 * table between card and sheet put the fitted side on the sheet's edge
 * (corner errors 1-7.5 px on the L6 scenes).
 *
 * `outerRim` (L12): a thin band at the edge unlike both sides (a light rim)
 * is counted as the card's (`RIM_MAX_MM`); `detectCard` sets it only for
 * the straight-edge search of a box (no sheet), so outline answers keep
 * their corners.
 */
export function refineCardQuad(
  img: RgbaImage,
  coarse: Quad,
  alongSheet: readonly boolean[] = [false, false, false, false],
  alongWindowPx = 0,
  outerRim = false,
): RefineResult {
  const sideMm = cardSideLengthsMm(coarse);
  // Each side's colour step, read once around the coarse quad (L5).
  const steps = [0, 1, 2, 3].map((s) => {
    if (alongSheet[s]) return null;
    const a = coarse[s];
    const b = coarse[(s + 1) % 4];
    return sideColourStep(
      img,
      a,
      b,
      Math.hypot(b.x - a.x, b.y - a.y) / sideMm[s],
    );
  });
  let quad: Quad = coarse;
  let lines: (NormalLine | null)[] = [null, null, null, null];
  let fits: CardSideFit[] = [];
  const passes: readonly [number, number][] = [
    [FIRST_PASS_HALF_WIDTH_MM, 4],
    [SECOND_PASS_HALF_WIDTH_MM, 2.5],
  ];
  for (let pass = 0; pass < passes.length; pass++) {
    const [halfWidthMm, floorPx] = passes[pass];
    const centre = {
      x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4,
      y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4,
    };
    lines = [];
    fits = [];
    for (let s = 0; s < 4; s++) {
      const a = quad[s];
      const b = quad[(s + 1) % 4];
      const along = alongSheet[s] === true;
      const { line, fit } = fitSide(
        sampleSide(
          img,
          a,
          b,
          sideMm[s],
          halfWidthMm,
          floorPx,
          steps[s],
          along ? centre : null,
          along && pass === 0 ? alongWindowPx : 0,
        ),
      );
      lines.push(line);
      fits.push(fit);
    }
    const next = cornersFromLines(lines);
    if (!next) {
      return {
        corners: null,
        sides: [fits[0], fits[1], fits[2], fits[3]],
        lines,
      };
    }
    quad = next;
  }
  if (outerRim) {
    // L12: a light rim along a side moves that side's line out to it.
    const centre = {
      x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4,
      y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4,
    };
    let moved = false;
    const shifted = lines.map((line, s) => {
      if (!line || alongSheet[s]) return line;
      const shift = sideRimShift(
        img,
        quad[s],
        quad[(s + 1) % 4],
        sideMm[s],
        centre,
      );
      if (shift === 0) return line;
      moved = true;
      // Outward = away from the centre along the line's normal.
      const sgn = line.nx * centre.x + line.ny * centre.y - line.c > 0 ? -1 : 1;
      return { nx: line.nx, ny: line.ny, c: line.c + sgn * shift };
    });
    if (moved) {
      const next = cornersFromLines(shifted);
      if (next) {
        return {
          corners: next,
          sides: [fits[0], fits[1], fits[2], fits[3]],
          lines: shifted,
        };
      }
    }
  }
  return { corners: quad, sides: [fits[0], fits[1], fits[2], fits[3]], lines };
}

/**
 * L12: how far (px, >= 0) to move a fitted side outward onto the outer
 * side of a light rim, from the grey profile across the side averaged over
 * its middle 70 % (texture beside the card averages out; a rim runs the
 * whole side). 0 when there is no rim: the steepest step near the line
 * has no opposite-signed lobe (`RIM_MIN_FRACTION` of it) beyond it within
 * `RIM_MAX_MM` + `RIM_BLUR_PX`, or the band between is not lighter than
 * both the card and the table by `RIM_MIN_BAND_STEP`. The
 * edge is put half-way between the derivative's zero crossing (the band's
 * middle) and the outer lobe (about one blur width beyond the band).
 */
function sideRimShift(
  img: RgbaImage,
  a: Point2,
  b: Point2,
  sideMm: number,
  centre: Point2,
): number {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 1e-6) return 0;
  const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  let n = { x: -d.y, y: d.x };
  if ((centre.x - a.x) * n.x + (centre.y - a.y) * n.y > 0) {
    n = { x: -n.x, y: -n.y };
  }
  const pxPerMm = L / sideMm;
  const reach = Math.max(RIM_MIN_PX, RIM_MAX_MM * pxPerMm) + RIM_BLUR_PX;
  const K = Math.ceil((reach + 4) / PROFILE_STEP_PX);
  const count = 2 * K + 1;
  const grey = new Float64Array(count);
  const c = [0, 0, 0];
  let m = 0;
  for (let t = 0.15 * L; t <= 0.85 * L; t += 1) {
    m++;
    for (let k = -K; k <= K; k++) {
      const off = k * PROFILE_STEP_PX;
      sampleRgb(img, a.x + d.x * t + n.x * off, a.y + d.y * t + n.y * off, c);
      grey[k + K] += (c[0] + c[1] + c[2]) / 3;
    }
  }
  if (m === 0) return 0;
  for (let i = 0; i < count; i++) grey[i] /= m;
  const dg = (i: number) => grey[i + 1] - grey[i - 1];
  // The steepest step within 1.5 px of the fitted line.
  let best = K;
  for (let i = K - 3; i <= K + 3; i++) {
    if (Math.abs(dg(i)) > Math.abs(dg(best))) best = i;
  }
  const g0 = dg(best);
  if (g0 === 0) return 0;
  const steps = Math.ceil(reach / PROFILE_STEP_PX);
  for (let j = 1; j <= steps; j++) {
    const i = best + j;
    if (i > count - 2 - 4) break;
    const g = dg(i);
    if (Math.sign(g) === Math.sign(g0)) continue;
    if (Math.abs(g) < RIM_MIN_FRACTION * Math.abs(g0)) continue;
    if (
      Math.abs(dg(i - 1)) > Math.abs(g) ||
      Math.abs(dg(i + 1)) > Math.abs(g)
    ) {
      continue;
    }
    let zero = i;
    for (let z = best; z < i; z++) {
      const p = dg(z);
      const q = dg(z + 1);
      if (Math.sign(p) !== Math.sign(q) && p !== q) {
        zero = z + p / (p - q);
        break;
      }
    }
    // The band must be LIGHTER than both the card and the table (a rim
    // catching light); a dark valley there is the table's texture (L7's
    // maze scene: a dark mat strip, then a red line, 2 px out).
    const band = grey[Math.round(zero)];
    const inside = grey[Math.max(0, best - 4)];
    const outside = grey[Math.min(count - 1, i + 4)];
    if (
      band - inside < RIM_MIN_BAND_STEP ||
      band - outside < RIM_MIN_BAND_STEP
    ) {
      return 0;
    }
    const a2 = Math.abs(dg(i - 1));
    const b2 = Math.abs(g);
    const c2 = Math.abs(dg(i + 1));
    const den = a2 - 2 * b2 + c2;
    const lobe =
      i +
      (den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a2 - c2)) / den)) : 0);
    return Math.max(0, ((zero + lobe) / 2 - K) * PROFILE_STEP_PX);
  }
  return 0;
}
