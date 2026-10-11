/**
 * The four line drawings under "Look at the shape" on /learn (LEARN-5,
 * candidate / 未拍板) and where each text mark sits on them.
 *
 * Numbers only, no words: the words are in src/lib/copy/learn-page.ts
 * (`shape.marks`). The values are copied from the sketch package's
 * labels.json (sketch-pipeline/final-learn-annot/package/, outside this repo):
 * `viewBox` is its `cropViewBox`, a mark's x/y are in the same 512-unit space
 * as the drawing. The files in public/images/learn/shape-*.svg carry that same
 * viewBox (a unit test checks it), so a drawing and its mark are placed by the
 * same percentages whatever size the tile is.
 */
export type ShapeSketchId = "symmetrical" | "ergonomic" | "hump" | "flare";

/** The keys of `LearnPageCopy.shape.marks`. */
export type ShapeMarkKey =
  | "thumbRest"
  | "straightSide"
  | "centredPeak"
  | "rearPeak"
  | "widerFront"
  | "narrowerWaist"
  | "schematic";

export interface ShapeMark {
  key: ShapeMarkKey;
  /** The anchor of the text block's top, in the drawing's own units. */
  x: number;
  y: number;
  /** l: x is the left edge, r: the right edge, m: the middle of the text. */
  anchor: "l" | "m" | "r";
  tone: "primary" | "secondary";
  /**
   * Below 24rem (a 320 px phone) the drawing is about 230 px wide and the
   * 12 px text does not shrink, so a mark that would touch an arrow or the
   * outline is nudged by these drawing units (x: positive = right, y:
   * positive = down). Measured in a real browser at 320 px (LEARN-5).
   */
  narrow?: { dx?: number; dy?: number };
}

export interface ShapeSketch {
  id: ShapeSketchId;
  /** The crop: x, y, width, height in the 512-unit drawing space. */
  viewBox: { x: number; y: number; w: number; h: number };
  /** Whether a `shape-<id>-arrows.svg` overlay exists. */
  arrows: boolean;
  marks: readonly ShapeMark[];
}

export const SHAPE_SKETCHES: readonly ShapeSketch[] = [
  {
    id: "symmetrical",
    viewBox: { x: 0, y: 10, w: 512, h: 500 },
    arrows: true,
    // No text on this drawing (Kirby, 2026-10-11: the name under the tile is
    // enough, in both languages).
    marks: [],
  },
  {
    id: "ergonomic",
    viewBox: { x: 0, y: 20, w: 512, h: 470 },
    arrows: true,
    marks: [
      {
        key: "thumbRest",
        x: 18,
        y: 243,
        anchor: "l",
        tone: "primary",
        narrow: { dy: -6 },
      },
      {
        key: "straightSide",
        x: 396,
        y: 193,
        anchor: "l",
        tone: "secondary",
        narrow: { dy: -6 },
      },
    ],
  },
  {
    id: "hump",
    viewBox: { x: 0, y: 100, w: 512, h: 270 },
    arrows: true,
    marks: [
      {
        key: "centredPeak",
        x: 257,
        y: 136,
        anchor: "r",
        tone: "secondary",
        narrow: { dy: -22 },
      },
      {
        key: "rearPeak",
        x: 309,
        y: 136,
        anchor: "l",
        tone: "primary",
        narrow: { dy: -22 },
      },
    ],
  },
  {
    id: "flare",
    viewBox: { x: 0, y: 40, w: 512, h: 470 },
    arrows: true,
    marks: [
      {
        key: "widerFront",
        x: 18,
        y: 71,
        anchor: "l",
        tone: "primary",
        narrow: { dy: -6 },
      },
      {
        key: "narrowerWaist",
        x: 18,
        y: 196,
        anchor: "l",
        tone: "secondary",
        narrow: { dy: -16 },
      },
      { key: "schematic", x: 256, y: 490, anchor: "m", tone: "secondary" },
    ],
  },
];

/** The `viewBox` attribute text of a sketch's crop. */
export function viewBoxText(sketch: ShapeSketch): string {
  const { x, y, w, h } = sketch.viewBox;
  return `${x} ${y} ${w} ${h}`;
}

const percent = (value: number) => `${Number((value * 100).toFixed(2))}%`;

export interface MarkPlace {
  top: string;
  left?: string;
  right?: string;
}

/**
 * CSS offsets of a mark inside the drawing's box, in percent of that box: the
 * top edge from the top, and the text from the left (`l`, `m`) or from the
 * right (`r`, so the text ends at x and grows leftward).
 */
export function markPlacement(
  sketch: ShapeSketch,
  mark: ShapeMark,
  nudge: { dx?: number; dy?: number } = {},
): MarkPlace {
  const { x, y, w, h } = sketch.viewBox;
  const mx = mark.x + (nudge.dx ?? 0);
  const top = percent((mark.y + (nudge.dy ?? 0) - y) / h);
  if (mark.anchor === "r") {
    return { top, right: percent(1 - (mx - x) / w) };
  }
  return { top, left: percent((mx - x) / w) };
}

/** The same, below 24rem: the mark's `narrow` nudge applied (none: unchanged). */
export function markPlacementNarrow(
  sketch: ShapeSketch,
  mark: ShapeMark,
): MarkPlace {
  return markPlacement(sketch, mark, mark.narrow);
}
