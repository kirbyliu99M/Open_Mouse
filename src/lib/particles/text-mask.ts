import { mulberry32 } from "./random";

/**
 * The finale's headline as particles (home finale, stage 1: nothing on the page
 * uses this yet). Pure: the input is a mask, an alpha array the stage draws at
 * run time with the page's own font on an offscreen canvas. No font outline,
 * and nothing derived from one, is stored in the repo; these functions only
 * read whatever mask they are given.
 *
 * A mask is `width × height` alpha values (0 to 255), row by row, as in
 * ImageData (the stage passes every fourth byte). Pixel (i, j) covers the
 * square [i, i + 1) × [j, j + 1), so a point (x, y) is in pixel
 * (floor x, floor y).
 */

export interface Mask {
  readonly width: number;
  readonly height: number;
  /** 1 where the mask is set, 0 elsewhere, row by row. */
  readonly data: Uint8Array;
}

function checkSize(length: number, width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new RangeError("a mask's width and height are positive integers");
  }
  if (length !== width * height) {
    throw new RangeError(
      `a ${width} × ${height} mask has ${width * height} values, not ${length}`,
    );
  }
}

/** The pixels whose alpha is at least `threshold` (default 128, half covered). */
export function thresholdMask(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  threshold = 128,
): Mask {
  checkSize(alpha.length, width, height);
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = alpha[i]! >= threshold ? 1 : 0;
  }
  return { width, height, data };
}

/** Whether (x, y) is in a set pixel. Anything outside the mask is not. */
export function maskAt(mask: Mask, x: number, y: number): boolean {
  const i = Math.floor(x);
  const j = Math.floor(y);
  if (!(i >= 0 && j >= 0 && i < mask.width && j < mask.height)) return false;
  return mask.data[j * mask.width + i] === 1;
}

const FAR = 1e20;

/** One row or column of the squared distance transform (Felzenszwalb and Huttenlocher, 2012). */
function edt1d(f: Float64Array, n: number, d: Float64Array): void {
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k -= 1;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1]! < q) k += 1;
    d[q] = (q - v[k]!) ** 2 + f[v[k]!]!;
  }
}

/**
 * For every pixel, the squared distance (in pixels, centre to centre) to the
 * nearest pixel where `feature` is 1. Exact (Euclidean). With no feature
 * pixel at all every distance is a huge number (1e20 or more).
 */
export function squaredDistanceTo(
  feature: Uint8Array,
  width: number,
  height: number,
): Float64Array {
  checkSize(feature.length, width, height);
  const out = new Float64Array(width * height);
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      f[y] = feature[y * width + x] === 1 ? 0 : FAR;
    }
    edt1d(f, height, d);
    for (let y = 0; y < height; y += 1) out[y * width + x] = d[y]!;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) f[x] = out[y * width + x]!;
    edt1d(f, width, d);
    for (let x = 0; x < width; x += 1) out[y * width + x] = d[x]!;
  }
  return out;
}

/**
 * The mask grown by `radius` px: every pixel whose centre is within `radius`
 * of a set pixel's centre. Radius 0 gives the mask back unchanged.
 */
export function dilateMask(mask: Mask, radius: number): Mask {
  if (!(radius >= 0)) throw new RangeError("radius must be 0 or more");
  const d2 = squaredDistanceTo(mask.data, mask.width, mask.height);
  const r2 = radius * radius;
  const data = new Uint8Array(mask.data.length);
  for (let i = 0; i < data.length; i += 1) data[i] = d2[i]! <= r2 ? 1 : 0;
  return { width: mask.width, height: mask.height, data };
}

/**
 * For every set pixel, the distance to the nearest unset pixel, the outside
 * of the mask counting as unset (so a letter touching the border has an edge
 * there). 0 for unset pixels.
 */
export function depthInside(mask: Mask): Float64Array {
  const w = mask.width + 2;
  const h = mask.height + 2;
  const outside = new Uint8Array(w * h).fill(1);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.data[y * mask.width + x] === 1) outside[(y + 1) * w + x + 1] = 0;
    }
  }
  const d2 = squaredDistanceTo(outside, w, h);
  const out = new Float64Array(mask.data.length);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      out[y * mask.width + x] = Math.sqrt(d2[(y + 1) * w + x + 1]!);
    }
  }
  return out;
}

/**
 * How far the point (x, y) is from the mask's outline, in px, looking no
 * further than `limit`: the distance to the nearest point outside the mask,
 * where a set pixel is the whole square [i, i + 1) × [j, j + 1) and
 * everything beyond the canvas is outside. 0 for a point outside the mask;
 * Infinity when nothing outside lies within `limit`. Exact (not a pixel-centre
 * approximation): it measures to the nearest unset pixel's square, and to the
 * canvas's own edges.
 */
