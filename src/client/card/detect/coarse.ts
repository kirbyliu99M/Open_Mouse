/**
 * Scan Lab card detector (L3a, 2026-10-29), step 1 of 2: COARSE location of
 * card-shaped outlines. `refine.ts` then fits the real edges; nothing here is
 * accurate to better than a few px, and nothing here is measured from.
 *
 * Why not the js-aruco2 candidate finder in `src/client/photo/card.ts`
 * (adaptive threshold + contour tracing + polygon approximation)? It was
 * built for a dark card on a white printed sheet. On the L3a synthetic scenes
 * (`tests/unit/lab-card-detect.test.ts`) it found a card on white paper but
 * missed it in most "card on the table beside the sheet" scenes — a blue card
 * on a grey table, any card with a magnetic stripe — so it cannot carry
 * placement (b). This finder works on colour gradients instead:
 *
 * 1. Colour gradient magnitude (`image.ts#colourGradientMagnitude`).
 * 2. Only pixels in the search area count (`buildSearchMask`): inside the
 *    sheet for placement (a), a band just outside it for (b), an explicit
 *    rectangle if given. The sheet's own edge is masked out in both, so a card
 *    touching the sheet does not merge with the sheet's outline.
 * 3. Hysteresis on the magnitude (thresholds scale with the area's median, so
 *    wood grain raises them) and 8-connected components of the result.
 * 4. Each component's (or joined pair's) convex hull, simplified to 4 vertices (Visvalingam).
 *    Those vertices sit somewhere on the rounded corners' arcs (10-17 px off
 *    on the L3a scenes), so 5. tightens them: per side, the OUTERMOST STRONG
 *    edge pixel (gradient at or above the strong threshold) at each position
 *    along the middle 70% of the side, a robust line
 *    through those, and the lines' intersections. Outermost, because a
 *    magnetic stripe runs the card's full length and joins its outline: its
 *    edges are as long and straight as the card's, but always inside.
 *    Strong only (L4, 2026-10-30): a faint grid line a few px outside the card
 *    joins the component through the weak threshold, and on Kirby's grid-paper
 *    photo it pulled the coarse top side 8 px out, past the refiner's window.
 *    Still coarse (the outer rim of the gradient band, 1-2 px outside the
 *    edge); `refine.ts` does the accurate fit.
 *
 * L5 (2026-10-30), for a card beside a known sheet (Kirby's photos of a dark
 * card back on a wood table, touching the sheet):
 * 6. Uniform colour regions are candidates too (`findColourRegions`): the
 *    card's edge against wood is barely stronger than the grain, so its edge
 *    component merges with grain lines, but its inside is one colour.
 * 7. A side lying along the masked band at the sheet's edge (the card
 *    touches the sheet there) is laid on the sheet's own edge line, and its
 *    edge support is not held against it (`abuttingLines`).
 *
 * L6 (2026-11-01), Kirby's third round (Toastmasters card back on a red and
 * black maze mouse mat): the card back has a glare toward one end that runs
 * from (61, 95, 159) to (169, 157, 203), about 120 grey levels, so the
 * colour region stops short of that end (`REGION_MEAN_TOLERANCE` 60) and its
 * quad's side cut across the card, up to 29 px inside the real edge, beyond
 * the refiner's window (08-44: coarse corner x 639 against 668). A region's
 * sides are therefore not taken from the region's own boundary but
 * 8. marched outward from it (`marchSidesOutward`) to the first STRONG edge
 *    pixel: the glare is a slow ramp (under 2 grey levels per px on the
 *    coarse copy), the card's edge a step (40-60), and the maze beyond the
 *    edge is never reached because the march stops at the first one.
 *
 * L7 (2026-11-02), Kirby's fifth round (a card front: red body, navy
 * "District 67" band along one long side, a thin gold line between): the
 * red colour region held only the body, so the outline missed the band and
 * the card measured about 9 % short across. So
 * 9. from each side's first edge the march reads the colour profile further
 *    out and notes every further edge; a distance where most positions meet
 *    one, with one colour just inside it that the region could not have
 *    taken in, is an outer line of that side (`marchSidesOutward`,
 *    `bandLines`). The candidate keeps them as `extensions` (the outline
 *    with that side moved out); `detectCard` tries them only when the
 *    region's own outline is the wrong size or shape.
 * And with `regionEdgeBarrier` a region stops at every pixel at or above the
 * weak threshold (the red card leaked into the red and black mat through
 * mat lines touching it); `detectCard` uses that only as a second try.
 *
 * Coordinates: image px of the image passed in (pixel centres at +0.5).
 */
import type { Point2 } from "../../geometry/homography";
import {
  convexHull,
  fitLineRansac,
  intersectLines,
  isConvexQuad,
  lineFromTwoPoints,
  mulberry32,
  orderQuadCorners,
  polygonArea,
  RANSAC_SEED,
  signedDistance,
  simplifyToQuad,
  type NormalLine,
} from "../../paper/quad-math";
import { pointInConvexQuad } from "../../paper/palmChoice";
import { colourGradientMagnitude, sampleRgb, type RgbaImage } from "./image";

/** Four corners in image px, TL, TR, BR, BL unless a comment says otherwise. */
export type Quad = readonly [Point2, Point2, Point2, Point2];

/** Where the card is expected relative to the sheet. */
export type CardPlacement = "on-paper" | "beside-paper";

/** An axis-aligned rectangle in image px. */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where `buildSearchMask` lets the card search look; every point is image px of the image searched. */
export interface SearchArea {
  /** The sheet's 4 corners (any start, either winding), image px; omitted = no sheet constraint. */
  readonly paperCorners?: Quad | null;
  /** Needed for the sheet constraint to apply; without it only the sheet's own edge is masked out. */
  readonly placement?: CardPlacement;
  /** Further limit the search to this rectangle. */
  readonly searchRegion?: PixelRect | null;
}

/** Pixels this close to the sheet's edge are ignored (fraction of the sheet's diagonal, floor 3 px). Candidate 未拍板. */
export const PAPER_EDGE_MARGIN_FRACTION = 0.01;
/** Placement (b): the card must lie within this distance of the sheet (fraction of the sheet's long side). Candidate 未拍板. */
export const BESIDE_PAPER_REACH_FRACTION = 0.6;

/**
 * How far (image px) from the sheet's outline the card search stops: the
 * sheet's own edge is that wide a band in the gradient map. Shared by
 * `buildSearchMask` and the abutting-side handling in `findCoarseCandidates`.
 */
export function paperEdgeMarginPx(paperCorners: Quad): number {
  const paper = orderQuadCorners(paperCorners);
  const diag = Math.hypot(paper[2].x - paper[0].x, paper[2].y - paper[0].y);
  return Math.max(3, PAPER_EDGE_MARGIN_FRACTION * diag);
}

function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from `p` to the quad's outline, image px. */
export function distanceToQuadOutline(p: Point2, q: Quad): number {
  let d = Infinity;
  for (let i = 0; i < 4; i++) {
    d = Math.min(d, distanceToSegment(p, q[i], q[(i + 1) % 4]));
  }
  return d;
}

