/**
 * F10 (Kirby's second phone test 2026-10-21/22, candidate): 「手動調整後要
 * 放大」. The adjustment screen opens zoomed onto its frame, two fingers zoom
 * and move the photo, a double tap or a button shows the whole photo. A view
 * is a `PhotoFit`, so the display <-> photo conversion is `toScreen` /
 * `toImage` through it; these tests pin that conversion under zoom and pan,
 * that a drag moves a corner by the same photo distance at every zoom, and
 * that the corners confirmed do not depend on the view. SIMULATED scenes.
 */
import { describe, expect, it } from "vitest";
import {
  PAPER_ADJUST_LAYOUT,
  PAPER_ADJUST_VIEW,
  adjustReadiness,
  adjustReducer,
  clampView,
  isDoubleTap,
  isWholeView,
  pinchView,
  pointerMoveFor,
  sheetView,
  startAdjust,
  toImage,
  toScreen,
  wheelZoomFactor,
  wholeView,
  zoomViewAt,
  type AdjustState,
  type PhotoFit,
} from "../../src/client/camera/paperAdjustState";
import {
  MANUAL_QUAD_LIMITS,
  type Quad4,
} from "../../src/client/paper/manualQuad";
import type { PhotoOverlay } from "../../src/client/photo/pipeline";

