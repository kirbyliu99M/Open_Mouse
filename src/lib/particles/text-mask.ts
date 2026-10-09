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
 *
 * Cost: it reads every pixel within min(limit, distance to the canvas edge)
 * of the point, about (2 · limit + 3)² reads. Keep `limit` small: a limit of
 * hundreds of px on a large mask, for thousands of particles, is hundreds of
 * millions of reads (sampleMask caps it at MAX_EDGE_WIDTH).
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
 * When a small piece may be a mark of a letter above or below it (an i's or a
 * j's dot, an accent, a cedilla) rather than a letter of its own. It must:
 * be at most `size` of the host's height (a mark is far smaller than a
 * lower-case letter, so a whole letter of the next line never qualifies);
 * overlap the host across x by more than `overlap` of the narrower of the two
 * (an italic j's dot sits only partly over its stem); and sit clear of it (no
 * shared row) by a gap of at most `gap` times its own height and at most
 * `hostGap` times the host's height. Candidate values (未拍板), set on block
 * letters; real fonts are untested.
 */
export const MARK_RULES = {
  size: 0.45,
  overlap: 0.3,
  gap: 1.5,
  hostGap: 0.4,
} as const;

const heightOf = (p: Piece) => p.y1 - p.y0 + 1;
const widthOf = (p: Piece) => p.x1 - p.x0 + 1;
const xOverlap = (a: Piece, b: Piece) =>
  Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
const rowsShared = (
  a: { y0: number; y1: number },
  b: { y0: number; y1: number },
) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;

/** The gap (rows between them) when `mark` may be a mark of `host` (MARK_RULES), else -1. */
export function markGap(
  mark: Piece,
  host: Piece,
  rules: {
    size: number;
    overlap: number;
    gap: number;
    hostGap: number;
  } = MARK_RULES,
): number {
  const h = heightOf(mark);
  const H = heightOf(host);
  if (h > rules.size * H) return -1;
  if (
    xOverlap(mark, host) <=
    rules.overlap * Math.min(widthOf(mark), widthOf(host))
  ) {
    return -1;
  }
  const gap = Math.max(host.y0 - mark.y1, mark.y0 - host.y1) - 1;
  if (gap < 0) return -1; // shares a row: an ordinary neighbour in the line
  return gap <= rules.gap * h && gap <= rules.hostGap * H ? gap : -1;
}

/** a before b, comparing number lists entry by entry. */
const before = (a: readonly number[], b: readonly number[]): boolean => {
  for (let n = 0; n < a.length; n += 1) {
    if (a[n] !== b[n]) return a[n]! < b[n]!;
  }
  return false;
};

/**
 * Group a mask's pieces into letters in reading order (lines top to bottom,
 * letters left to right), from their shapes alone. This is the FALLBACK: the
 * stage knows which glyph each pixel came from and should pass it
 * (`MaskSampleOptions.letters`, `lettersFromLabels`), which never guesses.
 *
 * 1. Bodies and marks: a piece that may be a mark (`markGap`) of some other
 *    piece is a mark candidate; every other piece is a body.
 * 2. Lines are made of bodies only: a body joins a line its height mostly
 *    overlaps, biggest first. So a descender of one line and the capitals of
 *    the next stay two lines, and no mark can stretch a line.
 * 3. A mark candidate that shares rows with a line belongs to that line (the
 *    one it shares most rows with) and may only be a mark of a body of that
 *    line: a full stop on line one is never an accent of a capital under it.
 *    One outside every line (a lone i's dot) may be a mark of any body. Among
 *    its hosts it takes one it sits above, nearest first, before one it hangs
 *    below (dots and accents above are far more common than cedillas). With
 *    no host it is a letter of its own, in its line, or a line of its own.
 * 4. In a line, bodies and unattached marks that mostly overlap across x are
 *    one letter (a colon's two dots); each attached mark joins its host.
 *
 * Known limits, all real failures (the page must pass `letters`, and
 * `sampleMask` refuses to guess unless told to):
 * - Across lines: an i's dot of one line that falls within the rows of the
 *   line above (under a descender such as y or g) belongs to that line, and
 *   joins a letter there or becomes a letter of it (pieces y, n, dot, stem, n
 *   give [0, 1, 2, 1, 3]); an accent on a capital of the next line (É, Ä) does
 *   the same at a line height of about 1.1; a dot exactly between two lines,
 *   nearer and above the letter it does not belong to; a cedilla right above
 *   the next line's letter.
 * - Punctuation: in a line with no descender, a semicolon's comma lies below
 *   the line and becomes a line of its own, so the semicolon is two letters
 *   and every later line number moves down one; a lone comma does the same; a
 *   colon, or any glyph of same-sized pieces stacked apart, with no letter
 *   beside it in its line, is a line per piece.
 * - Shapes: tightly kerned letters whose boxes mostly overlap become one
 *   letter; a piece shared by two glyphs (ligatures, touching letters) is one
 *   letter; a Chinese character of several separate pieces is cut up or mixed
 *   with its neighbours.
 *
 * Returns the letters and, per piece, the letter it belongs to.
 */