/**
 * 1 for every pixel the card search may use, 0 elsewhere (row-major,
 * `width*height`). See the module comment for the rules.
 */
export function buildSearchMask(
  width: number,
  height: number,
  area: SearchArea,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const paper = area.paperCorners ? orderQuadCorners(area.paperCorners) : null;
  let margin = 0;
  let reach = Infinity;
  if (paper) {
    margin = paperEdgeMarginPx(paper);
    const sides = [0, 1, 2, 3].map((i) =>
      Math.hypot(
        paper[(i + 1) % 4].x - paper[i].x,
        paper[(i + 1) % 4].y - paper[i].y,
      ),
    );
    reach = BESIDE_PAPER_REACH_FRACTION * Math.max(...sides);
  }
  const r = area.searchRegion ?? null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        r &&
        (x + 0.5 < r.x ||
          x + 0.5 > r.x + r.width ||
          y + 0.5 < r.y ||
          y + 0.5 > r.y + r.height)
      ) {
        continue;
      }
      if (paper) {
        const p = { x: x + 0.5, y: y + 0.5 };
        const d = distanceToQuadOutline(p, paper);
        if (d < margin) continue;
        if (area.placement) {
          const inside = pointInConvexQuad(p, paper);
          if (area.placement === "on-paper" && !inside) continue;
          if (area.placement === "beside-paper" && (inside || d > reach)) {
            continue;
          }
        }
      }
      mask[y * width + x] = 1;
    }
  }
  return mask;
}

/** Floor of the strong hysteresis threshold, grey levels per px. Candidate 未拍板. */
export const EDGE_HIGH_MIN = 10;
/** Strong threshold = this x the search area's median gradient (if higher than the floor). Candidate 未拍板. */
export const EDGE_HIGH_PER_MEDIAN = 5;
/** Weak threshold as a fraction of the strong one (floor 4). Candidate 未拍板. */
export const EDGE_LOW_FRACTION = 0.4;
/** Components with fewer edge pixels are dropped before any shape test. */
export const MIN_COMPONENT_PIXELS = 30;

/**
 * Colour regions (L5, 2026-10-30): a neighbour joins a region when its
 * smoothed colour differs from the pixel that reached it by at most this
 * (RGB distance, grey levels). Candidate 未拍板.
 */
export const REGION_LOCAL_TOLERANCE = 8;
/**
 * ...and from the region's mean colour so far by at most this. The mean, not
 * the seed, because light falls off across a card (the Toastmasters card back
 * on Kirby's 08-38-50 photo spans 52 grey levels top to bottom), while wood
 * next to it is about 107 away. Candidate 未拍板.
 */
export const REGION_MEAN_TOLERANCE = 60;
/** Regions with fewer pixels (of the image searched) are not tried. Candidate 未拍板. */
export const REGION_MIN_PIXELS = 300;
/** Regions over this share of the search area are table or sheet, not a card. Candidate 未拍板. */
export const REGION_MAX_AREA_FRACTION = 0.25;
/**
 * A region must cover at least this share of its own quad: a card back's
 * logo leaves holes (about 10 % on the Toastmasters card back), a strip of
 * wood between two grain lines whose hull happens to be card-shaped leaves
 * far more. Candidate 未拍板.
 */
export const REGION_MIN_FILL = 0.6;
/**
 * A side of a candidate is taken to lie along the sheet's edge (the card
 * touches the sheet there) when both its ends are within the masked band
 * plus this many px of a sheet side's line and it runs within
 * `ABUT_MAX_ANGLE_DEG` of it. Candidate 未拍板.
 */
export const ABUT_SLACK_PX = 3;
export const ABUT_MAX_ANGLE_DEG = 6;

/** One card-shaped (or not) outline found by `findCoarseCandidates`; image px of the image searched. */
export interface CoarseCandidate {
  /** The tightened quad (step 5), ordered TL, TR, BR, BL; image px. Falls back to `hullQuad` when tightening fails. */
  readonly quad: Quad;
  /** The hull simplified to 4 vertices (step 4), same order: outline vertices on the rounded corners. Diagnostic (the "contour vertex" baseline). */
  readonly hullQuad: Quad;
  /** Edge pixels in the component (for a colour region: its pixels). */
  readonly pixelCount: number;
  /** The component reaches within 2 px of the frame border. Not by itself a cut-off card: `detectCard` also asks whether the quad reaches the border. */
  readonly touchesBorder: boolean;
  /**
   * Fraction (0-1) of points along the quad's 4 sides, away from its corners,
   * that have an edge pixel within 2 px: a real card outline is closed, a
   * random texture blob whose hull happens to be card-shaped is not. A point
   * inside the masked band along the sheet's edge counts as backed (the mask
   * hid it; see `abutsPaper`).
   */
  readonly edgeSupport: number;
  /** 1 for a single edge component, 2 for two nearby pieces joined. */
  readonly piecesJoined: 1 | 2;
  /** `edge`: an edge component (steps 1-5); `region`: a uniform colour region (L5). */
  readonly source: "edge" | "region";
  /** Per side (TL-TR, TR-BR, BR-BL, BL-TL): `true` when it was laid on the sheet's edge line because the card touches the sheet there. */
  readonly abutsPaper: readonly [boolean, boolean, boolean, boolean];
  /**
   * L7 (colour regions only): the same outline with one side (or every such
   * side) moved out across a band of another colour to the next straight
   * edge parallel to it (step 9 of the module comment): a two-colour card
   * whose region holds only its main colour. `detectCard` tries these only
   * when `quad` itself is the wrong size or shape. Same order and px as
   * `quad`; empty when there is no such band.
   */
  readonly extensions: readonly CoarseExtension[];
}

/** One `CoarseCandidate.extensions` entry. */
export interface CoarseExtension {
  /** The outline with the band added, TL, TR, BR, BL. */
  readonly quad: Quad;
  /** As `CoarseCandidate.edgeSupport`, for this outline. */
  readonly edgeSupport: number;
  /** Which sides (TL-TR, TR-BR, BR-BL, BL-TL) were moved out. */
  readonly sidesMoved: readonly number[];
}

/** Optional context for `findCoarseCandidates`; image px of the image searched. */
export interface CoarseOptions {
  /**
   * The sheet's corners, if known (any start, either winding). The mask
   * hides a band along the sheet's edge, so a card touching the sheet loses
   * that side's edge pixels; with the sheet known, such a side is laid on the
   * sheet's own edge line instead (the edge there is sheet white to card),
   * and `refine.ts` fits it from the image as usual.
   */
  readonly paperCorners?: Quad | null;
  /**
   * Also try uniform colour regions (L5). `detectCard` turns this on only for
   * a card beside a known sheet: that is the case it was built for (a dark
   * card back on wood), and elsewhere a region can be the sheet itself (an
   * undetected A4 is within the card aspect tolerance). Default false.
   */
  readonly colourRegions?: boolean;
  /**
   * L7: grow colour regions that stop at every pixel whose gradient is at
   * least the weak threshold (on Kirby's round-5 photos the red card front
   * on the red and black mat leaked into the mat through red mat lines
   * touching its edge, and no card region formed). `detectCard` uses this
   * only as a second try, when the plain search found no card.
   */
  readonly regionEdgeBarrier?: boolean;
  /** L7: also return edge components (steps 1-5); default true. The second try is regions only. */
  readonly edgeComponents?: boolean;
}

