/**
 * Scan Lab (L11, 2026-11-04): find a card by its STRAIGHT EDGES inside a
 * small search box, for the case the colour-region and edge-component
 * finders (`coarse.ts`) cannot handle: a dark card on a dark patterned mat.
 * Lab only; every threshold here is candidate (未拍板).
 *
 * Kirby's 2026-11-03 photos (G0, G-LC hand mode, card only): a black card
 * (about (63, 64, 68)) in the card slot on the red and black maze mat, whose
 * darker part is about (72, 66, 65). The card's colour region merged with the
 * mat (a region running to the frame), and the maze joins every edge pixel of
 * the frame into one component, so neither finder had a card-sized outline.
 * The card's sides are still the longest straight, unbroken edges in the
 * slot (its bevelled rim catches light all round: 20-40 grey levels per px),
 * while the maze is many shorter turns. Measured on those photos, a
 * per-pixel gradient direction is useless there: along the card's top edge
 * it scattered 65-128 deg (the rim, JPEG noise and maze lines within 2 px),
 * so a direction-voting Hough found the card's sides with 50-100 votes out
 * of 245-360 px. Instead, inside the box only:
 *
 * 1. A Radon transform of the SIGNED directional derivative: for every
 *    line normal (1 deg steps) and offset (1 px), the sum along the line of
 *    the grey gradient projected on that normal (`gx cos + gy sin`), summed
 *    over 3 neighbouring offsets (a blurred edge spans 2-3 px). A straight
 *    step adds up over its whole length; texture of any other direction,
 *    and noise, mostly cancel. The `LINE_MAX_PEAKS` strongest lines
 *    (non-maximum suppressed) are kept, each with its polarity.
 * 2. Per line, a profile along it: at each px, the derivative across the
 *    line with the line's polarity, summed over 3 px across and averaged
 *    over 5 px along; "backed" where at least `LINE_MIN_STEP`.
 * 3. Every two pairs of nearly parallel lines (`LINE_PAIR_MAX_ANGLE_DEG`)
 *    whose directions cross at `LINE_MIN_CROSS_DEG` or more make a quad;
 *    quads that are convex, inside the box, of a card's pixel aspect and a
 *    plausible size are kept when EVERY side's middle 70 % is at least
 *    `LINE_MIN_SIDE_SUPPORT` backed.
 * 4. A card's edge stops at its (rounded) corners; a maze line or a table
 *    edge runs on. A side whose line is backed past BOTH its corners
 *    (`LINE_MAX_RUN_ON`) is not a card's side; the score is the weakest
 *    side's support minus how much the lines run on.
 *
 * The quads found here are only coarse outlines: `detectCard` refines them
 * (`refine.ts`) and they must pass the no-sheet checks there (shape on its
 * plane, rounded corners, clean sides, size), like any other candidate.
 *
 * Coordinates: full-image px (pixel centres at +0.5), as `detectCard`.
 */
import type { Point2 } from "../../geometry/homography";
import { isConvexQuad, orderQuadCorners } from "../../paper/quad-math";
import { scoreQuadAsCard } from "../../photo/card";
import type { PixelRect, Quad } from "./coarse";
import { downscaleImage, type RgbaImage } from "./image";

/** The box is searched on a copy box-averaged down until its long edge is at most this, px. Candidate 未拍板. */
export const LINE_MAX_LONG_EDGE_PX = 400;
/** Pixels whose grey gradient is under this (grey levels per px) add nothing to the transform (flat). Candidate 未拍板. */
export const LINE_GRAD_FLOOR = 2;
/** Strongest lines kept from the transform. Candidate 未拍板. */
export const LINE_MAX_PEAKS = 60;
/** A profile point is backed when the step across the line, with its polarity, is at least this many grey levels. Candidate 未拍板. */
export const LINE_MIN_STEP = 6;
/** Two lines are a parallel pair when their directions differ by at most this, degrees (perspective). Candidate 未拍板. */
export const LINE_PAIR_MAX_ANGLE_DEG = 12;
/** The two pairs must cross at least this steeply, degrees. Candidate 未拍板. */
export const LINE_MIN_CROSS_DEG = 55;
/** Every side needs at least this share of its middle 70 % backed. Candidate 未拍板. */
export const LINE_MIN_SIDE_SUPPORT = 0.75;
/** A side backed past both its corners (5-25 % of its length out) by at least this share is a line running on, not a card's side. Candidate 未拍板. */
export const LINE_MAX_RUN_ON = 0.6;
/** L12: a stretch beyond a corner needs at least this share inside the box to be judged; less is unknown and counts as running on. Candidate 未拍板. */
export const LINE_MIN_SEEN = 0.5;
/** Quads returned, best score first. Candidate 未拍板. */
export const LINE_MAX_QUADS = 4;

