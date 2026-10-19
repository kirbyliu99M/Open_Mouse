import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ENDPOINT_DOT_DIAMETER_PX,
  layoutDimensions,
  placeLabels,
  type DimensionSpec,
} from "../../src/client/camera/dimensionLayout";
import {
  boxesOverlap,
  separateLabelBoxes,
  type Box,
} from "../../src/client/geometry/handSilhouette";
import type { Rect } from "../../src/client/camera/quad";
import { FrozenPhoto } from "../../src/client/camera/FrozenPhoto";
import type { FrozenPhotoLayout } from "../../src/client/camera/photoLayout";
import type { PhotoOverlay } from "../../src/client/photo/pipeline";

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

describe("placeLabels: inside the photo, and never over each other", () => {
  const AREA: Rect = { x: 100, y: 50, width: 800, height: 600 };
  const box = (x: number, y: number, width = 200, height = 40): Box => ({
    x,
    y,
    width,
    height,
  });

  it("a label past the top edge comes down until its top is on the edge", () => {
    const [placed] = placeLabels([box(500, -300)], AREA);
    expect(placed.y - placed.height / 2).toBeCloseTo(AREA.y, 9);
    expect(placed.x).toBe(500);
  });

  it("a label past the bottom edge comes up until its bottom is on the edge", () => {
    const [placed] = placeLabels([box(500, 2000)], AREA);
    expect(placed.y + placed.height / 2).toBeCloseTo(AREA.y + AREA.height, 9);
    expect(placed.x).toBe(500);
  });

  it("one label past the top and the other past the bottom: each is brought back from its own side", () => {
    const [top, bottom] = placeLabels([box(300, -900), box(700, 4000)], AREA);
    expect(top.y - top.height / 2).toBeCloseTo(AREA.y, 9);
    expect(bottom.y + bottom.height / 2).toBeCloseTo(AREA.y + AREA.height, 9);
  });

  it("a label past a corner is brought back on both axes", () => {
    const [placed] = placeLabels([box(-500, -500)], AREA);
    expect(placed.x - placed.width / 2).toBeCloseTo(AREA.x, 9);
    expect(placed.y - placed.height / 2).toBeCloseTo(AREA.y, 9);
  });

  it("a label already inside is left where it is", () => {
    expect(placeLabels([box(500, 300)], AREA)).toEqual([box(500, 300)]);
  });

  it("a label taller than the photo is centred on it, not pushed off the other side", () => {
    const [placed] = placeLabels([box(500, -100, 200, 900)], AREA);
    expect(placed.y).toBeCloseTo(AREA.y + AREA.height / 2, 9);
  });

  it("two labels that were apart but land on the same spot once clamped are pulled apart again, inside", () => {
    // Both far above the top edge, a little apart sideways: clamping puts both
    // against the top edge, overlapping.
    const [a, b] = placeLabels([box(480, -800), box(520, -900)], AREA);
    expect(boxesOverlap(a, b)).toBe(false);
    for (const placed of [a, b]) expect(inside(placed, AREA)).toBe(true);
  });

  it("two labels jammed into a corner: spread out, still inside", () => {
    const [a, b] = placeLabels([box(-50, -50), box(-40, -60)], AREA);
    expect(boxesOverlap(a, b)).toBe(false);
    for (const placed of [a, b]) expect(inside(placed, AREA)).toBe(true);
  });

  it("two labels that cannot sit side by side but can one above the other are stacked", () => {
    const narrow: Rect = { x: 0, y: 0, width: 260, height: 400 };
    // Each 200 wide: not both across 260; each 40 tall: both fit down 400.
    const [a, b] = placeLabels([box(130, 200), box(135, 205)], narrow);
    expect(boxesOverlap(a, b)).toBe(false);
    for (const placed of [a, b]) expect(inside(placed, narrow)).toBe(true);
  });

  it("without a visible area it is only the old declutter", () => {
    const raw = [box(500, 300), box(510, 305)];
    expect(placeLabels(raw)).toEqual([...separateLabelBoxes(raw[0], raw[1])]);
  });

  // A seeded generator, so a failure can be reproduced.
  function random(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("5000 random layouts (positions anywhere, in and far outside, often stacked on one spot): always inside, never overlapping", () => {
    const next = random(20261001);
    let crowded = 0;
    for (let n = 0; n < 5000; n++) {
      const area: Rect = {
        x: next() * 400,
        y: next() * 400,
        width: 300 + next() * 1700,
        height: 300 + next() * 1700,
      };
      // Sizes that can always be placed: side by side or one above the other.
      const sizes = [0, 1].map(() => ({
        width: 40 + next() * Math.min(500, area.width / 2 - 41),
        height: 10 + next() * Math.min(150, area.height / 2 - 11),
      }));
      // Where each wants to be: anywhere from two areas outside to two inside,
      // or (half the time) both near one spot, to make them collide.
      const near = next() < 0.5;
      const anchor = {
        x: area.x + (next() * 5 - 2) * area.width,
        y: area.y + (next() * 5 - 2) * area.height,
      };
      const raw: Box[] = sizes.map((size) => ({
        ...size,
        x: near
          ? anchor.x + (next() - 0.5) * 60
          : area.x + (next() * 5 - 2) * area.width,
        y: near
          ? anchor.y + (next() - 0.5) * 60
          : area.y + (next() * 5 - 2) * area.height,
      }));
      const placed = placeLabels(raw, area);
      if (boxesOverlap(placed[0], placed[1]))
        throw new Error(`layout ${n}: the labels overlap`);
      for (const p of placed)
        if (!inside(p, area))
          throw new Error(`layout ${n}: a label is outside`);
      if (near) crowded += 1;
    }
    expect(crowded).toBeGreaterThan(2000); // the layouts did stress the case
  });

  it("2000 random hands through layoutDimensions: both labels on the photo, never over each other", () => {
    const next = random(77);
    for (let n = 0; n < 2000; n++) {
      const photo: Rect = {
        x: 0,
        y: 0,
        width: 800 + next() * 2200,
        height: 800 + next() * 2200,
      };
      const point = () => ({
        x: photo.x + next() * photo.width,
        y: photo.y + next() * photo.height,
      });
      const specs: DimensionSpec[] = [
        {
          a: point(),
          b: point(),
          label: "Hand 190 mm",
          side: next() < 0.5 ? 1 : -1,
        },
        {
          a: point(),
          b: point(),
          label: "Palm 84 mm",
          side: next() < 0.5 ? 1 : -1,
        },
      ];
      // Labels from small to as large as at the smallest photo scale.
      const scale = 0.3 + next() * 2.7;
      const { boxes } = layoutDimensions(specs, scale, photo);
      if (boxesOverlap(boxes[0], boxes[1]))
        throw new Error(`hand ${n}: the labels overlap`);
      for (const b of boxes)
        if (!inside(b, photo)) throw new Error(`hand ${n}: a label is outside`);
    }
  });
});

describe("the dots on the measured points", () => {
  it("are 6 CSS px across, at any scale", () => {
    expect(ENDPOINT_DOT_DIAMETER_PX).toBe(6);
    for (const scale of [0.5, 1, 2.5]) {
      const { dotRadius } = layoutDimensions(SPECS, scale);
      expect(dotRadius).toBeCloseTo(3 * scale, 12);
    }
  });
});

describe("FrozenPhoto: dots, the scale on each axis, and the screens without them", () => {
  const layout: FrozenPhotoLayout = {
    box: { x: 0, y: 0, width: 390, height: 731 },
    crop: { x: 0, y: 0, width: 4001, height: 3000 },
  };
  const still = { width: 4001, height: 3000 };
  const overlay = (extra: Partial<PhotoOverlay> = {}): PhotoOverlay =>
    ({
      imageWidth: 3000,
      imageHeight: 2249,
      landmarksPx: null,
      paperCorners: null,
      ...extra,
    }) as PhotoOverlay;
  const dims: DimensionSpec[] = [
    {
      a: { x: 1234.5, y: 2200.25 },
      b: { x: 1300, y: 400 },
      label: "Hand 190 mm",
      side: 1,
    },
    {
      a: { x: 900.125, y: 1500 },
      b: { x: 1700, y: 1480.5 },
      label: "Palm 84 mm",
      side: 1,
    },
  ];
  const render = (
    props: Partial<Parameters<typeof FrozenPhoto>[0]> & {
      phase: "processing" | "measured" | "gateFailure";
    },
  ) =>
    renderToStaticMarkup(
      createElement(FrozenPhoto, {
        previewUrl: "blob:test",
        still,
        layout,
        overlay: overlay(),
        overlayToStill: 4001 / 3000,
        layerScale: 0.9,
        dimensions: dims,
        problem: null,
        ariaLabel: "photo",
        ...props,
      }),
    );
  const dots = (html: string) =>
    [...html.matchAll(/<circle[^>]*data-endpoint="([ab])"[^>]*>/g)].map(
      (m) => ({
        end: m[1],
        cx: Number(/cx="([^"]+)"/.exec(m[0])?.[1]),
        cy: Number(/cy="([^"]+)"/.exec(m[0])?.[1]),
        r: Number(/ r="([^"]+)"/.exec(m[0])?.[1]),
      }),
    );

  it("measured: a dot on every a and b, exactly on the spec's analysed-image coordinates (0 px)", () => {
    const html = render({
      phase: "measured",
      overlayToStillY: 3000 / 2249,
    });
    const found = dots(html);
    expect(found).toHaveLength(4);
    const want = [dims[0].a, dims[0].b, dims[1].a, dims[1].b];
    found.forEach((d, i) => {
      expect(d.cx - want[i].x).toBe(0);
      expect(d.cy - want[i].y).toBe(0);
      expect(d.r).toBeGreaterThan(0);
    });
    expect(found.map((d) => d.end)).toEqual(["a", "b", "a", "b"]);
  });

  it("the overlay group is scaled by its own ratio on each axis", () => {
    const html = render({
      phase: "measured",
      overlayToStillY: 3000 / 2249,
    });
    const m = /<g transform="scale\(([^ )]+) ([^)]+)\)">/.exec(html);
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeCloseTo(4001 / 3000, 12);
    expect(Number(m?.[2])).toBeCloseTo(3000 / 2249, 12);
  });

  it("equal ratios (no Y given): the same scale on both axes", () => {
    const html = render({
      phase: "measured",
      still: { width: 2000, height: 1500 },
      layout: {
        box: layout.box,
        crop: { x: 0, y: 0, width: 2000, height: 1500 },
      },
      overlay: overlay({ imageWidth: 1000, imageHeight: 750 }),
      overlayToStill: 2,
    });
    expect(html).toContain('transform="scale(2 2)"');
  });

  it("with a crop: the dots and the group are unchanged by it", () => {
    const html = render({
      phase: "measured",
      layout: {
        box: { x: -50, y: 0, width: 490, height: 731 },
        crop: { x: 300, y: 0, width: 3400, height: 3000 },
      },
      overlayToStill: 4001 / 3000,
      overlayToStillY: 3000 / 2249,
    });
    expect(dots(html)).toHaveLength(4);
    expect(html).toContain('viewBox="300 0 3400 3000"');
  });

  it("no overlay: nothing is drawn over the photo", () => {
    const html = render({ phase: "measured", overlay: null });
    expect(html).not.toContain("<circle");
    expect(html).not.toContain("scale(");
  });

  it("while processing: no dots, no group", () => {
    const html = render({ phase: "processing" });
    expect(html).not.toContain("<circle");
    expect(html).not.toContain("<g");
  });

  it("a failed photo: scaled the same, but no dimension lines and so no dots", () => {
    const html = render({
      phase: "gateFailure",
      overlayToStillY: 3000 / 2249,
      problem: { x: 100, y: 100, width: 400, height: 300 },
    });
    expect(html).toContain("easyProblem");
    expect(html).toMatch(/scale\(1\.3\d+ 1\.3\d+\)/);
    expect(dots(html)).toHaveLength(0);
  });

  it("measured without dimension specs: no dots", () => {
    expect(dots(render({ phase: "measured", dimensions: null }))).toHaveLength(
      0,
    );
  });
});
