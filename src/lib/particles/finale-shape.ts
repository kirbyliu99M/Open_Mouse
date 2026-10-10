import {
  FINALE_SKETCH,
  type FinaleKind,
  type FinaleTargets,
  type FinaleTierName,
  KIND_LEVELS,
} from "./finale-targets";
import type { TargetPoint } from "./sampling";
import type { ShapeTarget } from "./targets";

/**
 * The finale's drawing as the story's last state (home finale, stage 2): the
 * stage pairs the hand with it the way it paired the hand with a mouse sketch,
 * so the drawing is handed over as a `ShapeTarget` (points with a tone, and
 * the runs of each path). Pure: no DOM.
 */

/** The name the stage files the finale's drawing under in `targets.mice`, per density tier. */
export function finaleSlotName(tier: FinaleTierName): string {
  return `${FINALE_SKETCH}@${tier}`;
}

/**
 * Whether a finale particle of this kind and level is drawn bright (tone 1)
 * or as dust (tone 0) when it is lit: the nails' highlights, the brighter half
 * of the knuckle and nail lines, the brighter two thirds of the mouse's stars
 * and the brighter dust of the hand's outline (toward the fingertips) are
 * bright; the loose grains and the mouse's inner rim are dust. 未拍板
 * (candidate), tuned by eye from screenshots against the v8 frames.
 */
export const FINALE_BRIGHT_FROM: Readonly<Record<FinaleKind, number>> = {
  0: 4, // dust
  1: Infinity, // satellite
  2: 2, // detail
  3: 0, // highlight
  4: 2, // star
  5: Infinity, // rim
};

export function finaleTone(kind: FinaleKind, level: number): 0 | 1 {
  const levels = KIND_LEVELS[kind];
  if (levels === undefined) throw new RangeError(`no finale kind ${kind}`);
  if (!Number.isInteger(level) || level < 0 || level >= levels) {
    throw new RangeError(`level ${level} is outside kind ${kind}'s levels`);
  }
  return level >= FINALE_BRIGHT_FROM[kind] ? 1 : 0;
}

/**
 * One tier of the finale as a shape: its points moved so the drawing's viewBox
 * starts at (0, 0) (so `mouseBox` maps it onto the static image, which shows
 * exactly the viewBox), a tone each (`finaleTone`), and a run per path with
 * the path's own closed flag.
 */
export function finaleShape(
  finale: FinaleTargets,
  tier: FinaleTierName,
): ShapeTarget {
  const { viewBox } = finale;
  const t = finale.tiers[tier];
  const points: TargetPoint[] = t.points.map((p) => ({
    x: p.x - viewBox.x,
    y: p.y - viewBox.y,
    tone: finaleTone(p.kind, p.level),
  }));
  const runs = t.runs.map((run) => ({
    start: run.start,
    count: run.count,
    closed: finale.lines[run.path]?.closed ?? false,
  }));
  return { width: viewBox.width, height: viewBox.height, points, runs };
}

/** A glyph's box in a headline mask (px, edges at whole or fractional px), and its line. */
export interface GlyphBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly line: number;
}

/**
 * Which glyph each pixel of a `width × height` mask belongs to, from the
 * glyphs' boxes as the page laid them out (text-mask.ts's `LetterLabels`):
 * a pixel takes the line whose rows hold its centre (the nearest line when
 * none does), then the glyph of that line whose box holds its centre across,
 * or the nearest one. So every pixel has a glyph, and an anti-aliased edge or
 * an overhang just outside a box goes to its own glyph's neighbour only when
 * that is nearer. `glyphs` are in reading order; their lines 0, 1, 2 … in
 * order. Returns the labels (0 for none is never used: k + 1 for glyph k) and
 * each glyph's line.
 */
export function labelsFromGlyphs(
  width: number,
  height: number,
  glyphs: readonly GlyphBox[],
): { labels: Int32Array; lines: number[] } {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new RangeError("width and height are whole numbers");
  }
  if (width < 1 || height < 1) throw new RangeError("an empty mask");
  if (glyphs.length === 0) throw new RangeError("no glyphs");
  const lineCount = Math.max(...glyphs.map((g) => g.line)) + 1;
  const rows = Array.from({ length: lineCount }, () => ({
    top: Infinity,
    bottom: -Infinity,
    glyphs: [] as number[],
  }));
  glyphs.forEach((g, k) => {
    if (!(g.right >= g.left) || !(g.bottom >= g.top)) {
      throw new RangeError(`glyph ${k}'s box is upside down`);
    }
    const row = rows[g.line];
    if (!row || !Number.isInteger(g.line)) {
      throw new RangeError(`glyph ${k}'s line is not 0 to ${lineCount - 1}`);
    }
    row.top = Math.min(row.top, g.top);
    row.bottom = Math.max(row.bottom, g.bottom);
    row.glyphs.push(k);
  });
  rows.forEach((row, i) => {
    if (row.glyphs.length === 0) throw new RangeError(`line ${i} is empty`);
  });
  const lineOfRow = new Int32Array(height);
  for (let y = 0; y < height; y += 1) {
    const cy = y + 0.5;
    let best = 0;
    let bestD = Infinity;
    rows.forEach((row, i) => {
      const d =
        cy < row.top ? row.top - cy : cy > row.bottom ? cy - row.bottom : 0;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    lineOfRow[y] = best;
  }
  // Per line, the glyph of every column (the same for every row of the line).
  const columns = rows.map((row) => {
    const out = new Int32Array(width);
    for (let x = 0; x < width; x += 1) {
      const cx = x + 0.5;
      let best = row.glyphs[0]!;
      let bestD = Infinity;
      for (const k of row.glyphs) {
        const g = glyphs[k]!;
        const d = cx < g.left ? g.left - cx : cx > g.right ? cx - g.right : 0;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      out[x] = best + 1;
    }
    return out;
  });
  const labels = new Int32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    labels.set(columns[lineOfRow[y]!]!, y * width);
  }
  return { labels, lines: glyphs.map((g) => g.line) };
}