/** What a box search needs besides the image. */
export interface LineSearchOptions {
  /** Shortest acceptable long side, full-image px. */
  readonly minLongPx: number;
  /** Longest acceptable long side, full-image px. */
  readonly maxLongPx: number;
  /** `scoreQuadAsCard` must be at most this. */
  readonly aspectTolerance: number;
}

/** One quad from `findCardByLines`, full-image px, TL, TR, BR, BL. */
export interface LineQuad {
  readonly quad: Quad;
  /** Lowest per-side support (0-1). */
  readonly minSupport: number;
  /** Mean per-side run-on past the corners (0-1). */
  readonly runOn: number;
  readonly score: number;
}

interface Line {
  /** Normal angle, radians, [0, pi). */
  readonly theta: number;
  readonly rho: number;
  /** The transform's value: sign = polarity (grey rising along +normal). */
  readonly value: number;
}

const DEG = Math.PI / 180;

/** Axial (mod pi) difference of two angles, radians, in [0, pi/2]. */
function axialDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

/** Grey (mean of R, G, B) smoothed 3x3 binomial, then Sobel / 8: grey levels per px. */
function greyGradient(img: RgbaImage): {
  readonly gx: Float32Array;
  readonly gy: Float32Array;
} {
  const { width: w, height: h, data } = img;
  const g = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) {
    g[k] = (data[k * 4] + data[k * 4 + 1] + data[k * 4 + 2]) / 3;
  }
  const tmp = new Float32Array(w * h);
  const sm = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : 0;
      const xr = x < w - 1 ? x + 1 : w - 1;
      tmp[y * w + x] = (g[y * w + xl] + 2 * g[y * w + x] + g[y * w + xr]) / 4;
    }
  }
  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? y - 1 : 0;
    const yd = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      sm[y * w + x] =
        (tmp[yu * w + x] + 2 * tmp[y * w + x] + tmp[yd * w + x]) / 4;
    }
  }
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      gx[k] =
        (sm[k - w + 1] +
          2 * sm[k + 1] +
          sm[k + w + 1] -
          sm[k - w - 1] -
          2 * sm[k - 1] -
          sm[k + w - 1]) /
        8;
      gy[k] =
        (sm[k + w - 1] +
          2 * sm[k + w] +
          sm[k + w + 1] -
          sm[k - w - 1] -
          2 * sm[k - w] -
          sm[k - w + 1]) /
        8;
    }
  }
  return { gx, gy };
}

/**
 * Card-shaped quads from straight lines inside `region` (full-image px),
 * best first; empty when none passes. See the module comment. Pure.
 */