interface Piece {
  readonly pts: Point2[];
  /** The piece's pixels at or above the strong threshold (what `tightenSides` fits). */
  readonly strong: Point2[];
  readonly touches: boolean;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Only this many of the largest pieces are tried in pairs (cost is quadratic). Candidate 未拍板. */
export const MAX_PIECES_TO_PAIR = 12;
/** Two pieces are tried together when their bounding boxes are this close (fraction of the larger one's long side). Candidate 未拍板. */
export const PAIR_MAX_GAP_FRACTION = 0.25;

/** `findCoarseCandidates`' output, with the hysteresis thresholds it used (grey levels per px). */
export interface CoarseResult {
  readonly candidates: readonly CoarseCandidate[];
  readonly highThreshold: number;
  readonly lowThreshold: number;
}

interface PaperEdges {
  readonly corners: Quad;
  readonly lines: readonly NormalLine[];
  readonly margin: number;
}

function paperEdgesOf(
  paperCorners: Quad | null | undefined,
): PaperEdges | null {
  if (!paperCorners) return null;
  const corners = orderQuadCorners(paperCorners);
  const lines: NormalLine[] = [];
  for (let i = 0; i < 4; i++) {
    const l = lineFromTwoPoints(corners[i], corners[(i + 1) % 4]);
    if (!l) return null;
    lines.push(l);
  }
  return { corners, lines, margin: paperEdgeMarginPx(corners) };
}

/**
 * For each side of `quad`, the sheet side's line it lies along (the card
 * touches the sheet there), or null. See `ABUT_SLACK_PX`.
 */
function abuttingLines(quad: Quad, paper: PaperEdges): (NormalLine | null)[] {
  const maxDist = paper.margin + ABUT_SLACK_PX;
  const sinMax = Math.sin((ABUT_MAX_ANGLE_DEG * Math.PI) / 180);
  const out: (NormalLine | null)[] = [null, null, null, null];
  for (let s = 0; s < 4; s++) {
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-6) continue;
    for (let i = 0; i < 4; i++) {
      const pa = paper.corners[i];
      const pb = paper.corners[(i + 1) % 4];
      const PL = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      if (PL < 1e-6) continue;
      const cross =
        ((b.x - a.x) * (pb.y - pa.y) - (b.y - a.y) * (pb.x - pa.x)) / (L * PL);
      if (Math.abs(cross) > sinMax) continue;
      const line = paper.lines[i];
      if (Math.abs(signedDistance(line, a)) > maxDist) continue;
      if (Math.abs(signedDistance(line, b)) > maxDist) continue;
      // The side's middle must face the sheet side itself, not its extension.
      const mx = (a.x + b.x) / 2 - pa.x;
      const my = (a.y + b.y) / 2 - pa.y;
      const t = (mx * (pb.x - pa.x) + my * (pb.y - pa.y)) / (PL * PL);
      if (t < 0 || t > 1) continue;
      out[s] = line;
      break;
    }
  }
  return out;
}

function intersectAll(lines: readonly (NormalLine | null)[]): Quad | null {
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

/** L7: `smoothRgb` once per image object (`detectCard` may search it twice). */
const smoothCache = new WeakMap<RgbaImage, Float32Array>();

/** 3x3 binomial-smoothed RGB, 3 floats per pixel. */
function smoothRgb(img: RgbaImage): Float32Array {
  const { width: w, height: h, data } = img;
  const tmp = new Float32Array(w * h * 3);
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : 0;
      const xr = x < w - 1 ? x + 1 : w - 1;
      for (let c = 0; c < 3; c++) {
        tmp[(y * w + x) * 3 + c] =
          (data[(y * w + xl) * 4 + c] +
            2 * data[(y * w + x) * 4 + c] +
            data[(y * w + xr) * 4 + c]) /
          4;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? y - 1 : 0;
    const yd = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        out[(y * w + x) * 3 + c] =
          (tmp[(yu * w + x) * 3 + c] +
            2 * tmp[(y * w + x) * 3 + c] +
            tmp[(yd * w + x) * 3 + c]) /
          4;
      }
    }
  }
  return out;
}

interface Region {
  readonly boundary: Point2[];
  readonly pixelCount: number;
  readonly touches: boolean;
  /** Its label in the region map. */
  readonly id: number;
  /** Its mean smoothed colour (L7). */
  readonly mean: readonly [number, number, number];
}

/**
 * L6 (2026-11-01): two colour regions sharing at least this many px of
 * border (on the image searched) are also tried joined. On Kirby's 13-09-03
 * and 13-09-04 photos the card back's glare end (up to (200, 185, 225)
 * against (61, 95, 159) at the other end) grew as a region of its own,
 * cutting the card in two; joined, the two are the card. Candidate 未拍板.
 */
export const REGION_PAIR_MIN_BORDER_PX = 20;

/**
 * L5 (2026-10-30): uniform colour regions in the search area. On Kirby's
 * photos a dark card back on a wood table had edges only about 1-2x the
 * wood grain's strongest (card edge 15-31 grey levels/px against wood p99
 * 22, on the half-size copy), so its edge component merged with grain lines
 * running to the frame border; its INSIDE, though, is one colour, unlike the
 * wood around it. Seeds are flat pixels (gradient under `low`), so a region
 * never starts on an edge.
 */