export function groupLetters(pieces: readonly Piece[]): {
  letters: Letter[];
  letterOfPiece: number[];
} {
  // 1.
  const isMark = pieces.map((p, i) =>
    pieces.some((q, k) => k !== i && markGap(p, q) >= 0),
  );

  // 2.
  type Line = { y0: number; y1: number; bodies: number[]; units: number[] };
  const lines: Line[] = [];
  const byArea = pieces
    .map((_, i) => i)
    .sort((a, b) => pieces[b]!.area - pieces[a]!.area || a - b);
  for (const i of byArea) {
    if (isMark[i]) continue;
    const p = pieces[i]!;
    const line = lines.find(
      (l) => rowsShared(l, p) > 0.5 * Math.min(heightOf(p), l.y1 - l.y0 + 1),
    );
    if (line) {
      line.y0 = Math.min(line.y0, p.y0);
      line.y1 = Math.max(line.y1, p.y1);
      line.bodies.push(i);
      line.units.push(i);
    } else {
      lines.push({ y0: p.y0, y1: p.y1, bodies: [i], units: [i] });
    }
  }
  const allBodies = lines.flatMap((l) => l.bodies);

  // 3.
  const hostOf = new Array<number>(pieces.length).fill(-1);
  const extra: Line[] = [];
  for (let i = 0; i < pieces.length; i += 1) {
    if (!isMark[i]) continue;
    const p = pieces[i]!;
    let home: Line | undefined;
    let shared = 0;
    for (const l of lines) {
      const r = rowsShared(l, p);
      // Most rows shared; on a tie the upper line (smaller y centre).
      if (
        r > 0 &&
        (r > shared ||
          (r === shared && home && l.y0 + l.y1 < home.y0 + home.y1))
      ) {
        shared = r;
        home = l;
      }
    }
    let best = -1;
    let bestKey: number[] = [];
    for (const k of home ? home.bodies : allBodies) {
      const host = pieces[k]!;
      const gap = markGap(p, host);
      if (gap < 0) continue;
      // Above first, then nearest, then the biggest host, then scan order.
      const key = [p.y1 < host.y0 ? 0 : 1, gap, -host.area, k];
      if (best < 0 || before(key, bestKey)) {
        best = k;
        bestKey = key;
      }
    }
    if (best >= 0) hostOf[i] = best;
    else if (home) home.units.push(i);
    else extra.push({ y0: p.y0, y1: p.y1, bodies: [], units: [i] });
  }
  const ordered = [...lines, ...extra].sort(
    (a, b) => a.y0 + a.y1 - (b.y0 + b.y1) || a.y0 - b.y0,
  );

  // 4.
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const lineOfLetter: number[] = [];
  const letterOfPiece = new Array<number>(pieces.length).fill(-1);
  ordered.forEach((line, lineIndex) => {
    const members = [...line.units].sort(
      (a, b) =>
        pieces[a]!.x0 + pieces[a]!.x1 - (pieces[b]!.x0 + pieces[b]!.x1) ||
        a - b,
    );
    let last: { x0: number; y0: number; x1: number; y1: number } | null = null;
    for (const m of members) {
      const p = pieces[m]!;
      if (last) {
        const overlap = Math.min(last.x1, p.x1) - Math.max(last.x0, p.x0) + 1;
        const narrower = Math.min(last.x1 - last.x0 + 1, widthOf(p));
        if (overlap > 0.5 * narrower) {
          last.x0 = Math.min(last.x0, p.x0);
          last.y0 = Math.min(last.y0, p.y0);
          last.x1 = Math.max(last.x1, p.x1);
          last.y1 = Math.max(last.y1, p.y1);
          letterOfPiece[m] = boxes.length - 1;
          continue;
        }
      }
      last = { x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 };
      letterOfPiece[m] = boxes.length;
      boxes.push(last);
      lineOfLetter.push(lineIndex);
    }
  });
  // Attached marks join their host's letter (a host is always a body, so
  // there are no chains of marks).
  pieces.forEach((p, i) => {
    const host = hostOf[i]!;
    if (host < 0) return;
    const k = letterOfPiece[host]!;
    letterOfPiece[i] = k;
    const b = boxes[k]!;
    b.x0 = Math.min(b.x0, p.x0);
    b.y0 = Math.min(b.y0, p.y0);
    b.x1 = Math.max(b.x1, p.x1);
    b.y1 = Math.max(b.y1, p.y1);
  });
  return {
    letters: boxes.map((b, k) => ({ ...b, line: lineOfLetter[k]!, index: k })),
    letterOfPiece,
  };
}

