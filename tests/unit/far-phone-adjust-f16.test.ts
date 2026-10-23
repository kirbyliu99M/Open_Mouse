/**
 * V3.2 F16 (candidate, 未拍板), Kirby's preview-6 test: "If I raise my phone
 * too high, it can't scan properly nor magnify". Measured (實測): with the
 * sheet at about 0.37 of the photo's width the photos came back
 * PAPER_NOT_FOUND (region_split twice, too_small) and a frame placed by hand
 * measured at 0.366.
 *
 * What was wrong (found in the code, the phone itself not reproduced): a sheet
 * that small has a rough quad (`paperGuessCorners`) under the 8 % area floor,
 * so `defaultAdjustFrame` threw it away and opened the CENTRED sheet (72 % of
 * the width): the screen opened zoomed onto a frame far bigger than the
 * paper, and the paper itself small on screen; and the closest zoom (6x the
 * whole photo) left two fingers little room once zoomed onto a small sheet.
 * The floor is unchanged. SIMULATED scenes (模擬).
 */
import { describe, expect, it } from "vitest";
import {
  PAPER_ADJUST_LAYOUT,
  PAPER_ADJUST_VIEW,
  adjustReadiness,
  magnifierLayout,
  pinchView,
  sheetView,
  startAdjust,
  toScreen,
  wholeView,
} from "../../src/client/camera/paperAdjustState";
import {
  MANUAL_QUAD_LIMITS,
  checkManualQuad,
  type Quad4,
} from "../../src/client/paper/manualQuad";
import type { PhotoOverlay } from "../../src/client/photo/pipeline";
import { paperAdjustCopy } from "../../src/lib/copy/paper-adjust";

/** A portrait A4 sheet `widthFraction` of the photo's width across, centred, a little turned. */
function sheetAt(
  image: { width: number; height: number },
  widthFraction: number,
): Quad4 {
  const w = image.width * widthFraction;
  const h = w * (297 / 210);
  const cx = image.width / 2;
  const cy = image.height / 2;
  const t = 0.03; // a slight turn
  const corner = (dx: number, dy: number) => ({
    x: cx + dx * Math.cos(t) - dy * Math.sin(t),
    y: cy + dx * Math.sin(t) + dy * Math.cos(t),
  });
  return [
    corner(-w / 2, -h / 2),
    corner(w / 2, -h / 2),
    corner(w / 2, h / 2),
    corner(-w / 2, h / 2),
  ];
}

const FRAME = { width: 1080, height: 1920 }; // a frame of the S25's video
const PHOTO = { width: 3000, height: 4000 }; // a 4 : 3 photo
const STAGES = [
  { width: 390, height: 560 },
  { width: 360, height: 640 },
];

const overlayFor = (
  image: { width: number; height: number },
  guess: Quad4,
): PhotoOverlay => ({
  imageWidth: image.width,
  imageHeight: image.height,
  markers: [],
  card: null,
  landmarksPx: null,
  paperCorners: null,
  paperGuessCorners: guess as PhotoOverlay["paperGuessCorners"],
});

/** How much of the stage the frame fills along each axis, in the view the screen opens with. */
function fill(
  image: { width: number; height: number },
  quad: Quad4,
  stage: { width: number; height: number },
) {
  const view = sheetView(image, stage, quad);
  const pts = quad.map((c) => toScreen(c, view));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    view,
    width: (Math.max(...xs) - Math.min(...xs)) / stage.width,
    height: (Math.max(...ys) - Math.min(...ys)) / stage.height,
  };
}

describe("a sheet at 0.3 of the photo's width (a phone held too high)", () => {
  const guess = sheetAt(FRAME, 0.3);

  it("the situation: in a 1080x1920 frame its quad is under the 8 % area floor", () => {
    expect(checkManualQuad(guess, FRAME)).toEqual({
      ok: false,
      problem: "too_small",
    });
    expect(MANUAL_QUAD_LIMITS.minAreaFraction).toBe(0.08);
  });

  it("the screen opens on the paper's rough quad, not on the centred sheet", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlayFor(FRAME, guess),
      paperSize: "a4",
    });
    expect(state.start.from).toBe("guess");
    expect(state.corners).toEqual(guess);
  });

  for (const stage of STAGES)
    it(`${stage.width}x${stage.height}: it opens zoomed so the frame fills about 8 tenths of the stage, below the closest zoom`, () => {
      const f = fill(FRAME, guess, stage);
      expect(Math.max(f.width, f.height)).toBeGreaterThan(0.7);
      const base = wholeView(FRAME, stage);
      expect(f.view.scale).toBeGreaterThan(base.scale * 3);
      expect(f.view.scale).toBeLessThan(
        base.scale * PAPER_ADJUST_VIEW.maxZoom * 0.5,
      );
    });

  it("two fingers still zoom in from there: spread twice as far, the photo is shown twice as big", () => {
    const stage = STAGES[0];
    const start = sheetView(FRAME, stage, guess);
    const zoomed = pinchView({
      start,
      from: [
        { x: 150, y: 280 },
        { x: 240, y: 280 },
      ],
      to: [
        { x: 105, y: 280 },
        { x: 285, y: 280 },
      ],
      image: FRAME,
      stage,
    });
    expect(zoomed.scale / start.scale).toBeCloseTo(2, 9);
  });

  it("the magnifier shows the corner at 4x the zoomed photo, centred under its crosshair", () => {
    const stage = STAGES[0];
    const fit = sheetView(FRAME, stage, guess);
    const corner = guess[0];
    const m = magnifierLayout({
      pointer: toScreen(corner, fit),
      corner,
      fit,
      stage,
    });
    const z = PAPER_ADJUST_LAYOUT.magnifierZoom;
    expect(m.backgroundWidth).toBeCloseTo(fit.width * z, 9);
    expect(m.backgroundX + corner.x * fit.scale * z).toBeCloseTo(m.size / 2, 9);
    expect(m.backgroundY + corner.y * fit.scale * z).toBeCloseTo(m.size / 2, 9);
    // On screen a photo pixel is then several screen px across: the corner can be seen.
    expect(fit.scale * z).toBeGreaterThan(3);
  });

  it("confirmed as it is, the frame is refused for its size (the floor is not changed) and the words say to move closer", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlayFor(FRAME, guess),
      paperSize: "a4",
    });
    expect(adjustReadiness(state)).toEqual({ ok: false, problem: "too_small" });
    expect(paperAdjustCopy("zh-TW").quadProblem.too_small).toContain(
      "拿近一點",
    );
    expect(paperAdjustCopy("en").quadProblem.too_small).toContain(
      "move the phone closer",
    );
  });

  it("in a 4 : 3 photo the same 0.3 sheet is over the floor and is measured from as usual", () => {
    const big = sheetAt(PHOTO, 0.3);
    expect(checkManualQuad(big, PHOTO).ok).toBe(true);
    const state = startAdjust({
      entry: "rescue",
      overlay: overlayFor(PHOTO, big),
      paperSize: "a4",
    });
    expect(state.start.from).toBe("guess");
    const f = fill(PHOTO, big, STAGES[0]);
    expect(Math.max(f.width, f.height)).toBeGreaterThan(0.7);
    expect(adjustReadiness(state).ok).toBe(true);
  });

  it("a guess that fails for another reason (crossed) still falls back to the centred sheet", () => {
    const crossed: Quad4 = [guess[0], guess[2], guess[1], guess[3]];
    const state = startAdjust({
      entry: "rescue",
      overlay: overlayFor(FRAME, crossed),
      paperSize: "a4",
    });
    expect(state.start.from).toBe("centred");
  });
});
