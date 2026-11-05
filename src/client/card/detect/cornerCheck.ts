/**
 * Scan Lab (L7, 2026-11-02): are a fitted quad's corners ROUNDED like an
 * ID-1 card's? Lab only; every threshold here is candidate (未拍板).
 *
 * Why: with no sheet in view there is no size check, and on Kirby's
 * first-round photos (19-41-14, 19-41-48: no card at all) the white sheet
 * plus a strip of dark mat below it made a rectangle with a card's
 * proportions on the table, with four clean straight sides. Its top corners
 * are the sheet's: sharp. Every ID-1 card has corners of radius 3.18 mm
 * (ISO/IEC 7810), so just inside the intersection of two fitted sides, in
 * the "notch" between the sharp corner and the arc, a card shows the
 * BACKGROUND's colour, and a sharp-cornered rectangle shows its own.
 *
 * Per corner, three colours (each the mean of 3 bilinear samples):
 * - inside `I`: 1.2 radii in along both sides (on the card, past the arc);
 * - notch `N`: 0.15 radii in along both sides (0.65 mm short of the arc
 *   along the diagonal, so about 1.4-2.7 px at Kirby's 2.2-4.2 px/mm);
 * - outside `O`: 0.6 radii out along both sides.
 * With `|I - O|` (RGB distance) at least `CORNER_MIN_CONTRAST`, the corner is
 * `sharp` when the notch looks like the inside (`|N - I|` under
 * `SHARP_MAX_FRACTION` of `|I - O|`) and `rounded` when it does not
 * (`|N - I|` at least `ROUNDED_MIN_FRACTION` of it); otherwise, or with too
 * little contrast, `unknown`.
 *
 * Coordinates: image px (pixel centres at +0.5), quad TL, TR, BR, BL.
 */
import type { Point2 } from "../../geometry/homography";
import type { Quad } from "./coarse";
import { sampleRgb, type RgbaImage } from "./image";
import { CARD_CORNER_RADIUS_MM, cardSideLengthsMm } from "./refine";

/** Inside and outside must differ by at least this (RGB distance) for a corner to be judged. Candidate 未拍板. */
export const CORNER_MIN_CONTRAST = 40;
/** `|N - I|` under this fraction of `|I - O|`: sharp. Candidate 未拍板. */
export const SHARP_MAX_FRACTION = 0.35;
/** `|N - I|` at least this fraction of `|I - O|`: rounded. Candidate 未拍板. */
export const ROUNDED_MIN_FRACTION = 0.5;

export type CornerShape = "rounded" | "sharp" | "unknown";

/** Per corner (TL, TR, BR, BL), what the notch shows. Pure. */
export function cornerShapes(
  img: RgbaImage,
  quad: Quad,
): readonly CornerShape[] {
  const sideMm = cardSideLengthsMm(quad);
  const c = [0, 0, 0];
  const mean = (pts: readonly Point2[]) => {
    const s = [0, 0, 0];
    for (const p of pts) {
      sampleRgb(img, p.x, p.y, c);
      s[0] += c[0];
      s[1] += c[1];
      s[2] += c[2];
    }
    return s.map((v) => v / pts.length);
  };
  const dist = (a: number[], b: number[]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const out: CornerShape[] = [];
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    const next = quad[(i + 1) % 4];
    const prev = quad[(i + 3) % 4];
    const lu = Math.hypot(next.x - p.x, next.y - p.y);
    const lv = Math.hypot(prev.x - p.x, prev.y - p.y);
    if (lu < 1e-6 || lv < 1e-6) {
      out.push("unknown");
      continue;
    }
    // One corner radius along each side, px (each side's own scale).
    const ru = (CARD_CORNER_RADIUS_MM * lu) / sideMm[i];
    const rv = (CARD_CORNER_RADIUS_MM * lv) / sideMm[(i + 3) % 4];
    const u = { x: (next.x - p.x) / lu, y: (next.y - p.y) / lu };
    const v = { x: (prev.x - p.x) / lv, y: (prev.y - p.y) / lv };
    const at = (k: number): Point2[] => {
      const base = {
        x: p.x + k * (ru * u.x + rv * v.x),
        y: p.y + k * (ru * u.y + rv * v.y),
      };
      // Three samples spread across the diagonal (+/- 0.5 px).
      const w = { x: u.x - v.x, y: u.y - v.y };
      const wl = Math.hypot(w.x, w.y) || 1;
      return [-0.5, 0, 0.5].map((t) => ({
        x: base.x + (t * w.x) / wl,
        y: base.y + (t * w.y) / wl,
      }));
    };
    const I = mean(at(1.2));
    const N = mean(at(0.15));
    const O = mean(at(-0.6));
    const contrast = dist(I, O);
    if (contrast < CORNER_MIN_CONTRAST) {
      out.push("unknown");
      continue;
    }
    const ni = dist(N, I);
    out.push(
      ni < SHARP_MAX_FRACTION * contrast
        ? "sharp"
        : ni >= ROUNDED_MIN_FRACTION * contrast
          ? "rounded"
          : "unknown",
    );
  }
  return out;
}