/**
 * The letters as the caller knows them: which glyph each pixel was drawn by.
 * The stage lays the headline out on a canvas itself, so it can draw each
 * glyph on its own and label every pixel with the glyph that covers it most.
 * With these nothing is guessed from shapes.
 */
export interface LetterLabels {
  /** Per pixel, row by row (the mask's size): 0 for no letter, k + 1 for letter k in reading order. */
  readonly labels: ArrayLike<number>;
  /** Per letter k, its line: 0 for the first, then 0, 1, 2 … in reading order with no line left out. Its length is the number of letters. */
  readonly lines: readonly number[];
}

/** How far (px) a set pixel with no label may look for a labelled neighbour (anti-aliased edges): 2. */
export const LABEL_REACH = 2;

/**
 * The letters from the caller's labels: each letter's box over the mask's set
 * pixels with its label, and per pixel the letter it belongs to (-1 where the
 * mask is unset). A set pixel left unlabelled (the mask and the labels
 * disagree by an edge pixel) takes the label of the nearest labelled set
 * pixel within LABEL_REACH px (straight-line distance between pixel centres;
 * scan order on a tie); further than that throws, as do labels of the wrong
 * size or out of range, line numbers that are not 0, 1, 2 … in order with no
 * line left out, and a letter with no set pixel at all.
 */