function findColourRegions(
  img: RgbaImage,
  mask: Uint8Array,
  mag: Float32Array,
  low: number,
  maxPixels: number,
  barrier = false,
): { regions: Region[]; pairs: [number, number][] } {
  const { width: w, height: h } = img;
  let rgb = smoothCache.get(img);
  if (!rgb) {
    rgb = smoothRgb(img);
    smoothCache.set(img, rgb);
  }
  const label = new Int32Array(w * h).fill(-1);
  const regions: Region[] = [];
  const queue: number[] = [];
  const t2 = REGION_LOCAL_TOLERANCE * REGION_LOCAL_TOLERANCE;
  const s2 = REGION_MEAN_TOLERANCE * REGION_MEAN_TOLERANCE;
  // L7: with `barrier`, no pixel at or above the weak threshold joins a
  // region, so a region cannot leak across a faint card edge.
  const stopAt = barrier ? low : Infinity;
  let id = 0;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start] !== -1 || mag[start] >= low) continue;
    let sumR = rgb[start * 3];
    let sumG = rgb[start * 3 + 1];
    let sumB = rgb[start * 3 + 2];
    queue.length = 0;
    queue.push(start);
    label[start] = id;
    let touches = false;
    for (let qi = 0; qi < queue.length; qi++) {
      const k = queue[qi];
      const x = k % w;
      const y = (k - x) / w;
      if (x <= 2 || y <= 2 || x >= w - 3 || y >= h - 3) touches = true;
      const r = rgb[k * 3];
      const g = rgb[k * 3 + 1];
      const b = rgb[k * 3 + 2];
      const inv = 1 / queue.length;
      const sr = sumR * inv;
      const sg = sumG * inv;
      const sb = sumB * inv;
      for (let n = 0; n < 4; n++) {
        const xx = n === 0 ? x - 1 : n === 1 ? x + 1 : x;
        const yy = n === 2 ? y - 1 : n === 3 ? y + 1 : y;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const kk = yy * w + xx;
        if (!mask[kk] || label[kk] !== -1 || mag[kk] >= stopAt) continue;
        const nr = rgb[kk * 3];
        const ng = rgb[kk * 3 + 1];
        const nb = rgb[kk * 3 + 2];
        if ((nr - r) ** 2 + (ng - g) ** 2 + (nb - b) ** 2 > t2) continue;
        if ((nr - sr) ** 2 + (ng - sg) ** 2 + (nb - sb) ** 2 > s2) continue;
        label[kk] = id;
        queue.push(kk);
        sumR += nr;
        sumG += ng;
        sumB += nb;
      }
    }
    const count = queue.length;
    if (count >= REGION_MIN_PIXELS && count <= maxPixels) {
      const boundary: Point2[] = [];
      for (const k of queue) {
        const x = k % w;
        const y = (k - x) / w;
        if (
          x === 0 ||
          y === 0 ||
          x === w - 1 ||
          y === h - 1 ||
          label[k - 1] !== id ||
          label[k + 1] !== id ||
          label[k - w] !== id ||
          label[k + w] !== id
        ) {
          boundary.push({ x: x + 0.5, y: y + 0.5 });
        }
      }
      regions.push({
        boundary,
        pixelCount: count,
        touches,
        id,
        mean: [sumR / count, sumG / count, sumB / count],
      });
    }
    id++;
  }
  // L6: pairs of kept regions sharing at least `REGION_PAIR_MIN_BORDER_PX`
  // of border (4-neighbour pixel pairs).
  const index = new Map<number, number>();
  regions.forEach((r, i) => index.set(r.id, i));
  const shared = new Map<number, number>();
  const n = regions.length;
  const note = (a: number, b: number) => {
    const ia = index.get(a);
    const ib = index.get(b);
    if (ia === undefined || ib === undefined) return;
    const key = ia < ib ? ia * n + ib : ib * n + ia;
    shared.set(key, (shared.get(key) ?? 0) + 1);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = label[y * w + x];
      if (a < 0) continue;
      if (x + 1 < w) {
        const b = label[y * w + x + 1];
        if (b >= 0 && b !== a) note(a, b);
      }
      if (y + 1 < h) {
        const b = label[(y + 1) * w + x];
        if (b >= 0 && b !== a) note(a, b);
      }
    }
  }
  const pairs: [number, number][] = [];
  for (const [key, count] of shared) {
    if (count < REGION_PAIR_MIN_BORDER_PX) continue;
    pairs.push([Math.floor(key / n), key % n]);
  }
  return { regions, pairs };
}

/**
 * L8 (2026-11-02): `convexHull` of `points`, from only each row's leftmost
 * and rightmost point. Every other point of a row lies on the segment
 * between those two, so the hull (and `convexHull`'s answer, vertex for
 * vertex: the same extreme points, starting from the same leftmost-topmost
 * one) is unchanged; the sort inside `convexHull` then sees about 2 points
 * per row instead of every pixel of a component (the hull was half of the
 * no-sheet time on Kirby's photos, measured with --cpu-prof). Pure.
 */
