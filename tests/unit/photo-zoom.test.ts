import { describe, expect, it } from "vitest";
import {
  DOUBLE_TAP_SCALE,
  KEY_PAN_STEP,
  MAX_SCALE,
  MIN_SCALE,
  RESET_VIEW,
  applyKeyAction,
  clampScale,
  clampView,
  isDoubleTap,
  keyZoom,
  maxPan,
  midpoint,
  panBy,
  pinchView,
  toggleZoom,
  viewTransform,
  wheelFactor,
  wheelZoom,
  zoomAt,
  zoomKeyAction,
  type Box,
  type ZoomView,
} from "../../src/lib/results/photoZoom";

const box: Box = { width: 400, height: 300 };
const centre = { x: 0, y: 0 };
const plain = { ctrlKey: false, metaKey: false, altKey: false };

describe("scale bounds", () => {
  it("holds the scale between 1x and 3x", () => {
    expect(clampScale(0.2)).toBe(MIN_SCALE);
    expect(clampScale(1)).toBe(1);
    expect(clampScale(2.2)).toBe(2.2);
    expect(clampScale(9)).toBe(MAX_SCALE);
    expect(MAX_SCALE).toBe(3);
  });

  it("falls back to 1x for a value that is not a number", () => {
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("never zooms past 3x or below 1x whatever the request", () => {
    expect(zoomAt(RESET_VIEW, 10, centre, box).scale).toBe(3);
    expect(zoomAt({ scale: 2, x: 0, y: 0 }, 0.1, centre, box).scale).toBe(1);
  });
});

describe("pan clamp", () => {
  it("allows no pan at 1x", () => {
    expect(maxPan(1, box)).toEqual({ x: 0, y: 0 });
    expect(clampView({ scale: 1, x: 80, y: -50 }, box)).toEqual(RESET_VIEW);
    expect(panBy(RESET_VIEW, 100, 100, box)).toEqual(RESET_VIEW);
  });

  it("allows half of the overhang on each axis at 3x", () => {
    // 3x of a 400 x 300 box is 1200 x 900, so it sticks out 400 x 300 each side.
    expect(maxPan(3, box)).toEqual({ x: 400, y: 300 });
    expect(panBy({ scale: 3, x: 0, y: 0 }, 9999, -9999, box)).toEqual({
      scale: 3,
      x: 400,
      y: -300,
    });
    expect(panBy({ scale: 3, x: 0, y: 0 }, 120, -80, box)).toEqual({
      scale: 3,
      x: 120,
      y: -80,
    });
  });

  it("keeps the edges of the photo at or outside the box edges", () => {
    for (const scale of [1.5, 2, 2.5, 3]) {
      const view = panBy({ scale, x: 0, y: 0 }, 1e6, 1e6, box);
      // Photo left edge on screen: x - scale * width / 2, never right of -w/2.
      expect(view.x - (scale * box.width) / 2).toBeLessThanOrEqual(
        -box.width / 2 + 1e-9,
      );
      expect(view.y - (scale * box.height) / 2).toBeLessThanOrEqual(
        -box.height / 2 + 1e-9,
      );
    }
  });

  it("pulls the pan back in when zooming out", () => {
    const out = zoomAt({ scale: 3, x: 400, y: 300 }, 1.5, centre, box);
    expect(out.scale).toBe(1.5);
    expect(out.x).toBeLessThanOrEqual(maxPan(1.5, box).x);
    expect(out.y).toBeLessThanOrEqual(maxPan(1.5, box).y);
    expect(zoomAt({ scale: 3, x: 400, y: 300 }, 1, centre, box)).toEqual(
      RESET_VIEW,
    );
  });

  it("treats a non-finite pan as 0", () => {
    expect(clampView({ scale: 2, x: Number.NaN, y: 10 }, box)).toEqual({
      scale: 2,
      x: 0,
      y: 10,
    });
  });
});

describe("zoom around a point", () => {
  it("keeps the point under the pointer where it was", () => {
    const focal = { x: 100, y: -60 };
    const view = zoomAt(RESET_VIEW, 2, focal, box);
    // A photo point p lands at x + s * p; the one under the focal point was
    // focal / 1 before, and must still land on focal.
    expect(view.x + view.scale * focal.x).toBeCloseTo(focal.x);
    expect(view.y + view.scale * focal.y).toBeCloseTo(focal.y);
  });

  it("zooms around the middle without moving the photo", () => {
    expect(zoomAt(RESET_VIEW, 2, centre, box)).toEqual({
      scale: 2,
      x: 0,
      y: 0,
    });
  });
});

describe("pinch", () => {
  const start = {
    view: RESET_VIEW,
    distance: 100,
    center: { x: 50, y: 0 },
  };

  it("scales by the ratio of the finger distances", () => {
    const view = pinchView(start, { distance: 200, center: start.center }, box);
    expect(view.scale).toBeCloseTo(2);
  });

  it("holds the starting centre still when the centre does not move", () => {
    const view = pinchView(start, { distance: 200, center: start.center }, box);
    // The photo point under the start centre (50, 0) is still at (50, 0).
    expect(view.x + view.scale * 50).toBeCloseTo(50);
    expect(view.y).toBeCloseTo(0);
  });

  it("also pans when the two fingers move together", () => {
    const view = pinchView(
      start,
      { distance: 200, center: { x: 20, y: 30 } },
      box,
    );
    // Point 50 on the photo now sits under the centre (20, 30).
    expect(view.x + view.scale * 50).toBeCloseTo(20);
    expect(view.y).toBeCloseTo(30);
  });

  it("stops at 3x and at 1x", () => {
    expect(
      pinchView(start, { distance: 5000, center: start.center }, box).scale,
    ).toBe(3);
    const zoomed: ZoomView = { scale: 2, x: 0, y: 0 };
    expect(
      pinchView(
        { ...start, view: zoomed },
        { distance: 1, center: start.center },
        box,
      ),
    ).toEqual(RESET_VIEW);
  });

  it("changes nothing when the fingers started on one point", () => {
    expect(
      pinchView(
        { ...start, distance: 0 },
        { distance: 50, center: start.center },
        box,
      ),
    ).toEqual(RESET_VIEW);
  });

  it("continues from an already zoomed view", () => {
    const zoomed: ZoomView = { scale: 2, x: 100, y: 0 };
    const view = pinchView(
      { view: zoomed, distance: 100, center: centre },
      { distance: 120, center: centre },
      box,
    );
    expect(view.scale).toBeCloseTo(2.4);
    // The photo point under the centre stays under it.
    const p = (0 - zoomed.x) / zoomed.scale;
    expect(view.x + view.scale * p).toBeCloseTo(0);
  });

  it("finds the midpoint of two fingers", () => {
    expect(midpoint({ x: 0, y: 10 }, { x: 10, y: 30 })).toEqual({
      x: 5,
      y: 20,
    });
  });
});

describe("double tap", () => {
  it("toggles between 1x and 2.5x", () => {
    const zoomed = toggleZoom(RESET_VIEW, centre, box);
    expect(zoomed.scale).toBe(DOUBLE_TAP_SCALE);
    expect(DOUBLE_TAP_SCALE).toBe(2.5);
    expect(toggleZoom(zoomed, centre, box)).toEqual(RESET_VIEW);
  });

  it("goes back to 1x from any visible zoom, pan and all", () => {
    expect(toggleZoom({ scale: 1.8, x: 40, y: 10 }, centre, box)).toEqual(
      RESET_VIEW,
    );
  });

  it("zooms around the tapped point", () => {
    const focal = { x: 120, y: 60 };
    const view = toggleZoom(RESET_VIEW, focal, box);
    expect(view.x + view.scale * focal.x).toBeCloseTo(focal.x);
    expect(view.y + view.scale * focal.y).toBeCloseTo(focal.y);
  });

  it("recognises two taps close in time and place", () => {
    const first = { time: 1000, point: { x: 100, y: 100 } };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { time: 1200, point: { x: 110, y: 105 } })).toBe(
      true,
    );
    expect(isDoubleTap(first, { time: 1400, point: { x: 100, y: 100 } })).toBe(
      false,
    );
    expect(isDoubleTap(first, { time: 1100, point: { x: 300, y: 100 } })).toBe(
      false,
    );
  });
});

