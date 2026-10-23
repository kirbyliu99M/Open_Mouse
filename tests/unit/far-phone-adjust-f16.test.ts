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
  adjustConfirmAction,
  adjustReadiness,
  adjustReducer,
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
  paperShortSidePx,
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

  // Brief F17 B.3 (a phone held too high, the sheet 0.3-0.4 of the width,
  // can be confirmed): closed 2026-10-24 when Kirby set the floor to 1.2
  // px/mm (252 px for A4) after preview 8.
  it("in a 1080x1920 frame its quad (short side 324 px) is over the 1.2 px/mm floor (252 px for A4)", () => {
    expect(checkManualQuad(guess, FRAME)).toEqual({ ok: true });
    expect(MANUAL_QUAD_LIMITS.minPxPerMm).toBe(1.2);
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
    it(`${stage.width}x${stage.height}: sheetView (no longer how the screen opens since F17, which opens on the whole photo) fills about 8 tenths of the stage, below the closest zoom`, () => {
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

  it("confirmed as it is on a rescue, the frame is measured from; a sheet under the floor (0.22, 238 px) is refused and the words say to move closer", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlayFor(FRAME, guess),
      paperSize: "a4",
    });
    expect(adjustReadiness(state).ok).toBe(true);
    const small = startAdjust({
      entry: "rescue",
      overlay: overlayFor(FRAME, sheetAt(FRAME, 0.22)),
      paperSize: "a4",
    });
    expect(adjustReadiness(small)).toEqual({ ok: false, problem: "too_small" });
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

/** A portrait sheet of `ratio` (long / short) `widthFraction` of the photo's width across, centred, a little turned. */
function sheetOfRatio(
  image: { width: number; height: number },
  widthFraction: number,
  ratio: number,
): Quad4 {
  const w = image.width * widthFraction;
  const h = w * ratio;
  const cx = image.width / 2;
  const cy = image.height / 2;
  const t = 0.03;
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
const A4_RATIO = 297 / 210;
const LETTER_RATIO = 279.4 / 215.9;

describe("brief B.3 through adjustReadiness: a 1024x1920 frame (Kirby's S25), the rough quad placed on a rescue (模擬)", () => {
  const S25 = { width: 1024, height: 1920 };
  const readiness = (widthFraction: number, paperSize: "a4" | "letter") => {
    const guess = sheetOfRatio(
      S25,
      widthFraction,
      paperSize === "a4" ? A4_RATIO : LETTER_RATIO,
    );
    const state = startAdjust({
      entry: "rescue",
      overlay: overlayFor(S25, guess),
      paperSize,
    });
    expect(state.paperSize).toBe(paperSize);
    expect(state.start.from).toBe("guess");
    return adjustReadiness(state);
  };

  it("A4 at 0.22 of the width (225 px) is refused as too small", () => {
    expect(readiness(0.22, "a4")).toEqual({ ok: false, problem: "too_small" });
  });

  for (const f of [0.3, 0.35, 0.4])
    it(`A4 at ${f} of the width is confirmed`, () => {
      expect(readiness(f, "a4").ok).toBe(true);
    });

  it("the paper size reaches the floor: at 0.25 (256 px) A4 (252 px) passes, Letter (259 px) does not", () => {
    expect(readiness(0.25, "a4").ok).toBe(true);
    expect(readiness(0.25, "letter")).toEqual({
      ok: false,
      problem: "too_small",
    });
    expect(readiness(0.27, "letter").ok).toBe(true);
  });
});

describe("F17 review: a photo already measured from the detector's corners, under the resolution floor (模擬)", () => {
  /** The detector's corners as the measured photo's overlay has them. */
  const measuredOverlay = (
    image: { width: number; height: number },
    corners: Quad4,
  ): PhotoOverlay => ({
    imageWidth: image.width,
    imageHeight: image.height,
    markers: [],
    card: null,
    landmarksPx: null,
    paperCorners: corners as PhotoOverlay["paperCorners"],
  });
  const measured = { kind: "measured" } as unknown as Parameters<
    typeof adjustConfirmAction
  >[0]["result"];

  for (const { image, widthFraction } of [
    { image: { width: 640, height: 480 }, widthFraction: 230 / 640 },
    { image: { width: 1280, height: 960 }, widthFraction: 200 / 1280 },
  ])
    describe(`${image.width}x${image.height}, a sheet ${Math.round(widthFraction * image.width)} px across`, () => {
      // Landscape photo, portrait sheet: fits 480 / 960 px high.
      const corners = sheetOfRatio(image, widthFraction, A4_RATIO * 0.75);
      it("the situation: the detector's frame is under the floor (252 px for A4)", () => {
        expect(paperShortSidePx(corners)).toBeLessThan(252);
        expect(checkManualQuad(corners, image)).toEqual({
          ok: false,
          problem: "too_small",
        });
      });

      it("the screen opens on the detector's corners, and confirming them as they are is allowed and measures nothing again", () => {
        const state = startAdjust({
          entry: "review",
          overlay: measuredOverlay(image, corners),
          paperSize: "a4",
        });
        expect(state.start.from).toBe("detected");
        expect(state.corners).toEqual(corners);
        expect(adjustReadiness(state)).toEqual({
          ok: true,
          corners,
          source: "adjusted",
        });
        expect(
          adjustConfirmAction({
            entry: "review",
            result: measured,
            hasFile: true,
            moved: false,
          }),
        ).toEqual({ kind: "none" });
      });

      it("moved, it would be measured from again: the floor applies", () => {
        const opened = startAdjust({
          entry: "review",
          overlay: measuredOverlay(image, corners),
          paperSize: "a4",
        });
        const moved = adjustReducer(opened, {
          type: "nudge",
          index: 0,
          dx: -1,
          dy: 0,
          big: false,
          scale: 1,
        });
        expect(moved.corners).not.toEqual(corners);
        expect(adjustReadiness(moved)).toEqual({
          ok: false,
          problem: "too_small",
        });
      });

      it("the same corners on a rescue (a failed photo, measured again on confirm) are held to the floor", () => {
        const state = startAdjust({
          entry: "rescue",
          overlay: measuredOverlay(image, corners),
          paperSize: "a4",
        });
        expect(state.start.from).toBe("detected");
        expect(adjustReadiness(state)).toEqual({
          ok: false,
          problem: "too_small",
        });
      });
    });
});