export function hullOf(points: readonly Point2[]): Point2[] {
  // Pixel centres (y = row + 0.5, as every caller here): one slot per row.
  let y0 = Infinity;
  let y1 = -Infinity;
  let grid = true;
  for (const p of points) {
    if (p.y - 0.5 !== Math.floor(p.y)) {
      grid = false;
      break;
    }
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  if (grid && points.length > 0) {
    const n = y1 - y0 + 1;
    const lo: (Point2 | undefined)[] = new Array<Point2 | undefined>(n);
    const hi: (Point2 | undefined)[] = new Array<Point2 | undefined>(n);
    for (const p of points) {
      const r = p.y - y0;
      const l = lo[r];
      if (l === undefined) {
        lo[r] = p;
        hi[r] = p;
      } else if (p.x < l.x) lo[r] = p;
      else if (p.x > (hi[r] as Point2).x) hi[r] = p;
    }
    const ends: Point2[] = [];
    for (let r = 0; r < n; r++) {
      const l = lo[r];
      if (l === undefined) continue;
      ends.push(l);
      if (hi[r] !== l) ends.push(hi[r] as Point2);
    }
    return convexHull(ends);
  }
  const rows = new Map<number, [Point2, Point2]>();
  for (const p of points) {
    const r = rows.get(p.y);
    if (!r) rows.set(p.y, [p, p]);
    else if (p.x < r[0].x) r[0] = p;
    else if (p.x > r[1].x) r[1] = p;
  }
  const ends: Point2[] = [];
  for (const [a, b] of rows.values()) {
    ends.push(a);
    if (b !== a) ends.push(b);
  }
  return convexHull(ends);
}

const gradientCache = new WeakMap<RgbaImage, Float32Array>();

/**
 * Find every edge component in the search area (and nearby pairs of them,
 * joined), and with `colourRegions` every uniform colour region (L5), with
 * its 4-vertex hull and tightened quad. Pure.
 */
export function findCoarseCandidates(
  img: RgbaImage,
  mask: Uint8Array,
  options: CoarseOptions = {},
): CoarseResult {
  const { width: w, height: h } = img;
  // L7: `detectCard`'s second try reads the same image; the gradient is
  // computed once per image object.
  let mag = gradientCache.get(img);
  if (!mag) {
    mag = colourGradientMagnitude(img);
    gradientCache.set(img, mag);
  }
  const paper = paperEdgesOf(options.paperCorners);
  const withEdges = options.edgeComponents ?? true;

  let maskCount = 0;
  let sampleCount = 0;
  for (let k = 0; k < w * h; k++) if (mask[k]) maskCount++;
  for (let k = 0; k < w * h; k += 3) if (mask[k]) sampleCount++;
  // L8: a typed array sorted numerically (the same order as the comparator
  // sort of a plain array before L8, which took 7 % of the no-sheet time).
  const samples = new Float32Array(sampleCount);
  for (let k = 0, j = 0; k < w * h; k += 3) {
    if (mask[k]) samples[j++] = mag[k];
  }
  samples.sort();
  const median = samples.length ? samples[samples.length >> 1] : 0;
  const high = Math.max(EDGE_HIGH_MIN, EDGE_HIGH_PER_MEDIAN * median);
  const low = Math.max(4, EDGE_LOW_FRACTION * high);

  const weak = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) {
    if (mask[k] && mag[k] >= low) weak[k] = 1;
  }

  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const pieces: Piece[] = [];
  for (let start = 0; withEdges && start < w * h; start++) {
    if (!weak[start] || seen[start]) continue;
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    const pts: Point2[] = [];
    const strongPts: Point2[] = [];
    let strong = false;
    let touches = false;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    while (stack.length) {
      const k = stack.pop() as number;
      const x = k % w;
      const y = (k - x) / w;
      pts.push({ x: x + 0.5, y: y + 0.5 });
      if (mag[k] >= high) strongPts.push({ x: x + 0.5, y: y + 0.5 });
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (mag[k] >= high) strong = true;
      if (x <= 2 || y <= 2 || x >= w - 3 || y >= h - 3) touches = true;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const kk = yy * w + xx;
          if (weak[kk] && !seen[kk]) {
            seen[kk] = 1;
            stack.push(kk);
          }
        }
      }
    }
    if (!strong || pts.length < MIN_COMPONENT_PIXELS) continue;
    pieces.push({ pts, strong: strongPts, touches, x0, y0, x1, y1 });
  }

  const nearPaperEdge = paper
    ? (p: Point2) => distanceToQuadOutline(p, paper.corners) <= paper.margin + 2
    : null;
  const candidates: CoarseCandidate[] = [];
  // `hull` is `convexHull` of the outline's pixels (L8: computed once per
  // piece or region, and a pair's from its two hulls, which have the same
  // extreme points as the two pixel sets together).
  const add = (
    hull: readonly Point2[],
    strongPts: readonly Point2[],
    touches: boolean,
    joined: 1 | 2,
    source: "edge" | "region",
    pixelCount: number,
    regionMean: readonly [number, number, number] | null = null,
  ) => {
    const quad = simplifyToQuad(hull);
    if (!quad) return;
    const hullQuad = orderQuadCorners(quad);
    const marched =
      source === "region"
        ? marchSidesOutward(
            strongPts,
            hullQuad,
            mag,
            mask,
            img,
            high,
            regionMean,
          )
        : null;
    const tight = marched ? marched.lines : tightenSides(strongPts, hullQuad);
    const abut = paper
      ? abuttingLines(hullQuad, paper)
      : [null, null, null, null];
    // L6: a region's side marched out to the masked band lies along the
    // sheet even when its hull side, cut short at the corners by the
    // 4-vertex simplification, does not (a card running under the sheet has
    // sharp corners at the sheet's edge; the hull lost 6-7 px there in the
    // L6 scene).
    if (paper && source === "region") {
      const tq = intersectAll(tight);
      if (tq && isConvexQuad(tq)) {
        const more = abuttingLines(tq, paper);
        for (let i = 0; i < 4; i++) abut[i] ??= more[i];
      }
    }
    let ordered: Quad;
    if (abut.every((l) => l === null)) {
      // No side along the sheet: exactly the L3a/L4 rule (all four sides
      // tightened, else the hull quad).
      ordered = intersectAll(tight) ?? hullQuad;
    } else {
      // A side along the sheet is the sheet's edge line; the other sides are
      // tightened when all of them can be, else the hull's.
      const allFree = tight.every((l, i) => l !== null || abut[i] !== null);
      const base = allFree
        ? tight
        : [0, 1, 2, 3].map((i) =>
            lineFromTwoPoints(hullQuad[i], hullQuad[(i + 1) % 4]),
          );
      ordered = intersectAll(base.map((l, i) => abut[i] ?? l)) ?? hullQuad;
    }
    if (source === "region") {
      const area = polygonArea(ordered);
      if (!(area > 0) || pixelCount / area < REGION_MIN_FILL) return;
    }
    // L7: the outline with a band of another colour added on a side (a
    // side laid on the sheet's edge is never moved).
    const extensions: CoarseExtension[] = [];
    if (marched && tight.every((l, i) => l !== null || abut[i] !== null)) {
      const base = tight.map((l, i) => abut[i] ?? l);
      // One side moved to each of its outer lines; with more than one side
      // that has any, also every such side moved to its farthest.
      const moves: { sides: number[]; lines: (NormalLine | null)[] }[] = [];
      const movable = [0, 1, 2, 3].filter(
        (i) => abut[i] === null && marched.outer[i].length > 0,
      );
      for (const i of movable) {
        for (const o of marched.outer[i]) {
          moves.push({
            sides: [i],
            lines: base.map((l, j) => (j === i ? o : l)),
          });
        }
      }
      if (movable.length > 1) {
        moves.push({
          sides: movable,
          lines: base.map((l, j) =>
            movable.includes(j)
              ? marched.outer[j][marched.outer[j].length - 1]
              : l,
          ),
        });
      }
      for (const m of moves) {
        const q = intersectAll(m.lines);
        if (!q || !isConvexQuad(q)) continue;
        extensions.push({
          quad: q,
          edgeSupport: edgeSupport(weak, w, h, q, nearPaperEdge),
          sidesMoved: m.sides,
        });
      }
    }
    candidates.push({
      quad: ordered,
      hullQuad,
      pixelCount,
      touchesBorder: touches,
      edgeSupport: edgeSupport(weak, w, h, ordered, nearPaperEdge),
      piecesJoined: joined,
      source,
      abutsPaper: [
        abut[0] !== null,
        abut[1] !== null,
        abut[2] !== null,
        abut[3] !== null,
      ],
      extensions,
    });
  };
  const pieceHull = new Map<Piece, Point2[]>();
  for (const p of pieces) {
    const hull = hullOf(p.pts);
    pieceHull.set(p, hull);
    add(hull, p.strong, p.touches, 1, "edge", p.pts.length);
  }
  // A dark stripe or label reaching the card's edge on a dark table leaves a
  // gap that cuts the outline in two; try nearby pairs of the larger pieces
  // joined (cf. F19's joined sheet pieces in paper/detect.ts).
  const big = [...pieces]
    .sort((a, b) => b.pts.length - a.pts.length)
    .slice(0, MAX_PIECES_TO_PAIR);
  for (let i = 0; i < big.length; i++) {
    for (let j = i + 1; j < big.length; j++) {
      const a = big[i];
      const b = big[j];
      const gapX = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
      const gapY = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
      const span = Math.max(a.x1 - a.x0, a.y1 - a.y0, b.x1 - b.x0, b.y1 - b.y0);
      if (Math.hypot(gapX, gapY) > PAIR_MAX_GAP_FRACTION * span) continue;
      add(
        convexHull(
          (pieceHull.get(a) as Point2[]).concat(pieceHull.get(b) as Point2[]),
        ),
        a.strong.concat(b.strong),
        a.touches || b.touches,
        2,
        "edge",
        a.pts.length + b.pts.length,
      );
    }
  }
  const { regions, pairs } = options.colourRegions
    ? findColourRegions(
        img,
        mask,
        mag,
        low,
        REGION_MAX_AREA_FRACTION * maskCount,
        options.regionEdgeBarrier === true,
      )
    : { regions: [], pairs: [] };
  const regionHull = regions.map((r) => hullOf(r.boundary));
  regions.forEach((r, i) =>
    add(
      regionHull[i],
      r.boundary,
      r.touches,
      1,
      "region",
      r.pixelCount,
      r.mean,
    ),
  );
  for (const [i, j] of pairs) {
    const a = regions[i];
    const b = regions[j];
    const pts = a.boundary.concat(b.boundary);
    add(
      convexHull(regionHull[i].concat(regionHull[j])),
      pts,
      a.touches || b.touches,
      2,
      "region",
      a.pixelCount + b.pixelCount,
      [0, 1, 2].map(
        (c) =>
          (a.mean[c] * a.pixelCount + b.mean[c] * b.pixelCount) /
          (a.pixelCount + b.pixelCount),
      ) as [number, number, number],
    );
  }
  return { candidates, highThreshold: high, lowThreshold: low };
}