export function lettersFromLabels(
  mask: Mask,
  given: LetterLabels,
): { letters: Letter[]; letterAt: Int32Array } {
  const { width, height, data } = mask;
  const count = given.lines.length;
  if (given.labels.length !== width * height) {
    throw new RangeError("labels must have one value per mask pixel");
  }
  given.lines.forEach((line, k) => {
    if (!Number.isInteger(line) || line < 0) {
      throw new RangeError("a letter's line is a whole number, 0 or more");
    }
    const before = k === 0 ? 0 : given.lines[k - 1]!;
    if (line < before) {
      throw new RangeError(
        "letters are in reading order: lines never go back up",
      );
    }
    if (line > before + 1 || (k === 0 && line !== 0)) {
      throw new RangeError(
        "lines are numbered 0, 1, 2 … with no line left out",
      );
    }
  });
  const letterAt = new Int32Array(width * height).fill(-1);
  for (let i = 0; i < data.length; i += 1) {
    const label = given.labels[i]!;
    if (!Number.isInteger(label) || label < 0 || label > count) {
      throw new RangeError(`a label is 0 to ${count}`);
    }
    if (data[i] === 1 && label > 0) letterAt[i] = label - 1;
  }
  const resolved = Int32Array.from(letterAt);
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] !== 1 || letterAt[i]! >= 0) continue;
    const x = i % width;
    const y = (i - x) / width;
    // The nearest labelled pixel by straight-line distance (centre to
    // centre, at most LABEL_REACH), first in scan order on a tie. It reads
    // the given labels only, never a label lent to another pixel, so a
    // label never reaches further than LABEL_REACH.
    let found = -1;
    let bestD2 = Infinity;
    const R = Math.floor(LABEL_REACH);
    for (let dy = -R; dy <= R; dy += 1) {
      for (let dx = -R; dx <= R; dx += 1) {
        const d2 = dx * dx + dy * dy;
        if (d2 === 0 || d2 > LABEL_REACH * LABEL_REACH || d2 >= bestD2)
          continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const k = letterAt[ny * width + nx]!;
        if (k < 0) continue;
        found = k;
        bestD2 = d2;
      }
    }
    if (found < 0) {
      throw new RangeError(
        `pixel (${x}, ${y}) is in the mask but no letter is within ${LABEL_REACH} px`,
      );
    }
    resolved[i] = found;
  }
  const boxes = Array.from({ length: count }, () => ({
    x0: Infinity,
    y0: Infinity,
    x1: -1,
    y1: -1,
  }));
  for (let i = 0; i < data.length; i += 1) {
    const k = resolved[i]!;
    if (k < 0) continue;
    const x = i % width;
    const y = (i - x) / width;
    const b = boxes[k]!;
    if (x < b.x0) b.x0 = x;
    if (y < b.y0) b.y0 = y;
    if (x > b.x1) b.x1 = x;
    if (y > b.y1) b.y1 = y;
  }
  boxes.forEach((b, k) => {
    if (b.x1 < 0) throw new RangeError(`letter ${k} has no pixel in the mask`);
  });
  return {
    letters: boxes.map((b, k) => ({ ...b, line: given.lines[k]!, index: k })),
    letterAt: resolved,
  };
}

/** The widest edge band `sampleMask` accepts (px). See `distanceToOutline` for why. */
export const MAX_EDGE_WIDTH = 16;

export interface MaskSampleOptions {
  /** Distance between neighbouring particles, px (`spacingForCount` estimates one for a budget). */
  readonly spacing: number;
  /** How far a particle may move off its grid place, as a share of the spacing (0 to 0.5, default 0.25). */
  readonly jitter?: number;
  /** A particle within this many px of the mask's edge is an edge particle (default 1.5, at most MAX_EDGE_WIDTH). */
  readonly edgeWidth?: number;
  /** The alpha a pixel needs to count as inside (default 128). */
  readonly threshold?: number;
  readonly seed: number;
  /**
   * Which glyph each pixel belongs to: the production path. Required unless
   * `guessLetters` is true.
   */
  readonly letters?: LetterLabels;
  /**
   * Guess the letters from shapes (`groupLetters`) instead: for tests and
   * tools only. Its known limits (see `groupLetters`) make it unfit for the
   * page; without `letters` and without this, `sampleMask` throws.
   */
  readonly guessLetters?: boolean;
  /** The most particles to return: more are thinned evenly, letter by letter (`thinToCount`). */
  readonly maxCount?: number;
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
 * About the spacing that puts `count` particles on `area` px of mask: one
 * particle per hexagonal cell, √3/2 · spacing². An ESTIMATE: the edges cut
 * cells in half, so the real count can be over or under; pass `maxCount` to
 * `sampleMask` for a hard limit.
 */
export function spacingForCount(area: number, count: number): number {
  if (!(area > 0) || !Number.isFinite(area)) {
    throw new RangeError("area must be a positive number");
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError("count must be a positive whole number");
  }
  return Math.sqrt(area / (count * (Math.sqrt(3) / 2)));
}

/** `count` indices spread evenly over 0 to n - 1 (each cell's middle), in order. n ≥ count. */
const evenPick = (n: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) =>
    Math.min(n - 1, Math.floor(((i + 0.5) * n) / count)),
  );

