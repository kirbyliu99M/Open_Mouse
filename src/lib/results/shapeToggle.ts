/**
 * The results page's three-segment shape toggle (V3.2 U1, candidate / 未拍板):
 * 「綜合｜左右對稱｜人體工學」. It is not a filter of its own: each segment is
 * a value of the filter's 滑鼠握感 group (`filters.shape`), so the toggle and
 * the filter panel always show the same thing, and switching asks the server
 * for nothing (`filteredView` does the work). Pure, no React.
 */
import { TOP_PICK_COUNT } from "./rankRoutes";
import {
  clearGroup,
  emptyFilters,
  FILTER_GROUPS,
  setSelection,
  type Filters,
  type ShapeOption,
} from "./filters";

/** The segments, in the order they are drawn (left to right). */
export const SHAPE_SEGMENTS = ["overall", "symmetrical", "ergonomic"] as const;
export type ShapeSegment = (typeof SHAPE_SEGMENTS)[number];

/**
 * The segment the filters stand for: 「綜合」 with no shape chosen, the one
 * shape when exactly one is chosen, and `null` when both shapes are chosen in
 * the panel (no segment says that, so none is selected).
 */
export function segmentOf(filters: Filters): ShapeSegment | null {
  if (filters.shape.length === 0) return "overall";
  if (filters.shape.length === 1) return filters.shape[0]!;
  return null;
}

/**
 * The filters with the toggle set to `segment`: 「綜合」 drops the shape group,
 * a shape becomes the group's only option. Every other group is kept as it is,
 * and the shape group keeps its place in `order` while it has a choice.
 */
export function withSegment(filters: Filters, segment: ShapeSegment): Filters {
  return setSelection(filters, "shape", segment === "overall" ? [] : [segment]);
}

/**
 * Which way the content moves for a switch: +1 to a segment on the right,
 * -1 to one on the left, 0 for the same segment (or from no segment, when
 * there is no side to come from).
 */
export function segmentDirection(
  from: ShapeSegment | null,
  to: ShapeSegment,
): -1 | 0 | 1 {
  if (from === null) return 0;
  const d = SHAPE_SEGMENTS.indexOf(to) - SHAPE_SEGMENTS.indexOf(from);
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

/**
 * The segment a key moves to inside the toggle (radio-group keys): the arrows
 * step and wrap around, Home and End go to the ends. `null` for any other key.
 * With no segment selected, a step forward starts at the first one and a step
 * back at the last one.
 */
export function segmentForKey(
  current: ShapeSegment | null,
  key: string,
): ShapeSegment | null {
  const n = SHAPE_SEGMENTS.length;
  const at = current === null ? -1 : SHAPE_SEGMENTS.indexOf(current);
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return SHAPE_SEGMENTS[(at + 1) % n]!;
    case "ArrowLeft":
    case "ArrowUp":
      return SHAPE_SEGMENTS[at === -1 ? n - 1 : (at - 1 + n) % n]!;
    case "Home":
      return SHAPE_SEGMENTS[0];
    case "End":
      return SHAPE_SEGMENTS[n - 1]!;
    default:
      return null;
  }
}

/**
 * Whether the toggle shows the shape choice: one shape is chosen, so a
 * segment is checked. The chips row and the 「篩選（n）」 count beside it then
 * leave the shape out, so it is not said twice (the filter panel still shows
 * it). Both shapes chosen, no segment is checked and the chip stays.
 */
export function toggleShowsShape(filters: Filters): boolean {
  return filters.shape.length === 1;
}

/** What the chips row and the button's count show beside the toggle. */
export function filtersBesideToggle(filters: Filters): Filters {
  return toggleShowsShape(filters) ? clearGroup(filters, "shape") : filters;
}

/**
 * 「清除全部」 in the chips row beside the toggle: clears what the row shows,
 * and leaves the segment the toggle shows as it is.
 */
export function clearBesideToggle(filters: Filters): Filters {
  return toggleShowsShape(filters)
    ? setSelection(emptyFilters(), "shape", filters.shape)
    : emptyFilters();
}