function edgeSupport(
  weak: Uint8Array,
  w: number,
  h: number,
  quad: Quad,
  nearPaperEdge: ((p: Point2) => boolean) | null,
): number {
  let total = 0;
  let hit = 0;
  for (let s = 0; s < 4; s++) {
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(4, Math.floor(len / 3));
    for (let i = 0; i <= n; i++) {
      const t = 0.15 + (0.7 * i) / n;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      total++;
      let found = nearPaperEdge !== null && nearPaperEdge({ x: px, y: py });
      for (let dy = -2; dy <= 2 && !found; dy++) {
        for (let dx = -2; dx <= 2 && !found; dx++) {
          const xx = Math.floor(px) + dx;
          const yy = Math.floor(py) + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && weak[yy * w + xx]) {
            found = true;
          }
        }
      }
      if (found) hit++;
    }
  }
  return total ? hit / total : 0;
}

/**
 * L6: a region's side may march outward this far (fraction of the quad's
 * shorter side pair's mean length) looking for the card's edge. The
 * glare on Kirby's 08-44 photo cut 29 px off a 165 px short side (0.18).
 * Candidate 未拍板.
 */
export const REGION_MARCH_REACH_FRACTION = 0.3;

/**
 * L7 (2026-11-02): how far past the first edge (fraction of the region
 * quad's shorter side pair's mean length) step 9 looks for the band's outer
 * edge. Kirby's round-5 card front: a red body with a navy "District 67"
 * band across one long side, about 5 mm of the card's 54 mm short side; the
 * red region's short side was about 125 px against the card's 155 (0.24).
 * Candidate 未拍板.
 */
export const BAND_REACH_FRACTION = 0.4;
/**
 * Step 9: at least this share of a side's positions must meet the band's
 * outer edge at the same distance (within `BAND_PEAK_HALF_WIDTH_PX`). The
 * band's text ("District 67") breaks it at a few positions. Candidate 未拍板.
 */
export const BAND_MIN_SUPPORT = 0.5;
/** Step 9: positions within this many px of the most common distance count toward it. Candidate 未拍板. */
export const BAND_PEAK_HALF_WIDTH_PX = 1.5;
/**
 * Step 9: just inside an outer edge (`BAND_INSIDE_PX` short of it) the band
 * must be one colour: at least this share of the side's positions within
 * `BAND_COLOUR_TOLERANCE` (RGB distance) of their median. A strip of
 * patterned mat between the card and a mat line is not one colour.
 * Candidate 未拍板.
 */
export const BAND_MIN_UNIFORM = 0.6;
export const BAND_COLOUR_TOLERANCE = 40;
/** Step 9: the colour "just inside" an outer edge is read this many px (of the image searched) short of it. Candidate 未拍板. */
export const BAND_INSIDE_PX = 1.5;
/**
 * Step 9: edges met past the first, per position. Kirby's card front has a
 * thin gold line between the red body and the navy band, so the band's
 * outer edge is the second edge past the red's, and the band's "District
 * 67" lettering adds one or two where it runs. Candidate 未拍板.
 */
export const BAND_MAX_RIDGES = 4;
/** Step 9: at most this many outer lines per side are kept (nearest first). Candidate 未拍板. */
export const BAND_MAX_LINES = 3;
/**
 * Step 9: a further edge is a local peak of the colour change along the
 * side's normal of at least this many grey levels per px (RGB distance, on
 * the image searched). Navy band (35, 45, 100) to black mat (35, 30, 32)
 * is about 70 levels over 2-4 px. Candidate 未拍板.
 */
export const BAND_EDGE_MIN = 8;
/**
 * Step 9: the band's colour (median just inside its outer edge) must be
 * farther than this (RGB distance) from the region's mean colour: the
 * region's own `REGION_MEAN_TOLERANCE`, so the band is a colour the region
 * could not have taken in. Kirby's navy band against the red body: about
 * 110. Candidate 未拍板.
 */
export const BAND_MIN_COLOUR_STEP = REGION_MEAN_TOLERANCE;

/** What `marchSidesOutward` found per side. */
interface MarchedSides {
  /** Step 8's line per side (the region's first edge), or null. */
  readonly lines: (NormalLine | null)[];
  /** Step 9's lines per side (outer edges of bands beyond the first edge), nearest first; empty when none. */
  readonly outer: NormalLine[][];
}

/**
 * Step 8 (L6): per side of a colour region's hull quad, the outermost region
 * pixel at each position along the middle 70 % of the side, marched outward
 * along the side's normal (0.5 px steps, nearest pixel) to the first pixel
 * whose gradient is at least `high`; where none is met within reach, or the
 * march leaves the search mask, the region pixel itself. A robust line
 * through those points per side, or null (as `tightenSides`).
 *
 * Step 9 (L7): from that first edge the march goes on, across the edge
 * (gradient at least `low`), then over a stretch below `low` to the next
 * pixel at least `high`: a band of another colour on the card (Kirby's red
 * card front with its navy band, whose colour region held only the red).
 * It goes on past further edges (`BAND_MAX_RIDGES`): where most positions
 * meet an edge at one distance and the colour just inside it is one colour,
 * a robust line through those points is one of the side's `outer` lines.
 * Never past the search mask, so never into the sheet.
 */
