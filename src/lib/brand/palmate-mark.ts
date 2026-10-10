/**
 * The Palmate mark as data, so a canvas can draw it with `Path2D` (crisp at
 * any size, nothing to load). It mirrors the Pencil frame "Logo · Palmate
 * (Official)" (`m8WzTO`), as quoted in PR #171. CANDIDATE (未拍板) until that
 * lands and Kirby has seen it on the share card.
 *
 * Coordinates are in the mark's own units: draw the viewBox, scaled to the
 * box you want. Stroke: round caps and joins, `PALMATE_MARK_STROKE_WIDTH`
 * units wide.
 */
export const PALMATE_MARK_VIEWBOX = { x: 10, y: 10, w: 70, h: 70 } as const;

export const PALMATE_MARK_PATH =
  "M38 48c0 4 4 6 7 4 3-2 3-8-1-11-6-4-16 1-18 11-2 12 10 20 22 20 12 0 22-8 24-22 1-12-4-24-8-28-2-2-5-1-5 2 0 8 4 20 3 30m-4-16c0-12-2-22-6-24-2-2-5-1-6 2-2 8 0 20 0 30m-2-14c-1-8-3-14-7-16-2-2-5-1-6 2-2 8 1 20 3 28m-4-10c-2-6-5-12-8-12-3 0-4 3-3 8 1 8 3 16 5 22";

/**
 * The mark's INK box in the same units: where paint actually lands, which is
 * smaller than the viewBox (the hand does not fill it). Derived once by walking
 * the path's cubic segments (2000 samples each) for their extremes, then adding
 * half the line width (0.7) for the round caps and joins, rounded outward to
 * two decimals: the path alone spans x 18.625 to 72.129 and y 12.959 to 72.000.
 * The core dot lies inside it. A unit test recomputes it from the path, so an
 * edit to the path that moves the ink fails there.
 */
export const PALMATE_MARK_INK = {
  x0: 17.92,
  y0: 12.25,
  x1: 72.83,
  y1: 72.7,
} as const;

/**
 * Where the ink lands when the viewBox is drawn into `box` (square, the mark's
 * own scale): left, top, right, bottom in the box's pixels.
 */
export function palmateMarkInkEdges(box: { x: number; y: number; w: number }) {
  const scale = box.w / PALMATE_MARK_VIEWBOX.w;
  const at = (v: number, origin: number, boxOrigin: number) =>
    boxOrigin + (v - origin) * scale;
  return {
    left: at(PALMATE_MARK_INK.x0, PALMATE_MARK_VIEWBOX.x, box.x),
    top: at(PALMATE_MARK_INK.y0, PALMATE_MARK_VIEWBOX.y, box.y),
    right: at(PALMATE_MARK_INK.x1, PALMATE_MARK_VIEWBOX.x, box.x),
    bottom: at(PALMATE_MARK_INK.y1, PALMATE_MARK_VIEWBOX.y, box.y),
  };
}

export const PALMATE_MARK_STROKE = "#7FA8FF";
export const PALMATE_MARK_STROKE_WIDTH = 1.4;

/**
 * The core dot. The spec gives its centre, its OUTER radius and two colours.
 * How wide the ring is was not given: `ringWidth` is the builder's guess.
 */
export const PALMATE_MARK_DOT = {
  cx: 45,
  cy: 53.5,
  outerRadius: 1.55,
  ringColor: "#2463EB",
  fillColor: "#CFE0FF",
  ringWidth: 0.5,
} as const;