/**
 * L11 (2026-11-04): the straight edge must be at least this strong (grey
 * levels per px, the mean along 1.6-2.6 radii from the corner) for
 * `cornerEdgeShapes` to judge a side. Candidate 未拍板.
 */
export const EDGE_CORNER_MIN_STEP = 4;
/** L12: extra reach (px) either side of the fitted line for `cornerEdgeShapes`' steps. Candidate 未拍板. */
export const EDGE_LINE_SLACK_PX = 2;
/** `cornerEdgeShapes`: notch / straight at least this: sharp. Candidate 未拍板. */
export const EDGE_SHARP_MIN_RATIO = 0.6;
/** `cornerEdgeShapes`: notch / straight at most this: rounded. Candidate 未拍板. */
export const EDGE_ROUNDED_MAX_RATIO = 0.35;

function greyAt(img: RgbaImage, x: number, y: number, c: number[]): number {
  sampleRgb(img, x, y, c);
  return (c[0] + c[1] + c[2]) / 3;
}

/**
 * L11 (2026-11-04): per corner (TL, TR, BR, BL), the same question as
 * `cornerShapes` asked of the EDGES instead of the colours, for a card
 * whose colour is too close to the table's (Kirby's black card on the dark
 * maze mat: inside and outside about 10 apart, so `cornerShapes` says
 * `unknown` everywhere). A straight side of a sharp-cornered rectangle
 * keeps its edge right up to the corner; a card's side leaves its line
 * where the arc begins (radius r = 3.18 mm), the arc being 0.29-0.69 r off
 * the line over 0.05-0.3 r from the corner. Per side of the corner: the
 * grey step across the side's line (polarity from the straight part) along
 * 0.05-0.3 r, the best within +/- max(1, 0.12 r) px of the line, against
 * the step along the straight part 1.6-2.6 r out; the corner's ratio is
 * the mean of its two sides'. `sharp` at `EDGE_SHARP_MIN_RATIO` or more,
 * `rounded` at `EDGE_ROUNDED_MAX_RATIO` or less, `unknown` between or when
 * a straight part is weaker than `EDGE_CORNER_MIN_STEP`. Pure.
 */