/**
 * The shape when it is the only thing filtered on (one shape, no other group):
 * then the large card's place reads 「人體工學第 1 名」 rather than 「篩選後第 1
 * 名」. `null` otherwise.
 */
export function segmentOnly(filters: Filters): ShapeOption | null {
  if (filters.shape.length !== 1) return null;
  const others = FILTER_GROUPS.filter((g) => g !== "shape");
  if (others.some((g) => filters[g].length > 0)) return null;
  return filters.shape[0]!;
}

/**
 * The 「只有 N 款，全部列在這裡」 note under a shape segment that has only a few
 * mice: 2 up to the number of picks the page shows (the large card plus the
 * other picks), so every one of them is already on the page. One mouse has
 * the filter's own 「只有這 1 款符合」, none has `FilterNoMatch`. Nothing is
 * added to fill the list.
 */
export function fewSegmentNote(
  filters: Filters,
  count: number,
): { shape: ShapeOption; count: number } | null {
  const segment = segmentOf(filters);
  if (segment === null || segment === "overall") return null;
  if (count < 2 || count > TOP_PICK_COUNT) return null;
  return { shape: segment, count };
}

/**
 * The toggle's motion (candidate, Kirby 2026-10-20/21 design): the white pill
 * slides to its segment; the large card leaves towards the side the person
 * moved to and the new one comes in from the other side; the other picks fade
 * in one row after another. Only transform and opacity move. With reduced
 * motion every part is a short fade with no movement.
 */
export const TOGGLE_MOTION = {
  /** The pill's slide (ease-out, no overshoot). */
  PILL_MS: 220,
  /** The old large card fading out. */
  OUT_MS: 160,
  /** The new large card fading in. */
  IN_MS: 220,
  /** How far the large card moves (px). */
  SHIFT_PX: 24,
  /** Each row of the list starts this much after the one above it. */
  ROW_STAGGER_MS: 30,
  /** Only this many rows fade in; any row after them appears at once. */
  ROW_STAGGER_ROWS: 5,
  /** Reduced motion: every fade, in and out, no movement. */
  REDUCED_MS: 120,
  /** The ease-out of the pill and of the cards coming in. */
  EASE_OUT: "cubic-bezier(0.2, 0.8, 0.2, 1)",
} as const;

export interface CardMotion {
  outMs: number;
  inMs: number;
  /** Where the old card goes (px, along x). */
  outToPx: number;
  /** Where the new card comes from (px, along x). */
  inFromPx: number;
}

/**
 * The large card's motion for a switch in direction `dir`: moving right (+1)
 * the old card leaves to the left and the new one comes from the right, as a
 * page that is pushed along. Reduced motion, or no direction: fades only.
 */
export function cardMotion(
  dir: -1 | 0 | 1,
  reducedMotion: boolean,
): CardMotion {
  if (reducedMotion) {
    return {
      outMs: TOGGLE_MOTION.REDUCED_MS,
      inMs: TOGGLE_MOTION.REDUCED_MS,
      outToPx: 0,
      inFromPx: 0,
    };
  }
  const shift = TOGGLE_MOTION.SHIFT_PX * dir;
  return {
    outMs: TOGGLE_MOTION.OUT_MS,
    inMs: TOGGLE_MOTION.IN_MS,
    // `+ 0` turns a -0 (no direction) into 0.
    outToPx: -shift + 0,
    inFromPx: shift + 0,
  };
}

/**
 * When the row at `index` (0 = the top one) of the list starts fading in
 * (ms), or `null` for a row past the first five, which appears at once with
 * no fade. Reduced motion starts the five at the same moment.
 */
export function rowDelayMs(
  index: number,
  reducedMotion: boolean,
): number | null {
  if (!Number.isFinite(index) || index < 0) return null;
  const row = Math.floor(index);
  if (row >= TOGGLE_MOTION.ROW_STAGGER_ROWS) return null;
  return reducedMotion ? 0 : row * TOGGLE_MOTION.ROW_STAGGER_MS;
}