export function distanceToOutline(
  mask: Mask,
  x: number,
  y: number,
  limit: number,
): number {
  if (!(limit >= 0)) throw new RangeError("limit must be 0 or more");
  if (!maskAt(mask, x, y)) return 0;
  // The canvas's edges.
  let best = Math.min(x, y, mask.width - x, mask.height - y);
  const reach = Math.min(limit, best);
  // One pixel more on the low side: a square ending exactly at x - reach counts.
  const i0 = Math.max(0, Math.floor(x - reach) - 1);
  const i1 = Math.min(mask.width - 1, Math.floor(x + reach));
  const j0 = Math.max(0, Math.floor(y - reach) - 1);
  const j1 = Math.min(mask.height - 1, Math.floor(y + reach));
  for (let j = j0; j <= j1; j += 1) {
    const dy = Math.max(j - y, 0, y - (j + 1));
    for (let i = i0; i <= i1; i += 1) {
      if (mask.data[j * mask.width + i] === 1) continue;
      const dx = Math.max(i - x, 0, x - (i + 1));
      const d = Math.hypot(dx, dy);
      if (d < best) best = d;
    }
  }
  return best <= limit ? best : Infinity;
}

/**
 * The mask's 8-connected pieces: a label per pixel (-1 where unset) and each
 * piece's box and size, in scan order (top row first).
 */
export function labelPieces(mask: Mask): {
  labels: Int32Array;
  pieces: { x0: number; y0: number; x1: number; y1: number; area: number }[];
} {
  const { width, height, data } = mask;
  const labels = new Int32Array(width * height).fill(-1);
  const pieces: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    area: number;
  }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < data.length; start += 1) {
    if (data[start] !== 1 || labels[start] !== -1) continue;
    const id = pieces.length;
    const piece = { x0: Infinity, y0: Infinity, x1: -1, y1: -1, area: 0 };
    labels[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const at = stack.pop()!;
      const x = at % width;
      const y = (at - x) / width;
      piece.area += 1;
      if (x < piece.x0) piece.x0 = x;
      if (y < piece.y0) piece.y0 = y;
      if (x > piece.x1) piece.x1 = x;
      if (y > piece.y1) piece.y1 = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (data[next] === 1 && labels[next] === -1) {
            labels[next] = id;
            stack.push(next);
          }
        }
      }
    }
    pieces.push(piece);
  }
  return { labels, pieces };
}

/** A letter: its box (pixels, inclusive), its line (0 = top), and its place in reading order. */
export interface Letter {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly line: number;
  readonly index: number;
}

/** A piece of a mask: its box (pixels, inclusive) and its pixel count. */
export interface Piece {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly area: number;
}

/**
 * When a small piece is a mark of the letter above or below it (an i's or a
 * j's dot, an accent, a cedilla) rather than a letter of its own. It must:
 * overlap the host across x by more than half the narrower of the two; be at
 * most `size` of the host's height; and sit clear of it (no shared row) by a
 * gap of at most `gap` times its own height and at most `hostGap` times the
 * host's height. The gap limits and the size limit keep stacked lines apart:
 * a letter of the other line is too big to count as a mark, and a small piece
 * (a full stop) is usually a whole line gap away, several times its own
 * height; for lines set tighter than that, `groupLetters` also refuses a piece
 * that sits on its own line's baseline as a mark of anything below it.
 * Candidate values (未拍板), tuned on block letters and the headline's two
 * lines.
 */
export const MARK_RULES = { size: 0.6, gap: 1.5, hostGap: 0.4 } as const;

const heightOf = (p: Piece) => p.y1 - p.y0 + 1;
const widthOf = (p: Piece) => p.x1 - p.x0 + 1;
const xOverlap = (a: Piece, b: Piece) =>
  Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;

/** The gap (rows between them) when `mark` may be a mark of `host` (MARK_RULES), else -1. */
export function markGap(
  mark: Piece,
  host: Piece,
  rules: { size: number; gap: number; hostGap: number } = MARK_RULES,
): number {
  const h = heightOf(mark);
  const H = heightOf(host);
  if (h > rules.size * H) return -1;
  if (xOverlap(mark, host) <= 0.5 * Math.min(widthOf(mark), widthOf(host))) {
    return -1;
  }
  const gap = Math.max(host.y0 - mark.y1, mark.y0 - host.y1) - 1;
  if (gap < 0) return -1; // shares a row: an ordinary neighbour in the line
  return gap <= rules.gap * h && gap <= rules.hostGap * H ? gap : -1;
}