export function cornerEdgeShapes(
  img: RgbaImage,
  quad: Quad,
): readonly CornerShape[] {
  const sideMm = cardSideLengthsMm(quad);
  const c = [0, 0, 0];
  const out: CornerShape[] = [];
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    const ends = [
      { to: quad[(i + 1) % 4], mm: sideMm[i] },
      { to: quad[(i + 3) % 4], mm: sideMm[(i + 3) % 4] },
    ];
    const ratios: number[] = [];
    for (const e of ends) {
      const L = Math.hypot(e.to.x - p.x, e.to.y - p.y);
      if (L < 1e-6) break;
      const d = { x: (e.to.x - p.x) / L, y: (e.to.y - p.y) / L };
      const n = { x: -d.y, y: d.x };
      const r = (CARD_CORNER_RADIUS_MM * L) / e.mm;
      // Step across the line at distance t along it, offset o across.
      const step = (t: number, o: number) => {
        const bx = p.x + d.x * t + n.x * o;
        const by = p.y + d.y * t + n.y * o;
        return (
          (greyAt(img, bx + n.x, by + n.y, c) -
            greyAt(img, bx - n.x, by - n.y, c)) /
          2
        );
      };
      const win = Math.max(1, 0.12 * r);
      // L12: the straight part's step is read where it is strongest within
      // `EDGE_LINE_SLACK_PX` of the line (a side fitted on a light rim's
      // outer side, refine.ts, is off the steepest step), and the notch
      // around that same offset (a wider notch window took maze lines next
      // to Kirby's black card for its edge and called rounded corners sharp).
      let straight = 0;
      let at = 0;
      for (
        let o = -EDGE_LINE_SLACK_PX;
        o <= EDGE_LINE_SLACK_PX + 1e-9;
        o += 0.5
      ) {
        let sum = 0;
        let count = 0;
        for (let t = 1.6 * r; t <= 2.6 * r; t += 1) {
          sum += step(t, o);
          count++;
        }
        const mean = sum / Math.max(1, count);
        if (Math.abs(mean) > Math.abs(straight)) {
          straight = mean;
          at = o;
        }
      }
      if (Math.abs(straight) < EDGE_CORNER_MIN_STEP) break;
      const pol = straight > 0 ? 1 : -1;
      let notch = 0;
      let count = 0;
      for (let t = 0.05 * r; t <= 0.3 * r; t += 0.5) {
        let best = -Infinity;
        for (let o = at - win; o <= at + win + 1e-9; o += 0.5) {
          best = Math.max(best, pol * step(t, o));
        }
        notch += Math.max(0, best);
        count++;
      }
      notch /= Math.max(1, count);
      ratios.push(notch / Math.abs(straight));
    }
    if (ratios.length < 2) {
      out.push("unknown");
      continue;
    }
    const ratio = (ratios[0] + ratios[1]) / 2;
    out.push(
      ratio >= EDGE_SHARP_MIN_RATIO
        ? "sharp"
        : ratio <= EDGE_ROUNDED_MAX_RATIO
          ? "rounded"
          : "unknown",
    );
  }
  return out;
}

/** L12: depth of the notch sample, in corner radii along both sides. Candidate 未拍板. */
export const ROUNDING_NOTCH_DEPTH_RADII = 0.2;
/**
 * L12: with no sheet, a quad none of whose judged corners shows at least
 * this rounding margin (`cornerRoundingMargins`) is not a card. Data (L12
 * synthetic set, 2026-11-04, no-sheet answers at d2d1b42e): the 9
 * sharp-cornered ID-1-size rectangles (cut from Kirby's real card, corners
 * squared) taken for a card had a best corner of -0.01 to 0.10; the 374
 * real cards found had a best corner of 0.20 or more, and on Kirby's photos
 * (102 cards found with no sheet, 5 rounds + hand photos) 0.38 or more.
 * Candidate 未拍板.
 */
export const MIN_BEST_ROUNDING_MARGIN = 0.18;

/**
 * L12 (2026-11-04): per corner (TL, TR, BR, BL), how much less of the
 * card the notch shows than a SHARP corner would under the same blur, or
 * null when the corner's inside and outside are too close in colour
 * (`CORNER_MIN_CONTRAST`). `cornerShapes` reads the notch against fixed
 * fractions, and on small, blurred cards (corner radius 5-9 px, blur sigma
 * 1.5-2 px) a sharp rectangle's notch is half background too: the L12
 * synthetic set had 9 sharp ID-1 rectangles pass as cards. Here the blur is
 * measured: with `f(x)` the card fraction of a colour (its projection from
 * the outside colour O toward the inside colour I), each side's straight
 * part (1.6-2.6 radii from the corner, as `cornerEdgeShapes`) gives
 * `E = f` at the notch's depth inside that side; a sharp corner's notch
 * would read about `E_u x E_v` (a blurred quadrant), a rounded one's much
 * less (the notch is off the card). Margin = `E_u x E_v - f(notch)`.
 * Pure.
 */