const IMAGE = { width: 1080, height: 1920 };
const STAGES = [
  { width: 320, height: 330 },
  { width: 390, height: 560 },
  { width: 1280, height: 640 },
];
// A sheet at about 60 % of the photo's width, a little turned.
const SHEET: Quad4 = [
  { x: 230, y: 520 },
  { x: 880, y: 545 },
  { x: 860, y: 1440 },
  { x: 205, y: 1415 },
];
const OVERLAY: PhotoOverlay = {
  imageWidth: IMAGE.width,
  imageHeight: IMAGE.height,
  markers: [],
  card: null,
  landmarksPx: null,
  paperCorners: SHEET,
};
const close = (a: number, b: number, eps = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(eps);

describe("sheetView: the screen opens with the frame filling the stage", () => {
  for (const stage of STAGES)
    it(`${stage.width}x${stage.height}: every corner on the stage with room for its handle and the margin; zoomed in from the whole photo`, () => {
      const v = sheetView(IMAGE, stage, SHEET);
      const base = wholeView(IMAGE, stage);
      expect(v.scale).toBeGreaterThan(base.scale);
      expect(v.scale).toBeLessThanOrEqual(
        base.scale * PAPER_ADJUST_VIEW.maxZoom + 1e-9,
      );
      const pad =
        PAPER_ADJUST_LAYOUT.handleTargetPx / 2 +
        PAPER_ADJUST_VIEW.sheetMarginPx;
      const pts = SHEET.map((c) => toScreen(c, v));
      for (const p of pts) {
        expect(p.x).toBeGreaterThanOrEqual(pad - 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(pad - 1e-6);
        expect(p.x).toBeLessThanOrEqual(stage.width - pad + 1e-6);
        expect(p.y).toBeLessThanOrEqual(stage.height - pad + 1e-6);
      }
      // It fills the stage along one axis (up to the margin).
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const fillW =
        (Math.max(...xs) - Math.min(...xs)) / (stage.width - 2 * pad);
      const fillH =
        (Math.max(...ys) - Math.min(...ys)) / (stage.height - 2 * pad);
      close(Math.max(fillW, fillH), 1, 1e-6);
      expect(isWholeView(v, IMAGE, stage)).toBe(false);
    });

  it("a frame as large as the photo opens on the whole photo (never zoomed out past it)", () => {
    const edge: Quad4 = [
      { x: 0, y: 0 },
      { x: IMAGE.width, y: 0 },
      { x: IMAGE.width, y: IMAGE.height },
      { x: 0, y: IMAGE.height },
    ];
    for (const stage of STAGES) {
      const v = sheetView(IMAGE, stage, edge);
      expect(v).toEqual(wholeView(IMAGE, stage));
      expect(isWholeView(v, IMAGE, stage)).toBe(true);
    }
  });

  it("a tiny frame is zoomed at most maxZoom", () => {
    const tiny: Quad4 = [
      { x: 500, y: 900 },
      { x: 510, y: 900 },
      { x: 510, y: 910 },
      { x: 500, y: 910 },
    ];
    const stage = STAGES[1];
    const v = sheetView(IMAGE, stage, tiny);
    close(v.scale, wholeView(IMAGE, stage).scale * PAPER_ADJUST_VIEW.maxZoom);
  });
});

describe("display <-> photo conversion through a zoomed, panned view", () => {
  it("toImage undoes toScreen, at every zoom and pan", () => {
    const stage = STAGES[1];
    const base = wholeView(IMAGE, stage);
    for (const zoom of [1, 1.7, 3, 6])
      for (const pan of [
        [0, 0],
        [-120, 40],
        [300, -500],
      ]) {
        const v: PhotoFit = clampView(
          {
            scale: base.scale * zoom,
            offsetX: base.offsetX + pan[0],
            offsetY: base.offsetY + pan[1],
            width: IMAGE.width * base.scale * zoom,
            height: IMAGE.height * base.scale * zoom,
          },
          IMAGE,
          stage,
        );
        for (const p of [
          { x: 0, y: 0 },
          { x: 540.25, y: 960.75 },
          { x: IMAGE.width, y: IMAGE.height },
          { x: -50, y: 2000 },
        ]) {
          const back = toImage(toScreen(p, v), v);
          close(back.x, p.x, 1e-9);
          close(back.y, p.y, 1e-9);
        }
        // The photo is drawn at the view's scale.
        close(v.width, IMAGE.width * v.scale);
        close(v.height, IMAGE.height * v.scale);
      }
  });

  it("a drag moves a corner by the same photo distance at every zoom (the finger's movement over the view's scale)", () => {
    const stage = STAGES[1];
    const photoDelta = { x: 17.5, y: -8.25 };
    const results: { x: number; y: number }[] = [];
    for (const zoom of [1, 2.5, 6]) {
      const base = wholeView(IMAGE, stage);
      const v = clampView({ ...base, scale: base.scale * zoom }, IMAGE, stage);
      let s: AdjustState = startAdjust({
        entry: "review",
        overlay: OVERLAY,
        paperSize: "a4",
      });
      const start = toScreen(s.corners[2], v);
      s = adjustReducer(s, {
        type: "pointerDown",
        index: 2,
        pointerId: 1,
        pointerType: "touch",
        point: start,
      });
      s = adjustReducer(
        s,
        pointerMoveFor({
          pointerId: 1,
          point: {
            x: start.x + photoDelta.x * v.scale,
            y: start.y + photoDelta.y * v.scale,
          },
          fit: v,
        }),
      );
      results.push(s.corners[2]);
    }
    for (const r of results) {
      close(r.x, SHEET[2].x + photoDelta.x, 1e-9);
      close(r.y, SHEET[2].y + photoDelta.y, 1e-9);
    }
  });

  it("the corners confirmed do not depend on the view: zooming and panning change no corner", () => {
    const stage = STAGES[1];
    const s = startAdjust({
      entry: "review",
      overlay: OVERLAY,
      paperSize: "a4",
    });
    const views = [
      wholeView(IMAGE, stage),
      sheetView(IMAGE, stage, s.corners),
      zoomViewAt(
        sheetView(IMAGE, stage, s.corners),
        2,
        { x: 100, y: 100 },
        IMAGE,
        stage,
      ),
    ];
    // The view is not part of the frame's state: the same state is confirmed
    // whatever is on screen.
    const ready = adjustReadiness(s);
    expect(ready.ok).toBe(true);
    if (ready.ok) expect(ready.corners).toEqual(SHEET);
    for (const v of views) {
      const onScreen = s.corners.map((c) => toScreen(c, v));
      const backInPhoto = onScreen.map((p) => toImage(p, v));
      backInPhoto.forEach((p, i) => {
        close(p.x, SHEET[i].x, 1e-9);
        close(p.y, SHEET[i].y, 1e-9);
      });
    }
  });
});

describe("clampView", () => {
  const stage = STAGES[1];
  const base = wholeView(IMAGE, stage);

  it("never smaller than the whole photo nor closer than maxZoom", () => {
    expect(clampView({ ...base, scale: base.scale / 3 }, IMAGE, stage)).toEqual(
      base,
    );
    close(
      clampView({ ...base, scale: base.scale * 50 }, IMAGE, stage).scale,
      base.scale * PAPER_ADJUST_VIEW.maxZoom,
    );
  });

  it("centres the photo along an axis while it fits, and pans no further than the 10 % band beyond the photo", () => {
    // Whole photo: centred whatever the offset asked for.
    const moved = clampView(
      { ...base, offsetX: base.offsetX + 200, offsetY: base.offsetY - 300 },
      IMAGE,
      stage,
    );
    close(moved.offsetX, base.offsetX);
    close(moved.offsetY, base.offsetY);
    // Zoomed: dragged far right, the photo's left edge stops one band (plus
    // half a handle) inside the stage's left edge.
    const z = base.scale * 4;
    const far = clampView(
      {
        scale: z,
        offsetX: 1e6,
        offsetY: -1e6,
        width: IMAGE.width * z,
        height: IMAGE.height * z,
      },
      IMAGE,
      stage,
    );
    const band = MANUAL_QUAD_LIMITS.maxOutsideFraction;
    const half = PAPER_ADJUST_LAYOUT.handleTargetPx / 2;
    close(far.offsetX, half + IMAGE.width * band * z);
    close(
      far.offsetY,
      stage.height - half - IMAGE.height * z - IMAGE.height * band * z,
    );
  });
});

describe("two fingers, the wheel, the double tap", () => {
  const stage = STAGES[1];
  const start = sheetView(IMAGE, stage, SHEET);

  it("spreading two fingers zooms by their distance, about their midpoint", () => {
    const from = [
      { x: 150, y: 280 },
      { x: 250, y: 280 },
    ] as const;
    const to = [
      { x: 125, y: 280 },
      { x: 275, y: 280 },
    ] as const;
    const v = pinchView({ start, from, to, image: IMAGE, stage });
    close(v.scale, start.scale * 1.5);
    const mid = { x: 200, y: 280 };
    const under = toImage(mid, start);
    const after = toScreen(under, v);
    close(after.x, mid.x, 1e-6);
    close(after.y, mid.y, 1e-6);
  });

  it("moving both fingers together moves the photo with them (pan)", () => {
    const from = [
      { x: 150, y: 280 },
      { x: 250, y: 300 },
    ] as const;
    const to = [
      { x: 170, y: 250 },
      { x: 270, y: 270 },
    ] as const;
    const v = pinchView({ start, from, to, image: IMAGE, stage });
    close(v.scale, start.scale);
    close(v.offsetX - start.offsetX, 20, 1e-6);
    close(v.offsetY - start.offsetY, -30, 1e-6);
  });

  it("pinching in past the whole photo stops at the whole photo", () => {
    const v = pinchView({
      start,
      from: [
        { x: 100, y: 200 },
        { x: 300, y: 200 },
      ],
      to: [
        { x: 195, y: 200 },
        { x: 205, y: 200 },
      ],
      image: IMAGE,
      stage,
    });
    expect(isWholeView(v, IMAGE, stage)).toBe(true);
  });

  it("the wheel zooms about the pointer, up zooms in", () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(
      PAPER_ADJUST_VIEW.wheelFactorPer100Px,
      12,
    );
    expect(wheelZoomFactor(100)).toBeCloseTo(
      1 / PAPER_ADJUST_VIEW.wheelFactorPer100Px,
      12,
    );
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(NaN)).toBe(1);
    const at = { x: 120, y: 330 };
    const v = zoomViewAt(start, 1.25, at, IMAGE, stage);
    const p = toScreen(toImage(at, start), v);
    close(p.x, at.x, 1e-6);
    close(p.y, at.y, 1e-6);
  });

  it("a double tap: two taps within 300 ms and 24 px", () => {
    const first = { at: 1000, point: { x: 100, y: 100 } };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { at: 1250, point: { x: 110, y: 105 } })).toBe(
      true,
    );
    expect(isDoubleTap(first, { at: 1400, point: { x: 100, y: 100 } })).toBe(
      false,
    );
    expect(isDoubleTap(first, { at: 1100, point: { x: 140, y: 100 } })).toBe(
      false,
    );
    expect(isDoubleTap(first, { at: 900, point: { x: 100, y: 100 } })).toBe(
      false,
    );
  });
});