/**
 * Whether a piece sits on a line's baseline: some taller piece shares a row
 * with it and ends on (about) the same bottom row, as a full stop or a comma
 * sits beside the letters of its line. An i's dot or an accent ends well above
 * the bottom of the letters beside it. The tolerance is a quarter of the
 * piece's height, at least one row.
 */
export function sitsOnBaseline(
  piece: Piece,
  pieces: readonly Piece[],
): boolean {
  const h = heightOf(piece);
  const tolerance = Math.max(1, 0.25 * h);
  return pieces.some(
    (other) =>
      heightOf(other) > h &&
      other.y0 <= piece.y1 &&
      other.y1 >= piece.y0 &&
      Math.abs(other.y1 - piece.y1) <= tolerance,
  );
}

/**
 * Group a mask's pieces into letters in reading order: lines top to bottom,
 * letters left to right.
 *
 * 1. Marks first: a piece that may be a mark (`markGap`) of another, bigger
 *    piece joins the nearest such host (the smallest gap, then the biggest
 *    host), so an i's dot and its stem are one letter even with no tall
 *    letter beside them. A piece on a baseline (`sitsOnBaseline`: a full
 *    stop) is never a mark of a piece below it: that is the next line.
 * 2. Lines: a letter (host plus marks) joins a line its height mostly
 *    overlaps, biggest letters first.
 * 3. In a line, letters that mostly overlap across x are one letter.
 *
 * Returns the letters and, per piece, the letter it belongs to.
 */
export function groupLetters(pieces: readonly Piece[]): {
  letters: Letter[];
  letterOfPiece: number[];
} {
  // 1. Each piece's host, if it is a mark; chains end at a piece that is not.
  const host = pieces.map((mark, i) => {
    let best = -1;
    let bestGap = Infinity;
    const onBaseline = sitsOnBaseline(mark, pieces);
    pieces.forEach((other, k) => {
      if (k === i) return;
      const gap = markGap(mark, other);
      if (gap < 0) return;
      // A full stop at the end of one line is not an accent of the letter
      // under it on the next line.
      if (mark.y1 < other.y0 && onBaseline) return;
      if (
        gap < bestGap ||
        (gap === bestGap && other.area > pieces[best]!.area)
      ) {
        best = k;
        bestGap = gap;
      }
    });
    return best;
  });
  const rootOf = (i: number): number => {
    let at = i;
    // A host is strictly taller than its mark (MARK_RULES.size < 1), so a
    // chain has no loop; the step limit only guards against a rule change.
    for (let step = 0; host[at]! >= 0 && step < pieces.length; step += 1) {
      at = host[at]!;
    }
    return at;
  };
  const clusters = new Map<
    number,
    {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      area: number;
      members: number[];
    }
  >();
  pieces.forEach((p, i) => {
    const root = rootOf(i);
    const c = clusters.get(root);
    if (c) {
      c.x0 = Math.min(c.x0, p.x0);
      c.y0 = Math.min(c.y0, p.y0);
      c.x1 = Math.max(c.x1, p.x1);
      c.y1 = Math.max(c.y1, p.y1);
      c.area += p.area;
      c.members.push(i);
    } else {
      clusters.set(root, { ...p, members: [i] });
    }
  });
  const units = [...clusters.entries()]
    .map(([root, c]) => ({ ...c, i: root }))
    .sort((a, b) => b.area - a.area || a.i - b.i);

  // 2. Lines.
  const lines: { y0: number; y1: number; members: (typeof units)[number][] }[] =
    [];
  for (const u of units) {
    const h = u.y1 - u.y0 + 1;
    const line = lines.find((l) => {
      const overlap = Math.min(l.y1, u.y1) - Math.max(l.y0, u.y0) + 1;
      return overlap > 0.5 * Math.min(h, l.y1 - l.y0 + 1);
    });
    if (line) {
      line.y0 = Math.min(line.y0, u.y0);
      line.y1 = Math.max(line.y1, u.y1);
      line.members.push(u);
    } else {
      lines.push({ y0: u.y0, y1: u.y1, members: [u] });
    }
  }
  lines.sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1));

  // 3. Letters, left to right.
  const letters: Letter[] = [];
  const letterOfPiece = new Array<number>(pieces.length).fill(-1);
  lines.forEach((line, lineIndex) => {
    const members = [...line.members].sort(
      (a, b) => a.x0 + a.x1 - (b.x0 + b.x1) || a.i - b.i,
    );
    const boxes: {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      pieces: number[];
    }[] = [];
    for (const m of members) {
      const last = boxes[boxes.length - 1];
      if (last) {
        const overlap = Math.min(last.x1, m.x1) - Math.max(last.x0, m.x0) + 1;
        const narrower = Math.min(last.x1 - last.x0 + 1, m.x1 - m.x0 + 1);
        if (overlap > 0.5 * narrower) {
          last.x0 = Math.min(last.x0, m.x0);
          last.y0 = Math.min(last.y0, m.y0);
          last.x1 = Math.max(last.x1, m.x1);
          last.y1 = Math.max(last.y1, m.y1);
          last.pieces.push(...m.members);
          continue;
        }
      }
      boxes.push({
        x0: m.x0,
        y0: m.y0,
        x1: m.x1,
        y1: m.y1,
        pieces: [...m.members],
      });
    }
    for (const b of boxes) {
      const index = letters.length;
      letters.push({
        x0: b.x0,
        y0: b.y0,
        x1: b.x1,
        y1: b.y1,
        line: lineIndex,
        index,
      });
      for (const p of b.pieces) letterOfPiece[p] = index;
    }
  });
  return { letters, letterOfPiece };
}