export function findCardByLines(
  image: RgbaImage,
  region: PixelRect,
  options: LineSearchOptions,
): LineQuad[] {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(image.width, Math.ceil(region.x + region.width));
  const y1 = Math.min(image.height, Math.ceil(region.y + region.height));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw < 16 || ch < 16) return [];
  const crop = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const from = ((y0 + y) * image.width + x0) * 4;
    crop.set(image.data.subarray(from, from + cw * 4), y * cw * 4);
  }
  const factor = Math.max(
    1,
    Math.ceil(Math.max(cw, ch) / LINE_MAX_LONG_EDGE_PX),
  );
  const img = downscaleImage({ data: crop, width: cw, height: ch }, factor);
  const { width: w, height: h } = img;
  const { gx, gy } = greyGradient(img);

  // 1. Radon transform of the signed derivative across each line.
  const nTheta = 180;
  const diag = Math.ceil(Math.hypot(w, h)) + 2;
  const nRho = 2 * diag + 1;
  const acc = new Float32Array(nTheta * nRho);
  const cosT = new Float32Array(nTheta);
  const sinT = new Float32Array(nTheta);
  for (let t = 0; t < nTheta; t++) {
    cosT[t] = Math.cos(t * DEG);
    sinT[t] = Math.sin(t * DEG);
  }
  const floor2 = LINE_GRAD_FLOOR * LINE_GRAD_FLOOR;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      const ax = gx[k];
      const ay = gy[k];
      if (ax * ax + ay * ay < floor2) continue;
      const px = x + 0.5;
      const py = y + 0.5;
      for (let t = 0; t < nTheta; t++) {
        const c = cosT[t];
        const s = sinT[t];
        const r = Math.round(px * c + py * s) + diag;
        acc[t * nRho + r] += ax * c + ay * s;
      }
    }
  }
  const sum = new Float32Array(nTheta * nRho);
  for (let t = 0; t < nTheta; t++) {
    for (let r = 1; r < nRho - 1; r++) {
      const o = t * nRho + r;
      sum[o] = acc[o - 1] + acc[o] + acc[o + 1];
    }
  }
  const peaks: Line[] = [];
  for (let t = 0; t < nTheta; t++) {
    for (let r = 1; r < nRho - 1; r++) {
      const v = Math.abs(sum[t * nRho + r]);
      if (v === 0) continue;
      let isMax = true;
      for (let dt = -2; dt <= 2 && isMax; dt++) {
        const tt = (t + dt + nTheta) % nTheta;
        // Past 0 or 180 deg the same line has its offset negated.
        const wrapped = t + dt < 0 || t + dt >= nTheta;
        for (let dr = -3; dr <= 3 && isMax; dr++) {
          if (dt === 0 && dr === 0) continue;
          const rr = wrapped ? nRho - 1 - r + dr : r + dr;
          if (rr < 0 || rr >= nRho) continue;
          const o = Math.abs(sum[tt * nRho + rr]);
          if (o > v || (o === v && (dt < 0 || (dt === 0 && dr < 0)))) {
            isMax = false;
          }
        }
      }
      if (isMax) {
        peaks.push({ theta: t * DEG, rho: r - diag, value: sum[t * nRho + r] });
      }
    }
  }
  peaks.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const lines = peaks.slice(0, LINE_MAX_PEAKS);

  // 2. Per line, which positions along it (1 px steps, parameter s along
  // the line's direction (-sin, cos) from its foot rho*n) are backed;
  // prefix sums make any stretch's share O(1).
  interface Profile {
    readonly nx: number;
    readonly ny: number;
    readonly s0: number;
    readonly prefix: Int32Array;
    readonly valid: Int32Array;
  }
  const span = Math.ceil(Math.hypot(w, h));
  const profiles: Profile[] = lines.map((line) => {
    const nx = Math.cos(line.theta);
    const ny = Math.sin(line.theta);
    const pol = line.value >= 0 ? 1 : -1;
    const s0 = -span;
    const n = 2 * span + 1;
    const step = new Float32Array(n);
    const inside = new Uint8Array(n);
    const across = (px: number, py: number) => {
      const xx = Math.floor(px);
      const yy = Math.floor(py);
      if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) return 0;
      const k = yy * w + xx;
      return pol * (gx[k] * nx + gy[k] * ny);
    };
    for (let i = 0; i < n; i++) {
      const sv = s0 + i;
      const px = line.rho * nx - ny * sv;
      const py = line.rho * ny + nx * sv;
      if (px < 2 || py < 2 || px > w - 2 || py > h - 2) continue;
      inside[i] = 1;
      // The 3-px sum across the line, best of offsets -1, 0, +1 (the line
      // may sit a px off a slightly curved or blurred edge).
      let best = -Infinity;
      for (let c = -1; c <= 1; c++) {
        let v = 0;
        for (let o = c - 1; o <= c + 1; o++) {
          v += across(px + nx * o, py + ny * o);
        }
        if (v > best) best = v;
      }
      step[i] = best;
    }
    const prefix = new Int32Array(n + 1);
    const valid = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      let m = 0;
      let cnt = 0;
      for (let j = i - 2; j <= i + 2; j++) {
        if (j < 0 || j >= n || !inside[j]) continue;
        m += step[j];
        cnt++;
      }
      const hit = inside[i] && cnt > 0 && m / cnt >= LINE_MIN_STEP ? 1 : 0;
      prefix[i + 1] = prefix[i] + hit;
      valid[i + 1] = valid[i] + inside[i];
    }
    return { nx, ny, s0, prefix, valid };
  });
  /**
   * Share of the stretch s in [sa, sb] backed (positions outside the box do
   * not count). L12: `unknown` (NaN) when less than `LINE_MIN_SEEN` of the
   * stretch is inside the box: a corner at the box's edge cannot show
   * whether its line runs on, and is no longer taken as "it stops".
   */
  const share = (pr: Profile, sa: number, sb: number): number => {
    const n = pr.prefix.length - 1;
    const lo = Math.max(0, Math.min(n, Math.round(Math.min(sa, sb) - pr.s0)));
    const hi = Math.max(0, Math.min(n, Math.round(Math.max(sa, sb) - pr.s0)));
    const v = pr.valid[hi] - pr.valid[lo];
    const want = Math.max(1, Math.abs(sb - sa));
    if (v < LINE_MIN_SEEN * want) return Number.NaN;
    return (pr.prefix[hi] - pr.prefix[lo]) / v;
  };
  const along = (pr: Profile, p: Point2) => -pr.ny * p.x + pr.nx * p.y;

  // 3. Parallel pairs, then two pairs crossing.
  const pairs: [number, number][] = [];
  const minGap = options.minLongPx / factor / 1.586 / 1.6;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i];
      const b = lines[j];
      if (axialDiff(a.theta, b.theta) > LINE_PAIR_MAX_ANGLE_DEG * DEG) continue;
      // Offsets compared along a's normal (b's flipped to the same sense).
      const same = Math.cos(a.theta - b.theta) >= 0;
      const rb = same ? b.rho : -b.rho;
      if (Math.abs(a.rho - rb) < minGap) continue;
      pairs.push([i, j]);
    }
  }
  const meanTheta = (p: [number, number]) => {
    const a = lines[p[0]].theta;
    let b = lines[p[1]].theta;
    if (Math.abs(b - a) > Math.PI / 2) b += b < a ? Math.PI : -Math.PI;
    return (a + b) / 2;
  };
  const cross = (l: Line, m: Line): Point2 | null => {
    const det =
      Math.cos(l.theta) * Math.sin(m.theta) -
      Math.sin(l.theta) * Math.cos(m.theta);
    if (Math.abs(det) < 1e-9) return null;
    return {
      x: (l.rho * Math.sin(m.theta) - m.rho * Math.sin(l.theta)) / det,
      y: (m.rho * Math.cos(l.theta) - l.rho * Math.cos(m.theta)) / det,
    };
  };
  const toFull = (v: Point2): Point2 => ({
    x: x0 + v.x * factor,
    y: y0 + v.y * factor,
  });

  const out: LineQuad[] = [];
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const p = pairs[i];
      const q = pairs[j];
      if (axialDiff(meanTheta(p), meanTheta(q)) < LINE_MIN_CROSS_DEG * DEG) {
        continue;
      }
      // Sides in order around the quad: p0, q0, p1, q1; corner k is where
      // side k-1 meets side k, so side k runs from corner k to corner k+1.
      const sides = [p[0], q[0], p[1], q[1]];
      const ring: Point2[] = [];
      for (let k = 0; k < 4; k++) {
        const c = cross(lines[sides[(k + 3) % 4]], lines[sides[k]]);
        if (!c) break;
        ring.push(c);
      }
      if (ring.length < 4) continue;
      if (ring.some((v) => v.x < 0 || v.y < 0 || v.x > w || v.y > h)) {
        continue;
      }
      const quad: Quad = [ring[0], ring[1], ring[2], ring[3]];
      if (!isConvexQuad(quad)) continue;
      const full: Quad = [
        toFull(ring[0]),
        toFull(ring[1]),
        toFull(ring[2]),
        toFull(ring[3]),
      ];
      const score = scoreQuadAsCard(full);
      if (score === null || score > options.aspectTolerance) continue;
      const l = (k: number) =>
        Math.hypot(
          full[(k + 1) % 4].x - full[k].x,
          full[(k + 1) % 4].y - full[k].y,
        );
      const longPx = Math.max((l(0) + l(2)) / 2, (l(1) + l(3)) / 2);
      if (longPx < options.minLongPx || longPx > options.maxLongPx) continue;
      let minSupport = 1;
      let runOn = 0;
      let runsThrough = false;
      for (let k = 0; k < 4 && minSupport >= LINE_MIN_SIDE_SUPPORT; k++) {
        const pr = profiles[sides[k]];
        const sa = along(pr, ring[k]);
        const sb = along(pr, ring[(k + 1) % 4]);
        const L = sb - sa;
        const sup = share(pr, sa + 0.15 * L, sa + 0.85 * L);
        minSupport = Math.min(minSupport, Number.isNaN(sup) ? 0 : sup);
        // L12: a stretch the box does not show counts as running on.
        const seen = (v: number) => (Number.isNaN(v) ? 1 : v);
        const before = seen(share(pr, sa - 0.25 * L, sa - 0.05 * L));
        const after = seen(share(pr, sb + 0.05 * L, sb + 0.25 * L));
        runOn += (before + after) / 8;
        if (before >= LINE_MAX_RUN_ON && after >= LINE_MAX_RUN_ON) {
          runsThrough = true;
        }
      }
      if (minSupport < LINE_MIN_SIDE_SUPPORT || runsThrough) continue;
      out.push({
        quad: orderQuadCorners(full),
        minSupport,
        runOn,
        score: minSupport - runOn,
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  // Drop near-duplicates (the same card from neighbouring lines: the rim's
  // two edges, or neighbouring transform peaks).
  const kept: LineQuad[] = [];
  for (const c of out) {
    const dup = kept.some((k) =>
      k.quad.every(
        (v, i) =>
          Math.hypot(v.x - c.quad[i].x, v.y - c.quad[i].y) <= 6 * factor,
      ),
    );
    if (!dup) kept.push(c);
    if (kept.length >= LINE_MAX_QUADS) break;
  }
  return kept;
}