/**
 * Keep at most `maxCount` of `particles` (sorted by `order`, as `sampleMask`
 * returns them), deterministically and fairly:
 *
 * - With at least one particle per letter to spare, every letter keeps one
 *   and the rest is shared in proportion to each letter's count (largest
 *   remainder, earlier letters first on a tie). With fewer than the letters,
 *   letters spread evenly through the reading order keep one each.
 * - Inside a letter, edge and inner particles keep their shares (rounded), and
 *   each share is an even pick through its particles in reading order. So the
 *   cut never falls on the end of the headline, and the outline stays.
 *
 * Returns them in their original order. Fewer than `maxCount` comes back
 * unchanged: the caller keeps the rest of its budget (the finale lets those
 * particles stay with the hand or stay unlit).
 */
export function thinToCount(
  particles: readonly MaskParticle[],
  letterCount: number,
  maxCount: number,
): MaskParticle[] {
  if (!Number.isInteger(maxCount) || maxCount < 0) {
    throw new RangeError("maxCount must be a whole number, 0 or more");
  }
  if (particles.length <= maxCount) return [...particles];
  if (maxCount === 0) return [];
  if (!Number.isInteger(letterCount) || letterCount < 0) {
    throw new RangeError("letterCount must be a whole number, 0 or more");
  }
  const byLetter = Array.from({ length: letterCount }, () => [] as number[]);
  particles.forEach((p, i) => {
    if (
      !Number.isInteger(p.letter) ||
      p.letter < 0 ||
      p.letter >= letterCount
    ) {
      throw new RangeError(
        `particle ${i} is in letter ${p.letter}, outside 0 to ${letterCount - 1}`,
      );
    }
    byLetter[p.letter]!.push(i);
  });
  const present = byLetter
    .map((list, k) => (list.length > 0 ? k : -1))
    .filter((k) => k >= 0);
  const quota = new Array<number>(letterCount).fill(0);
  if (maxCount < present.length) {
    for (const i of evenPick(present.length, maxCount)) quota[present[i]!] = 1;
  } else {
    // One each, then the rest in proportion to what each letter has beyond it.
    for (const k of present) quota[k] = 1;
    const spare = maxCount - present.length;
    const beyond = particles.length - present.length;
    // Whole numbers throughout, so equal remainders are equal and the tie
    // really goes to the earlier letter.
    const part = present.map((k) => spare * (byLetter[k]!.length - 1));
    present.forEach((k, n) => (quota[k] += Math.floor(part[n]! / beyond)));
    let left = maxCount - quota.reduce((s, q) => s + q, 0);
    const byFraction = present
      .map((k, n) => ({ k, f: part[n]! % beyond }))
      .sort((a, b) => b.f - a.f || a.k - b.k);
    for (const { k } of byFraction) {
      if (left === 0) break;
      quota[k] += 1;
      left -= 1;
    }
  }
  const keep: number[] = [];
  byLetter.forEach((list, k) => {
    const q = quota[k]!;
    if (q === 0) return;
    const edge = list.filter((i) => particles[i]!.edge);
    const inner = list.filter((i) => !particles[i]!.edge);
    let qe = Math.round((q * edge.length) / list.length);
    qe = Math.min(edge.length, Math.max(q - inner.length, qe));
    for (const i of evenPick(edge.length, qe)) keep.push(edge[i]!);
    for (const i of evenPick(inner.length, q - qe)) keep.push(inner[i]!);
  });
  keep.sort((a, b) => a - b);
  return keep.map((i) => particles[i]!);
}

