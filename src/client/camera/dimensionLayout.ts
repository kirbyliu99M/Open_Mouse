/**
 * Where the measured photo's two dimension lines and their labels go (pure, so
 * it can be tested without drawing anything; FrozenPhoto.tsx draws the result).
 * Sizes that must be the same on screen whatever the photo's resolution are
 * given in screen pixels and converted through `scale`, the overlay units per
 * on-screen pixel (see overlayUnitsPerPx).
 */
import {
  boxesOverlap,
  computeDimensionLine,
  separateLabelBoxes,
  type Box,
  type DimensionLineGeometry,
} from "../geometry/handSilhouette";
import { clampInto } from "./photoLayout";
import type { Point, Rect } from "./quad";

export interface DimensionSpec {
  readonly a: Point;
  readonly b: Point;
  readonly label: string;
  readonly side: 1 | -1;
}

export interface DimensionLayout {
  readonly geometries: readonly DimensionLineGeometry[];
  /** One centred label pill per spec. */
  readonly boxes: readonly Box[];
  readonly fontSize: number;
}

/**
 * @param visible the part of the overlay that is on screen (the live frame's
 *   crop, in overlay units), if known. The labels are a fixed size on screen, so
 *   on a photo shrunk to its smallest scale one would otherwise hang over the
 *   photo's edge and be cut off by it: each is kept wholly inside `visible`.
 */
export function layoutDimensions(
  specs: readonly DimensionSpec[],
  scale: number,
  visible?: Rect,
): DimensionLayout {
  const offsetPx = 22 * scale;
  const tickLengthPx = 8 * scale;
  const labelOffsetPx = 14 * scale;
  const fontSize = 13 * scale;
  const paddingX = 8 * scale;
  const labelHeight = 22 * scale;

  const geometries = specs.map((s) =>
    computeDimensionLine(
      s.a,
      s.b,
      offsetPx,
      s.side,
      tickLengthPx,
      labelOffsetPx,
    ),
  );
  const rawBoxes: Box[] = geometries.map((g, i) => ({
    x: g.labelAnchor.x,
    y: g.labelAnchor.y,
    width: specs[i].label.length * fontSize * 0.62 + paddingX * 2,
    height: labelHeight,
  }));
  return { geometries, boxes: placeLabels(rawBoxes, visible), fontSize };
}

const EPSILON = 1e-6;

/** `box`, moved the least that puts it wholly inside `area`. */
function intoArea(box: Box, area: Rect): Box {
  return {
    ...box,
    x: clampInto(box.x, box.width, area.x, area.width),
    y: clampInto(box.y, box.height, area.y, area.height),
  };
}

/**
 * Two boxes pulled apart along one axis, inside `area`: the one with the
 * smaller centre first, centred on where the pair was, as far apart as they
 * need to be, and slid back in if that put one over an edge. Only possible
 * when both fit along the axis side by side (`fitsAlong`).
 */
function spreadAlong(
  a: Box,
  b: Box,
  axis: "x" | "y",
  area: Rect,
): readonly [Box, Box] {
  const size = axis === "x" ? "width" : "height";
  const aFirst = a[axis] <= b[axis];
  const first = aFirst ? a : b;
  const second = aFirst ? b : a;
  const need = (first[size] + second[size]) / 2 + EPSILON;
  const mid = (first[axis] + second[axis]) / 2;
  let p1 = mid - need / 2;
  let p2 = mid + need / 2;
  const low = area[axis] + first[size] / 2;
  const high = area[axis] + area[size] - second[size] / 2;
  if (p1 < low) {
    p2 += low - p1;
    p1 = low;
  }
  if (p2 > high) {
    p1 -= p2 - high;
    p2 = high;
  }
  const moved1 = { ...first, [axis]: p1 };
  const moved2 = { ...second, [axis]: p2 };
  return aFirst ? [moved1, moved2] : [moved2, moved1];
}

const fitsAlong = (a: Box, b: Box, axis: "x" | "y", area: Rect): boolean =>
  axis === "x"
    ? a.width + b.width + 2 * EPSILON <= area.width
    : a.height + b.height + 2 * EPSILON <= area.height;

/**
 * Where the label pills go, given where each wants to be (`raw`, centres).
 *
 * Without `visible`, the two are only decluttered from each other
 * (`separateLabelBoxes`). With it, they must also lie wholly inside it, and
 * the order matters: each is kept inside FIRST, then the two are pushed apart,
 * and pushing apart can push one out again (or clamping can stack the two on
 * the same spot), so it is kept inside once more and checked. A few rounds of
 * that settle nearly every case; what is left is spread along whichever axis has
 * room for both side by side, so two labels that fit the photo never overlap
 * each other and never leave it. (If they cannot both fit, they stay inside.)
 */
export function placeLabels(raw: readonly Box[], visible?: Rect): Box[] {
  if (!visible)
    return raw.length === 2
      ? [...separateLabelBoxes(raw[0], raw[1])]
      : [...raw];
  let boxes = raw.map((box) => intoArea(box, visible));
  if (boxes.length !== 2) return boxes;
  for (let round = 0; round < 4 && boxesOverlap(boxes[0], boxes[1]); round++) {
    const [a, b] = separateLabelBoxes(boxes[0], boxes[1]);
    boxes = [intoArea(a, visible), intoArea(b, visible)];
  }
  if (boxesOverlap(boxes[0], boxes[1])) {
    const options = (["x", "y"] as const)
      .filter((axis) => fitsAlong(boxes[0], boxes[1], axis, visible))
      .map((axis) => spreadAlong(boxes[0], boxes[1], axis, visible))
      .map((pair) => ({
        pair,
        moved:
          Math.hypot(pair[0].x - boxes[0].x, pair[0].y - boxes[0].y) +
          Math.hypot(pair[1].x - boxes[1].x, pair[1].y - boxes[1].y),
      }))
      .sort((p, q) => p.moved - q.moved);
    if (options.length > 0) boxes = [...options[0].pair];
  }
  return boxes;
}
