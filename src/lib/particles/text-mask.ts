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

/**
 * Group a mask's pieces into letters in reading order: lines top to bottom,
 * letters left to right. A piece joins a line its height mostly overlaps (an
 * i's dot sits inside its line's band), and a piece that mostly overlaps a
 * neighbour across x joins that letter (the i's dot and its stem).
 * Returns the letters and, per piece, the letter it belongs to.
 */
export function groupLetters(
  pieces: readonly {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    area: number;
  }[],
): { letters: Letter[]; letterOfPiece: number[] } {
  const order = pieces
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => b.area - a.area || a.i - b.i);
  const lines: { y0: number; y1: number; members: number[] }[] = [];
  for (const p of order) {
    const h = p.y1 - p.y0 + 1;
    const line = lines.find((l) => {
      const overlap = Math.min(l.y1, p.y1) - Math.max(l.y0, p.y0) + 1;
      return overlap > 0.5 * Math.min(h, l.y1 - l.y0 + 1);
    });
    if (line) {
      line.y0 = Math.min(line.y0, p.y0);
      line.y1 = Math.max(line.y1, p.y1);
      line.members.push(p.i);
    } else {
      lines.push({ y0: p.y0, y1: p.y1, members: [p.i] });
    }
  }
  lines.sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1));
  const letters: Letter[] = [];
  const letterOfPiece = new Array<number>(pieces.length).fill(-1);
  lines.forEach((line, lineIndex) => {
    const members = line.members
      .map((i) => ({ ...pieces[i]!, i }))
      .sort((a, b) => a.x0 + a.x1 - (b.x0 + b.x1) || a.i - b.i);
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
          last.pieces.push(m.i);
          continue;
        }
      }
      boxes.push({ x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1, pieces: [m.i] });
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
  /** Within `edgeWidth` of the outline. */
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
  const depth = depthInside(mask);
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
        edge: depth[at]! <= edgeWidth,
        letter,
        order: Math.min(1, (letter + Math.min(1, Math.max(0, across))) / count),
      });
    }
  }
  particles.sort((a, b) => a.order - b.order || a.y - b.y || a.x - b.x);
  return { particles, letters };
}