/**
 * Fill a mask with particles on a hexagonal grid (each row offset by half a
 * spacing, rows √3/2 spacing apart), each nudged by a small seeded jitter and
 * kept only if it lands inside. A letter the grid misses altogether (a thin
 * one at a coarse spacing) gets one particle at the centre of its deepest
 * pixel, so every letter is there. Then, with `maxCount`, `thinToCount`.
 * Returns the particles sorted by `order` (left to right, letter by letter)
 * and the letters. Same mask, options and seed give the same particles.
 *
 * Quality: thinning keeps a fair share per letter but not an even spacing.
 * Halving a full mask with `thinToCount` left nearest-neighbour distances
 * of p5 1.32 px / median 1.71 px in the review's measurement, where
 * resampling at spacing · √2 gave 1.79 px / 2.22 px. When the grid is more than
 * about 5 % over `maxCount`, resample first at spacing · √(n / maxCount)
 * and let `maxCount` trim only the rest.
 *
 * Cost: the grid is (width × height) / spacing² places; each kept particle
 * reads about (2 · edgeWidth + 3)² mask pixels (`distanceToOutline`), which
 * is why `edgeWidth` is capped at MAX_EDGE_WIDTH.
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
  if (!(edgeWidth >= 0 && edgeWidth <= MAX_EDGE_WIDTH)) {
    throw new RangeError(`edgeWidth is 0 to ${MAX_EDGE_WIDTH} px`);
  }
  const mask = thresholdMask(alpha, width, height, options.threshold ?? 128);
  let letters: Letter[];
  let letterAt: (pixel: number) => number;
  if (options.letters && options.guessLetters) {
    throw new RangeError("pass letters or guessLetters, not both");
  }
  if (!options.letters && options.guessLetters !== true) {
    throw new RangeError(
      "sampleMask needs the letters (labels per pixel); guessLetters: true is for tests and tools only",
    );
  }
  if (options.letters) {
    const known = lettersFromLabels(mask, options.letters);
    letters = known.letters;
    letterAt = (pixel) => known.letterAt[pixel]!;
  } else {
    const { labels, pieces } = labelPieces(mask);
    const grouped = groupLetters(pieces);
    letters = grouped.letters;
    letterAt = (pixel) => grouped.letterOfPiece[labels[pixel]!]!;
  }
  const count = Math.max(1, letters.length);
  const particle = (x: number, y: number): MaskParticle => {
    const letter = letterAt(Math.floor(y) * width + Math.floor(x));
    const box = letters[letter]!;
    const across = (x - box.x0) / (box.x1 + 1 - box.x0);
    return {
      x,
      y,
      edge: distanceToOutline(mask, x, y, edgeWidth) <= edgeWidth,
      letter,
      order: Math.min(1, (letter + Math.min(1, Math.max(0, across))) / count),
    };
  };
  const random = mulberry32(seed);
  const row = (spacing * Math.sqrt(3)) / 2;
  const particles: MaskParticle[] = [];
  const seen = new Array<boolean>(letters.length).fill(false);
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
      const p = particle(x, y);
      seen[p.letter] = true;
      particles.push(p);
    }
  }
  if (seen.some((s) => !s)) {
    // The deepest pixel of each missed letter (first in scan order on a tie).
    const depth = depthInside(mask);
    const deepest = new Array<number>(letters.length).fill(-1);
    for (let i = 0; i < depth.length; i += 1) {
      if (mask.data[i] !== 1) continue;
      const k = letterAt(i);
      if (seen[k]) continue;
      if (deepest[k]! < 0 || depth[i]! > depth[deepest[k]!]!) deepest[k] = i;
    }
    deepest.forEach((pixel) => {
      if (pixel < 0) return;
      const x = pixel % width;
      particles.push(particle(x + 0.5, (pixel - x) / width + 0.5));
    });
  }
  particles.sort((a, b) => a.order - b.order || a.y - b.y || a.x - b.x);
  return {
    particles:
      options.maxCount === undefined
        ? particles
        : thinToCount(particles, letters.length, options.maxCount),
    letters,
  };
}