function marchSidesOutward(
  pts: readonly Point2[],
  quad: Quad,
  mag: Float32Array,
  mask: Uint8Array,
  img: RgbaImage,
  high: number,
  regionMean: readonly [number, number, number] | null,
): MarchedSides {
  const { width: w, height: h } = img;
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  const len = (i: number) =>
    Math.hypot(
      quad[(i + 1) % 4].x - quad[i].x,
      quad[(i + 1) % 4].y - quad[i].y,
    );
  const shortPair = Math.min((len(0) + len(2)) / 2, (len(1) + len(3)) / 2);
  const reach = REGION_MARCH_REACH_FRACTION * shortPair;
  const bandReach = BAND_REACH_FRACTION * shortPair;
  const lines: (NormalLine | null)[] = [];
  const outer: NormalLine[][] = [];
  const colour = [0, 0, 0];
  /** Pixel index at (x, y) when inside the frame and the mask, else -1. */
  const at = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return -1;
    const k = yi * w + xi;
    return mask[k] ? k : -1;
  };
  // Step 9's colour profile at one position (L8: read on demand). `has(i)`:
  // sample i exists, reading samples up to it as needed; the profile ends
  // (`profEnd`, its length) where it leaves the mask or passes `stepEnd`.
  const prof: number[] = [];
  // g(i) once per sample (NaN: not computed yet).
  let gCache = new Float64Array(64);
  let profEnd = -1;
  let profCount = 0;
  let profX = 0;
  let profY = 0;
  let nx = 0;
  let ny = 0;
  let nextStep = 0;
  let stepEnd = 0;
  const has = (i: number): boolean => {
    while (profCount <= i && profEnd < 0) {
      if (!(nextStep <= stepEnd)) {
        profEnd = profCount;
        break;
      }
      const x = profX + nx * nextStep;
      const y = profY + ny * nextStep;
      if (at(x, y) < 0) {
        profEnd = profCount;
        break;
      }
      sampleRgb(img, x, y, colour);
      prof.push(colour[0], colour[1], colour[2]);
      profCount++;
      nextStep += 0.5;
    }
    return i < profCount;
  };
  // Colour change per px at sample i (samples i-2 and i+2 are 2 px apart);
  // 0 where sample i+2 does not exist (as the zero-filled array before L8).
  const g = (i: number): number => {
    if (i < 2 || !has(i + 2)) return 0;
    if (i >= gCache.length) {
      const bigger = new Float64Array(Math.max(2 * gCache.length, i + 1));
      bigger.fill(NaN);
      bigger.set(gCache);
      gCache = bigger;
    }
    const cached = gCache[i];
    if (cached === cached) return cached;
    const dr = prof[(i + 2) * 3] - prof[(i - 2) * 3];
    const dg = prof[(i + 2) * 3 + 1] - prof[(i - 2) * 3 + 1];
    const db = prof[(i + 2) * 3 + 2] - prof[(i - 2) * 3 + 2];
    return (gCache[i] = Math.hypot(dr, dg, db) / 2);
  };
  // True only when g(i) < BAND_EDGE_MIN for sure, without the hypot: the
  // squared change is below (2 * BAND_EDGE_MIN)^2 by a margin far wider than
  // hypot's rounding. Otherwise false (then g(i) decides, as before L8).
  const surelyBelowEdgeMin = (i: number): boolean => {
    if (i < 2 || !has(i + 2)) return BAND_EDGE_MIN > 0;
    const cached = i < gCache.length ? gCache[i] : NaN;
    if (cached === cached) return cached < BAND_EDGE_MIN;
    const dr = prof[(i + 2) * 3] - prof[(i - 2) * 3];
    const dg = prof[(i + 2) * 3 + 1] - prof[(i - 2) * 3 + 1];
    const db = prof[(i + 2) * 3 + 2] - prof[(i - 2) * 3 + 2];
    return (
      dr * dr + dg * dg + db * db < 0.999 * (4 * BAND_EDGE_MIN * BAND_EDGE_MIN)
    );
  };
  for (let s = 0; s < 4; s++) {
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 4) {
      lines.push(null);
      outer.push([]);
      continue;
    }
    const dx = (b.x - a.x) / L;
    const dy = (b.y - a.y) / L;
    // Outward normal (away from the quad's centre).
    nx = -dy;
    ny = dx;
    if ((cx - a.x) * nx + (cy - a.y) * ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const bins = Math.floor(L);
    const best = new Float64Array(bins).fill(-Infinity);
    const bestPt: (Point2 | null)[] = new Array<Point2 | null>(bins).fill(null);
    const lo = ((1 - TIGHTEN_SPAN) / 2) * L;
    const hi = L - lo;
    for (const p of pts) {
      const t = (p.x - a.x) * dx + (p.y - a.y) * dy;
      if (t < lo || t > hi) continue;
      const dist = (p.x - a.x) * nx + (p.y - a.y) * ny;
      // Region pixels well inside belong to another side (or the logo).
      if (dist < -reach) continue;
      const k = Math.min(bins - 1, Math.floor(t));
      if (dist > best[k]) {
        best[k] = dist;
        bestPt[k] = p;
      }
    }
    const out: Point2[] = [];
    const hits: BandHit[][] = [];
    let positions = 0;
    for (const p of bestPt) {
      if (!p) continue;
      positions++;
      let hit: Point2 | null = null;
      let s1 = -1;
      for (let step = 0; step <= reach; step += 0.5) {
        const k = at(p.x + nx * step, p.y + ny * step);
        if (k < 0) break;
        if (mag[k] >= high) {
          hit = { x: p.x + nx * step, y: p.y + ny * step };
          s1 = step;
          break;
        }
      }
      out.push(hit ?? p);
      // Step 9 starts from the first edge, or, where step 8 met none (a
      // dense mat pattern can raise `high` above the card's own edge), from
      // the region's pixel.
      if (!hit) s1 = 0;
      // Step 9: past the first edge, each further edge, up to
      // `BAND_MAX_RIDGES`, within `bandReach` of the first: a local peak of
      // the colour change along the normal of at least `BAND_EDGE_MIN`
      // (absolute: the global thresholds follow the search area's median,
      // which a dense mat pattern raises above a navy band's edge against
      // black mat).
      const ridges: BandHit[] = [];
      // L8 (2026-11-02): the profile is read only as far as the ridge search
      // gets (it stops at `BAND_MAX_RIDGES`), not all of `bandReach` up
      // front: on a patterned mat the four ridges come early and most of the
      // profile was never looked at. The samples, their steps and every
      // comparison are the ones before L8, so the ridges are the same
      // (`has`, `g` above).
      prof.length = 0;
      gCache.fill(NaN);
      profEnd = -1;
      profCount = 0;
      profX = p.x;
      profY = p.y;
      nextStep = s1 - 1;
      stepEnd = s1 + bandReach + 1;
      // The first edge's own peak: the largest within 3 px past s1 (sample 2).
      let firstPeak = 2;
      for (let i = 2; i <= 8 && has(i + 2); i++) {
        if (g(i) > g(firstPeak)) firstPeak = i;
      }
      for (let i = firstPeak + 3; has(i + 2); i++) {
        if (ridges.length >= BAND_MAX_RIDGES) break;
        if (surelyBelowEdgeMin(i)) continue;
        const gi = g(i);
        if (gi < BAND_EDGE_MIN || gi < g(i - 1) || gi < g(i + 1)) continue;
        if (gi === g(i - 1) && i - 1 > firstPeak + 2) continue;
        const step = s1 - 1 + 0.5 * i;
        const inStep = step - BAND_INSIDE_PX;
        ridges.push({
          p: { x: p.x + nx * step, y: p.y + ny * step },
          d: step - s1,
          inside: at(p.x + nx * inStep, p.y + ny * inStep),
        });
      }
      hits.push(ridges);
    }
    const fit = fitLineRansac(out, {
      inlierThresholdPx: 1.5,
      minPoints: Math.max(5, Math.floor(0.3 * TIGHTEN_SPAN * L)),
      rng: mulberry32(RANSAC_SEED),
    });
    lines.push(fit ? fit.line : null);
    outer.push(
      regionMean ? bandLines(hits, positions, img, L, regionMean) : [],
    );
  }
  return { lines, outer };
}

