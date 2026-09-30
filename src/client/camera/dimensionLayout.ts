/**
 * Where the measured photo's two dimension lines and their labels go (pure, so
 * it can be tested without drawing anything; FrozenPhoto.tsx draws the result).
 * Sizes that must be the same on screen whatever the photo's resolution are
 * given in screen pixels and converted through `scale`, the overlay units per
 * on-screen pixel (see overlayUnitsPerPx).
 */
import {
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
  const separated =
    rawBoxes.length === 2
      ? separateLabelBoxes(rawBoxes[0], rawBoxes[1])
      : rawBoxes;
  const boxes = visible
    ? separated.map((box) => ({
        ...box,
        x: clampInto(box.x, box.width, visible.x, visible.width),
        y: clampInto(box.y, box.height, visible.y, visible.height),
      }))
    : separated;
  return { geometries, boxes, fontSize };
}
