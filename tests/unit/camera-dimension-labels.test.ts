import { describe, expect, it } from "vitest";
import {
  layoutDimensions,
  type DimensionSpec,
} from "../../src/client/camera/dimensionLayout";
import type { Rect } from "../../src/client/camera/quad";

/**
 * A hand near the right-hand side of a 1000 x 1000 photo: the length line is
 * beside the middle finger, the palm line across it. Labels go to the right of
 * a line, where the photo runs out first.
 */
const SPECS: DimensionSpec[] = [
  {
    a: { x: 800, y: 200 },
    b: { x: 800, y: 800 },
    label: "Hand 190 mm",
    side: -1,
  },
  {
    a: { x: 650, y: 600 },
    b: { x: 900, y: 600 },
    label: "Palm 84 mm",
    side: 1,
  },
];
const PHOTO: Rect = { x: 0, y: 0, width: 1000, height: 1000 };

const inside = (
  box: { x: number; y: number; width: number; height: number },
  area: Rect,
) =>
  box.x - box.width / 2 >= area.x - 1e-9 &&
  box.x + box.width / 2 <= area.x + area.width + 1e-9 &&
  box.y - box.height / 2 >= area.y - 1e-9 &&
  box.y + box.height / 2 <= area.y + area.height + 1e-9;

describe("layoutDimensions: the labels stay on the visible photo", () => {
  it("at a large photo scale a label runs off the edge of the photo unless it is kept in", () => {
    // 1 px on screen = 3 overlay units: a photo drawn small, labels large.
    const loose = layoutDimensions(SPECS, 3);
    expect(loose.boxes.every((box) => inside(box, PHOTO))).toBe(false);
  });

  it("with the visible area given, every label lies wholly inside it, at every scale", () => {
    for (const scale of [0.5, 1, 2, 3, 4]) {
      const { boxes } = layoutDimensions(SPECS, scale, PHOTO);
      expect(boxes).toHaveLength(2);
      for (const box of boxes)
        expect(inside(box, PHOTO), `scale ${scale}`).toBe(true);
    }
  });

  it("a crop that starts part-way into the photo is respected on every side", () => {
    const crop: Rect = { x: 300, y: 100, width: 600, height: 700 };
    const { boxes } = layoutDimensions(SPECS, 2.5, crop);
    for (const box of boxes) expect(inside(box, crop)).toBe(true);
  });

  it("labels that already fit are left exactly where they were", () => {
    const loose = layoutDimensions(SPECS, 0.5);
    const kept = layoutDimensions(SPECS, 0.5, PHOTO);
    expect(kept.boxes).toEqual(loose.boxes);
  });

  it("the lines themselves are not moved, only the labels", () => {
    const loose = layoutDimensions(SPECS, 3);
    const kept = layoutDimensions(SPECS, 3, PHOTO);
    expect(kept.geometries).toEqual(loose.geometries);
    expect(kept.fontSize).toBe(loose.fontSize);
  });
});