export interface MaskSampleOptions {
  /** Distance between neighbouring particles, px. */
  readonly spacing: number;
  /** How far a particle may move off its grid place, as a share of the spacing (0 to 0.5, default 0.25). */
  readonly jitter?: number;
  /** A particle within this many px of the mask's edge is an edge particle (default 1.5). */
  readonly edgeWidth?: number;
  /** The alpha a pixel needs to count as inside (default 128). */
  readonly threshold?: number;
  readonly seed: number;
}

export interface MaskParticle {
  readonly x: number;
  readonly y: number;
  /** Within `edgeWidth` of the outline, measured from the particle itself (`distanceToOutline`). */
  readonly edge: boolean;
  /** The letter it belongs to (an index into `letters`, reading order). */
  readonly letter: number;
  /** The reading-order key, 0 to 1: by letter, then left to right inside the letter. */
  readonly order: number;
}

/**
 * Fill a mask with particles on a hexagonal grid (each row offset by half a
 * spacing, rows √3/2 spacing apart), each nudged by a small seeded jitter and
 * kept only if it lands inside. Returns the particles sorted by `order` (left
 * to right, letter by letter) and the letters. Same mask, options and seed give
 * the same particles.
 */
export function sampleMask(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  options: MaskSampleOptions,
): { particles: MaskParticle[]; letters: Letter[] } {
  const { spacing, seed } = options;
  const jitter = options.jitter ?? 0.25;
  const edgeWidth = options.edgeWidth ?? 1.5;
  if (!(spacing > 0) || !Number.isFinite(spacing)) {
    throw new RangeError("spacing must be a positive number");
  }
  if (!(jitter >= 0 && jitter <= 0.5)) {
    throw new RangeError("jitter is 0 to 0.5 of the spacing");
  }
  if (!(edgeWidth >= 0)) throw new RangeError("edgeWidth must be 0 or more");
  const mask = thresholdMask(alpha, width, height, options.threshold ?? 128);
  const { labels, pieces } = labelPieces(mask);
  const { letters, letterOfPiece } = groupLetters(pieces);
  const random = mulberry32(seed);
  const row = (spacing * Math.sqrt(3)) / 2;
  const count = Math.max(1, letters.length);
  const particles: MaskParticle[] = [];
  for (let j = 0; (j + 0.5) * row < height; j += 1) {
    const shift = j % 2 === 1 ? spacing / 2 : 0;
    for (let i = 0; (i + 0.5) * spacing + shift < width; i += 1) {
      // Two draws per grid place whether or not it is kept, so one place's
      // fate never shifts another's jitter.
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * jitter * spacing;
      const x = (i + 0.5) * spacing + shift + Math.cos(angle) * radius;
      const y = (j + 0.5) * row + Math.sin(angle) * radius;
      if (!maskAt(mask, x, y)) continue;
      const at = Math.floor(y) * width + Math.floor(x);
      const letter = letterOfPiece[labels[at]!]!;
      const box = letters[letter]!;
      const across = (x - box.x0) / (box.x1 + 1 - box.x0);
      particles.push({
        x,
        y,
        edge: distanceToOutline(mask, x, y, edgeWidth) <= edgeWidth,
        letter,
        order: Math.min(1, (letter + Math.min(1, Math.max(0, across))) / count),
      });
    }
  }
  particles.sort((a, b) => a.order - b.order || a.y - b.y || a.x - b.x);
  return { particles, letters };
}