describe("mouse wheel", () => {
  it("zooms in on a negative delta and out on a positive one", () => {
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelFactor(0, 0, false)).toBe(1);
  });

  it("gives ctrl+wheel (trackpad pinch) a larger gain", () => {
    expect(wheelFactor(-5, 0, true)).toBeGreaterThan(wheelFactor(-5, 0, false));
  });

  it("reads line deltas as lines", () => {
    expect(wheelFactor(-3, 1, false)).toBeCloseTo(wheelFactor(-48, 0, false));
  });

  it("stays inside 1x to 3x", () => {
    expect(wheelZoom(RESET_VIEW, 5000, 0, false, centre, box)).toEqual(
      RESET_VIEW,
    );
    expect(wheelZoom(RESET_VIEW, -50000, 0, false, centre, box).scale).toBe(3);
  });
});

describe("keyboard", () => {
  it("maps + - 0 and the arrows, and ignores browser chords", () => {
    expect(zoomKeyAction({ key: "+", ...plain }, false)).toEqual({
      kind: "zoom",
      direction: 1,
    });
    expect(zoomKeyAction({ key: "=", ...plain }, false)).toEqual({
      kind: "zoom",
      direction: 1,
    });
    expect(zoomKeyAction({ key: "-", ...plain }, false)).toEqual({
      kind: "zoom",
      direction: -1,
    });
    expect(zoomKeyAction({ key: "0", ...plain }, true)).toEqual({
      kind: "reset",
    });
    expect(zoomKeyAction({ key: "+", ...plain, ctrlKey: true }, false)).toBe(
      null,
    );
    expect(zoomKeyAction({ key: "a", ...plain }, true)).toBe(null);
  });

  it("only pans with the arrows when zoomed", () => {
    expect(zoomKeyAction({ key: "ArrowRight", ...plain }, false)).toBe(null);
    expect(zoomKeyAction({ key: "ArrowRight", ...plain }, true)).toEqual({
      kind: "pan",
      dx: -KEY_PAN_STEP,
      dy: 0,
    });
  });

  it("steps the zoom up to 3x and back to 1x, then resets", () => {
    let view: ZoomView = RESET_VIEW;
    for (let i = 0; i < 20; i += 1) view = keyZoom(view, 1, box);
    expect(view.scale).toBe(3);
    for (let i = 0; i < 20; i += 1) view = keyZoom(view, -1, box);
    expect(view).toEqual(RESET_VIEW);
    const zoomed = keyZoom(RESET_VIEW, 1, box);
    expect(applyKeyAction(zoomed, { kind: "reset" }, box)).toEqual(RESET_VIEW);
  });

  it("moves the photo with the arrow keys, inside the box", () => {
    const zoomed: ZoomView = { scale: 3, x: 0, y: 0 };
    const right = applyKeyAction(
      zoomed,
      { kind: "pan", dx: -KEY_PAN_STEP, dy: 0 },
      box,
    );
    expect(right.x).toBe(-KEY_PAN_STEP);
    const edge = applyKeyAction(
      { scale: 3, x: 400, y: 0 },
      { kind: "pan", dx: KEY_PAN_STEP, dy: 0 },
      box,
    );
    expect(edge.x).toBe(400);
  });
});

describe("the transform string", () => {
  it("is a translate and a scale, nothing that forces layout", () => {
    expect(viewTransform({ scale: 2, x: 10, y: -5 })).toBe(
      "translate3d(10px, -5px, 0) scale(2)",
    );
  });
});