export function cornerRoundingMargins(
  img: RgbaImage,
  quad: Quad,
  depthRadii: number = ROUNDING_NOTCH_DEPTH_RADII,
): readonly (number | null)[] {
  const sideMm = cardSideLengthsMm(quad);
  const c = [0, 0, 0];
  const at = (x: number, y: number) => {
    sampleRgb(img, x, y, c);
    return [c[0], c[1], c[2]];
  };
  const out: (number | null)[] = [];
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    const next = quad[(i + 1) % 4];
    const prev = quad[(i + 3) % 4];
    const lu = Math.hypot(next.x - p.x, next.y - p.y);
    const lv = Math.hypot(prev.x - p.x, prev.y - p.y);
    if (lu < 1e-6 || lv < 1e-6) {
      out.push(null);
      continue;
    }
    const ru = (CARD_CORNER_RADIUS_MM * lu) / sideMm[i];
    const rv = (CARD_CORNER_RADIUS_MM * lv) / sideMm[(i + 3) % 4];
    const u = { x: (next.x - p.x) / lu, y: (next.y - p.y) / lu };
    const v = { x: (prev.x - p.x) / lv, y: (prev.y - p.y) / lv };
    const w = { x: u.x - v.x, y: u.y - v.y };
    const wl = Math.hypot(w.x, w.y) || 1;
    const diag = (k: number) => {
      const s = [0, 0, 0];
      for (const t of [-0.5, 0, 0.5]) {
        const q = at(
          p.x + k * (ru * u.x + rv * v.x) + (t * w.x) / wl,
          p.y + k * (ru * u.y + rv * v.y) + (t * w.y) / wl,
        );
        s[0] += q[0] / 3;
        s[1] += q[1] / 3;
        s[2] += q[2] / 3;
      }
      return s;
    };
    const I = diag(1.2);
    const O = diag(-0.6);
    const io = [I[0] - O[0], I[1] - O[1], I[2] - O[2]];
    const c2 = io[0] * io[0] + io[1] * io[1] + io[2] * io[2];
    if (c2 < CORNER_MIN_CONTRAST * CORNER_MIN_CONTRAST) {
      out.push(null);
      continue;
    }
    const frac = (q: number[]) =>
      ((q[0] - O[0]) * io[0] + (q[1] - O[1]) * io[1] + (q[2] - O[2]) * io[2]) /
      c2;
    // Card fraction at depth `depth` inside the side running along `a`
    // (the card on the `b` side), read 1.6-2.6 radii from the corner.
    const straight = (
      a: { x: number; y: number },
      ra: number,
      b: { x: number; y: number },
      depth: number,
    ) => {
      let sum = 0;
      let n = 0;
      for (let t = 1.6 * ra; t <= 2.6 * ra + 1e-9; t += 1) {
        sum += frac(
          at(p.x + a.x * t + b.x * depth, p.y + a.y * t + b.y * depth),
        );
        n++;
      }
      return n > 0 ? sum / n : 0;
    };
    const eu = straight(u, ru, v, depthRadii * rv);
    const ev = straight(v, rv, u, depthRadii * ru);
    const notch = frac(
      at(
        p.x + depthRadii * (ru * u.x + rv * v.x),
        p.y + depthRadii * (ru * u.y + rv * v.y),
      ),
    );
    out.push(eu * ev - notch);
  }
  return out;
}

/**
 * L12: false when some corner could be judged and none of them shows a
 * card's rounding (`MIN_BEST_ROUNDING_MARGIN`); true otherwise (no corner
 * judged: the other no-sheet checks decide). Pure.
 */
export function showsRoundedCorner(img: RgbaImage, quad: Quad): boolean {
  const m = cornerRoundingMargins(img, quad).filter(
    (v): v is number => v !== null,
  );
  return m.length === 0 || Math.max(...m) >= MIN_BEST_ROUNDING_MARGIN;
}