/** One step-9 edge met at one position: the point, its distance past the first edge, and the pixel just inside it (index, -1 if none). */
interface BandHit {
  readonly p: Point2;
  readonly d: number;
  readonly inside: number;
}

/**
 * Step 9's candidate outer lines for one side, nearest first: every
 * distance past the first edge at which at least `BAND_MIN_SUPPORT` of the
 * side's positions meet an edge (within `BAND_PEAK_HALF_WIDTH_PX`), where
 * the colour just inside that edge is one colour along the side
 * (`BAND_MIN_UNIFORM`), at most `BAND_MAX_LINES` of them.
 */
function bandLines(
  hits: readonly (readonly BandHit[])[],
  positions: number,
  img: RgbaImage,
  sideLength: number,
  regionMean: readonly [number, number, number],
): NormalLine[] {
  if (positions === 0) return [];
  const all = hits.flat().sort((p, q) => p.d - q.d);
  // L8 (2026-11-02): which position each hit is from, and a sliding window
  // over `all` (sorted by d) that counts the positions with a hit within
  // `BAND_PEAK_HALF_WIDTH_PX` of c.d. Only a distance that count lets
  // through is gathered in full below; before L8 every distance scanned
  // every position's hits (quadratic; a sixth of the no-sheet time on
  // Kirby's photos). Same comparisons, so the same lines.
  const posOf = new Map<BandHit, number>();
  hits.forEach((r, i) => r.forEach((h) => posOf.set(h, i)));
  const inWindow = new Int32Array(hits.length);
  let covered = 0;
  let left = 0;
  let right = 0;

  const lines: NormalLine[] = [];
  let lastD = -Infinity;
  for (const c of all) {
    if (lines.length >= BAND_MAX_LINES) break;
    while (
      right < all.length &&
      !(Math.abs(all[right].d - c.d) > BAND_PEAK_HALF_WIDTH_PX)
    ) {
      const i = posOf.get(all[right]) as number;
      if (inWindow[i]++ === 0) covered++;
      right++;
    }
    while (
      left < right &&
      Math.abs(all[left].d - c.d) > BAND_PEAK_HALF_WIDTH_PX
    ) {
      const i = posOf.get(all[left]) as number;
      if (--inWindow[i] === 0) covered--;
      left++;
    }
    if (c.d <= lastD + 2 * BAND_PEAK_HALF_WIDTH_PX) continue;
    if (covered < BAND_MIN_SUPPORT * positions) continue;
    // Positions meeting an edge at c.d (one point each, the nearest).
    const near: BandHit[] = [];
    for (const r of hits) {
      let best: BandHit | null = null;
      for (const h of r) {
        if (Math.abs(h.d - c.d) > BAND_PEAK_HALF_WIDTH_PX) continue;
        if (!best || Math.abs(h.d - c.d) < Math.abs(best.d - c.d)) best = h;
      }
      if (best) near.push(best);
    }
    if (near.length < BAND_MIN_SUPPORT * positions) continue;
    // Recentre on the median distance and take it as one peak.
    const ds = near.map((h) => h.d).sort((p, q) => p - q);
    lastD = ds[ds.length >> 1] + BAND_PEAK_HALF_WIDTH_PX;
    const cols = near
      .filter((h) => h.inside >= 0)
      .map((h) => [
        img.data[h.inside * 4],
        img.data[h.inside * 4 + 1],
        img.data[h.inside * 4 + 2],
      ]);
    const med = [0, 1, 2].map((ch) => {
      const v = cols.map((col) => col[ch]).sort((p, q) => p - q);
      return v[v.length >> 1] ?? 0;
    });
    const uniform = cols.filter(
      (col) =>
        Math.hypot(col[0] - med[0], col[1] - med[1], col[2] - med[2]) <=
        BAND_COLOUR_TOLERANCE,
    ).length;
    if (uniform < BAND_MIN_UNIFORM * positions) continue;
    // A band the region would have taken in is not another colour: the
    // region just stopped short (a darker patch of wood whose sides moved
    // out onto grain lines made card-shaped outlines on Kirby's 19-41-29).
    if (
      Math.hypot(
        med[0] - regionMean[0],
        med[1] - regionMean[1],
        med[2] - regionMean[2],
      ) <= BAND_MIN_COLOUR_STEP
    ) {
      continue;
    }
    const fit = fitLineRansac(
      near.map((h) => h.p),
      {
        inlierThresholdPx: 1.5,
        minPoints: Math.max(5, Math.floor(0.3 * TIGHTEN_SPAN * sideLength)),
        rng: mulberry32(RANSAC_SEED),
      },
    );
    if (fit) lines.push(fit.line);
  }
  return lines;
}

/** Share of each side (centred) whose outermost strong pixels feed the tightening fit. */
const TIGHTEN_SPAN = 0.7;
/** Pixels farther than this fraction of the side's length from it are not that side's. */
const TIGHTEN_REACH = 0.15;

/**
 * Step 5 of the module comment: re-fit each side of `quad` (TL, TR, BR, BL)
 * through the outermost strong component pixels along it. Per side, the
 * fitted line, or null when that side has too few points.
 */
function tightenSides(
  pts: readonly Point2[],
  quad: Quad,
): (NormalLine | null)[] {
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  const lines: (NormalLine | null)[] = [];
  for (let s = 0; s < 4; s++) {
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 4) {
      lines.push(null);
      continue;
    }
    const dx = (b.x - a.x) / L;
    const dy = (b.y - a.y) / L;
    let nx = -dy;
    let ny = dx;
    if ((cx - a.x) * nx + (cy - a.y) * ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const bins = Math.floor(L);
    const best = new Float64Array(bins).fill(-Infinity);
    const bestPt: (Point2 | null)[] = new Array<Point2 | null>(bins).fill(null);
    const lo = ((1 - TIGHTEN_SPAN) / 2) * L;
    const hi = L - lo;
    for (const p of pts) {
      const t = (p.x - a.x) * dx + (p.y - a.y) * dy;
      if (t < lo || t > hi) continue;
      const dist = (p.x - a.x) * nx + (p.y - a.y) * ny;
      if (Math.abs(dist) > TIGHTEN_REACH * L) continue;
      const k = Math.min(bins - 1, Math.floor(t));
      if (dist > best[k]) {
        best[k] = dist;
        bestPt[k] = p;
      }
    }
    const outer = bestPt.filter((p): p is Point2 => p !== null);
    const fit = fitLineRansac(outer, {
      inlierThresholdPx: 1.5,
      minPoints: Math.max(5, Math.floor(0.3 * TIGHTEN_SPAN * L)),
      rng: mulberry32(RANSAC_SEED),
    });
    lines.push(fit ? fit.line : null);
  }
  return lines;
}
