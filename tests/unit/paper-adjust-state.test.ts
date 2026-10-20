/**
 * V3.2 F2 (candidate): the rules of the 手動調整邊框 screen
 * (src/client/camera/paperAdjustState.ts): when it is offered, relative drag,
 * the keyboard steps, the magnifier's place, the hidden-corner marks and when
 * the frame may be used. Scenes are SIMULATED (模擬).
 */
import { describe, expect, it } from "vitest";
import {
  ADJUSTABLE_CODES,
  PAPER_ADJUST_LAYOUT,
  adjustEntryFor,
  adjustReadiness,
  adjustReducer,
  cornerCheckDistances,
  cornerPositions,
  edgeStepOf,
  fitPhoto,
  magnifierLayout,
  startAdjust,
  toImage,
  toScreen,
  type AdjustAction,
  type AdjustState,
} from "../../src/client/camera/paperAdjustState";
import type { PhotoOverlay } from "../../src/client/photo/pipeline";
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
  type ScanSubmission,
} from "../../src/lib/contracts/measurement";
import type { Quad4 } from "../../src/client/paper/manualQuad";
import { buildR5Scene } from "./helpers/r5-corner-scene";

const IMAGE = { width: 1024, height: 1920 };
const RECT: Quad4 = [
  { x: 200, y: 300 },
  { x: 800, y: 300 },
  { x: 800, y: 1150 },
  { x: 200, y: 1150 },
];
const overlay = (extra: Partial<PhotoOverlay> = {}): PhotoOverlay => ({
  imageWidth: IMAGE.width,
  imageHeight: IMAGE.height,
  markers: [],
  card: null,
  landmarksPx: null,
  ...extra,
});
const issue = (code: string) => ({ code, message: "m" });
const submission = (calibration: Record<string, unknown>): ScanSubmission =>
  scanSubmissionSchema.parse({
    hand: "right",
    measurements: { handLengthMm: 186, palmLengthMm: 106, palmWidthMm: 82 },
    calibration,
    measurementModelVersion: MEASUREMENT_MODEL_VERSION,
  });
const AUTO = submission({
  method: "paper-edge",
  paperSize: "a4",
  edgeFitResidualMm: 0.4,
  minSideCoverage: 0.9,
  parallaxCorrected: true,
});

const run = (state: AdjustState, ...actions: AdjustAction[]) =>
  actions.reduce(adjustReducer, state);

describe("adjustEntryFor: only after a hidden edge or corner", () => {
  it("offers the rescue after PAPER_EDGE_HIDDEN and PAPER_CORNER_HIDDEN", () => {
    expect(ADJUSTABLE_CODES).toEqual([
      "PAPER_EDGE_HIDDEN",
      "PAPER_CORNER_HIDDEN",
    ]);
    for (const code of ADJUSTABLE_CODES)
      for (const debugOn of [false, true])
        expect(
          adjustEntryFor(
            {
              kind: "gateFailure",
              errors: [issue(code), issue("HAND_OUT_OF_BOUNDS")],
              overlay: overlay(),
            },
            debugOn,
          ),
        ).toBe("rescue");
  });

  it("never after any other failure, nor when the hidden edge is not the first reason", () => {
    for (const code of [
      "PAPER_NOT_FOUND",
      "PAPER_CURLED",
      "HAND_NOT_DETECTED",
      "HAND_OUT_OF_BOUNDS",
      "LOW_SHARPNESS",
      "DECODE_FAILED",
      "PROCESSING_FAILED",
    ])
      expect(
        adjustEntryFor(
          { kind: "gateFailure", errors: [issue(code)], overlay: overlay() },
          false,
        ),
      ).toBeNull();
    expect(
      adjustEntryFor(
        {
          kind: "gateFailure",
          errors: [issue("HAND_OUT_OF_BOUNDS"), issue("PAPER_EDGE_HIDDEN")],
          overlay: overlay(),
        },
        false,
      ),
    ).toBeNull();
    // No photo to adjust on.
    expect(
      adjustEntryFor(
        {
          kind: "gateFailure",
          errors: [issue("PAPER_EDGE_HIDDEN")],
          overlay: null,
        },
        false,
      ),
    ).toBeNull();
    expect(
      adjustEntryFor(
        {
          kind: "gateFailure",
          errors: [issue("PAPER_EDGE_HIDDEN")],
          overlay: overlay({ imageWidth: 0, imageHeight: 0 }),
        },
        false,
      ),
    ).toBeNull();
  });

  it("never after a measurement without ?debug=1, nor before a result", () => {
    expect(
      adjustEntryFor(
        {
          kind: "measured",
          overlay: overlay({ paperCorners: RECT }),
          submission: AUTO,
        },
        false,
      ),
    ).toBeNull();
    expect(adjustEntryFor({ kind: "none" }, true)).toBeNull();
    expect(adjustEntryFor({ kind: "processing" }, true)).toBeNull();
  });

  it("with ?debug=1, offers Kirby's corner check on a photo measured from the detector's corners only", () => {
    expect(
      adjustEntryFor(
        {
          kind: "measured",
          overlay: overlay({ paperCorners: RECT }),
          submission: AUTO,
        },
        true,
      ),
    ).toBe("check");
    const adjusted = submission({
      method: "paper-edge",
      paperSize: "a4",
      cornersSource: "adjusted",
      parallaxCorrected: true,
    });
    expect(
      adjustEntryFor(
        {
          kind: "measured",
          overlay: overlay({ paperCorners: RECT }),
          submission: adjusted,
        },
        true,
      ),
    ).toBeNull();
    const typed = submission({
      method: "user-length",
      referenceMeasurement: "handLengthMm",
      referenceMm: 186,
      parallaxCorrected: false,
    });
    expect(
      adjustEntryFor(
        { kind: "measured", overlay: overlay(), submission: typed },
        true,
      ),
    ).toBeNull();
  });
});

describe("fitPhoto", () => {
  it("fits the whole photo inside the stage less the inset, centred, and converts both ways", () => {
    const fit = fitPhoto(IMAGE, { width: 390, height: 600 }, 24);
    expect(fit.height).toBeCloseTo(552, 6);
    expect(fit.width).toBeCloseTo((552 * 1024) / 1920, 6);
    expect(fit.offsetY).toBeCloseTo(24, 6);
    expect(fit.offsetX).toBeCloseTo((390 - fit.width) / 2, 6);
    const p = { x: 333, y: 777 };
    const back = toImage(toScreen(p, fit), fit);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it("is empty for a stage with no room", () => {
    expect(fitPhoto(IMAGE, { width: 40, height: 40 }, 24).width).toBe(0);
    expect(
      fitPhoto({ width: 0, height: 0 }, { width: 400, height: 400 }).width,
    ).toBe(0);
  });
});

describe("startAdjust", () => {
  it("rescue: starts from the detector's corners, all placed", () => {
    const s = startAdjust({
      entry: "rescue",
      overlay: overlay({ paperCorners: RECT }),
      paperSize: "a4",
    });
    expect(s.start.from).toBe("detected");
    expect(s.corners).toEqual(RECT);
    expect(s.placed).toEqual([true, true, true, true]);
  });

  it("rescue after a hidden corner: three corners and a guess the person must move", () => {
    const s = startAdjust({
      entry: "rescue",
      overlay: overlay({
        paperPartialCorners: [RECT[0], null, RECT[2], RECT[3]],
      }),
      paperSize: "a4",
    });
    expect(s.start.from).toBe("partial");
    expect(s.placed).toEqual([true, false, true, true]);
  });

  it("check: always the centred sheet with nothing placed, even with the detector's corners at hand", () => {
    const s = startAdjust({
      entry: "check",
      overlay: overlay({ paperCorners: RECT }),
      paperSize: "a4",
    });
    expect(s.start.from).toBe("centred");
    expect(s.placed).toEqual([false, false, false, false]);
    expect(s.corners).not.toEqual(RECT);
  });
});

const rescue = () =>
  startAdjust({
    entry: "rescue",
    overlay: overlay({ paperCorners: RECT }),
    paperSize: "a4",
  });

describe("relative drag", () => {
  const scale = 0.5; // screen px per photo px

  it("a corner does not jump to the finger: it moves by the finger's movement", () => {
    let s = run(rescue(), {
      type: "pointerDown",
      index: 0,
      pointerId: 7,
      pointerType: "touch",
      // 20 screen px away from the corner's own place on screen
      point: { x: 120, y: 170 },
    });
    expect(s.corners[0]).toEqual(RECT[0]);
    expect(s.selected).toBe(0);
    s = run(s, {
      type: "pointerMove",
      pointerId: 7,
      point: { x: 150, y: 158 },
      scale,
    });
    expect(s.corners[0]).toEqual({ x: 200 + 30 / scale, y: 300 - 12 / scale });
    // The other corners do not move.
    expect(s.corners.slice(1)).toEqual(RECT.slice(1));
  });

  it("once a corner is chosen, a press anywhere on the photo drags it (trackpad)", () => {
    let s = run(rescue(), { type: "select", index: 2 });
    s = run(
      s,
      {
        type: "pointerDown",
        index: null,
        pointerId: 1,
        pointerType: "touch",
        point: { x: 10, y: 10 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 14, y: 7 }, scale },
    );
    expect(s.corners[2]).toEqual({ x: 808, y: 1144 });
  });

  it("a press on the photo with no corner chosen moves nothing and says to choose one", () => {
    const s = run(rescue(), {
      type: "pointerDown",
      index: null,
      pointerId: 1,
      pointerType: "mouse",
      point: { x: 10, y: 10 },
    });
    expect(s.drag).toBeNull();
    expect(s.notice).toEqual({ kind: "chooseCorner" });
  });

  it("follows one pointer only, stops on release, and keeps the corner on the photo", () => {
    let s = run(rescue(), {
      type: "pointerDown",
      index: 1,
      pointerId: 1,
      pointerType: "touch",
      point: { x: 0, y: 0 },
    });
    s = run(
      s,
      // A second finger: ignored.
      {
        type: "pointerDown",
        index: 3,
        pointerId: 2,
        pointerType: "touch",
        point: { x: 0, y: 0 },
      },
      { type: "pointerMove", pointerId: 2, point: { x: 50, y: 50 }, scale },
    );
    expect(s.corners).toEqual(RECT);
    s = run(s, {
      type: "pointerMove",
      pointerId: 1,
      point: { x: 1000, y: -1000 },
      scale,
    });
    expect(s.corners[1]).toEqual({ x: IMAGE.width, y: 0 });
    s = run(
      s,
      { type: "pointerUp", pointerId: 1 },
      { type: "pointerMove", pointerId: 1, point: { x: 0, y: 0 }, scale },
    );
    expect(s.drag).toBeNull();
    expect(s.corners[1]).toEqual({ x: IMAGE.width, y: 0 });
  });

  it("a tap on a starting guess does not count as placing it; a move does", () => {
    const start = startAdjust({
      entry: "rescue",
      overlay: overlay({
        paperPartialCorners: [RECT[0], null, RECT[2], RECT[3]],
      }),
      paperSize: "a4",
    });
    let s = run(
      start,
      {
        type: "pointerDown",
        index: 1,
        pointerId: 1,
        pointerType: "touch",
        point: { x: 5, y: 5 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 5, y: 5 }, scale },
      { type: "pointerUp", pointerId: 1 },
    );
    expect(s.placed[1]).toBe(false);
    s = run(
      s,
      {
        type: "pointerDown",
        index: 1,
        pointerId: 2,
        pointerType: "touch",
        point: { x: 5, y: 5 },
      },
      { type: "pointerMove", pointerId: 2, point: { x: 6, y: 5 }, scale },
    );
    expect(s.placed[1]).toBe(true);
  });
});

describe("keyboard", () => {
  it("an arrow moves the corner one screen px (in photo px), Shift ten, and chooses it", () => {
    const scale = 0.25;
    let s = run(rescue(), {
      type: "nudge",
      index: 3,
      dx: 1,
      dy: 0,
      big: false,
      scale,
    });
    expect(s.corners[3]).toEqual({ x: 204, y: 1150 });
    expect(s.selected).toBe(3);
    s = run(s, { type: "nudge", index: 3, dx: 0, dy: -1, big: true, scale });
    expect(s.corners[3]).toEqual({ x: 204, y: 1110 });
    expect(PAPER_ADJUST_LAYOUT.keyStepScreenPx).toBe(1);
    expect(PAPER_ADJUST_LAYOUT.keyBigStepFactor).toBe(10);
  });
});

describe("a corner under the hand: two marks on its edges", () => {
  // A tilted sheet (simulated): its BR corner is hidden; the person marks the
  // bottom edge and the right edge halfway.
  const scene = buildR5Scene({ pitchDeg: 8 });
  const c = scene.corners;
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const start = (): AdjustState => {
    const s = startAdjust({
      entry: "rescue",
      overlay: overlay({ paperPartialCorners: [c[0], c[1], null, c[3]] }),
      paperSize: "a4",
    });
    return run(s, { type: "select", index: 2 }, { type: "edgeStart" });
  };

  it("needs a chosen corner first", () => {
    const s = run(rescue(), { type: "edgeStart" });
    expect(s.edge).toBeNull();
    expect(s.notice).toEqual({ kind: "chooseCorner" });
  });

  it("asks for the edge to the previous corner, then the next, and works the corner out", () => {
    let s = start();
    expect(s.edge).toEqual({ index: 2, points: [] });
    expect(edgeStepOf(s.edge!)).toEqual({ step: 1, other: 1 });
    s = run(s, { type: "edgeTap", point: mid(c[1], c[2]) });
    expect(edgeStepOf(s.edge!)).toEqual({ step: 2, other: 3 });
    s = run(s, { type: "edgeTap", point: mid(c[3], c[2]) });
    expect(s.edge).toBeNull();
    expect(s.notice).toEqual({ kind: "edgeSolved", index: 2 });
    expect(
      Math.hypot(s.corners[2].x - c[2].x, s.corners[2].y - c[2].y),
    ).toBeLessThan(0.05);
    expect(s.placed[2]).toBe(true);
    expect(adjustReadiness(s)).toMatchObject({ ok: true, source: "manual" });
  });

  it("says why when it cannot, leaves the corner where it was, and starts the marks again", () => {
    let s = start();
    const before = s.corners[2];
    // Both marks on the bottom edge's line: the two "edges" are parallel.
    s = run(
      s,
      { type: "edgeTap", point: { x: c[3].x + 50, y: c[3].y } },
      { type: "edgeTap", point: { x: c[3].x + 100, y: c[3].y } },
    );
    expect(s.notice?.kind).toBe("edgeProblem");
    expect(s.corners[2]).toEqual(before);
    expect(s.placed[2]).toBe(false);
    expect(s.edge).toEqual({ index: 2, points: [] });
    s = run(s, { type: "edgeCancel" });
    expect(s.edge).toBeNull();
  });
});

describe("adjustReadiness", () => {
  it("the detector's corners may be used as they are: adjusted", () => {
    expect(adjustReadiness(rescue())).toEqual({
      ok: true,
      corners: RECT,
      source: "adjusted",
    });
  });

  it("a corner still at its starting guess blocks it, and says which", () => {
    const s = startAdjust({
      entry: "rescue",
      overlay: overlay({
        paperPartialCorners: [RECT[0], null, RECT[2], RECT[3]],
      }),
      paperSize: "a4",
    });
    expect(adjustReadiness(s)).toEqual({ ok: false, notPlaced: 1 });
  });

  it("a crossed frame blocks it with its problem", () => {
    const s = run(
      rescue(),
      {
        type: "pointerDown",
        index: 0,
        pointerId: 1,
        pointerType: "mouse",
        point: { x: 0, y: 0 },
      },
      // TL dragged past TR and below the bottom edge: the frame crosses itself.
      {
        type: "pointerMove",
        pointerId: 1,
        point: { x: 700, y: 1000 },
        scale: 1,
      },
    );
    expect(adjustReadiness(s)).toMatchObject({ ok: false });
    const r = adjustReadiness(s);
    expect("problem" in r && r.problem).toMatch(/self_intersecting|not_convex/);
  });

  it("the corner check needs all four corners placed by hand", () => {
    let s = startAdjust({
      entry: "check",
      overlay: overlay({ paperCorners: RECT }),
      paperSize: "a4",
    });
    expect(adjustReadiness(s)).toEqual({ ok: false, notPlaced: 0 });
    for (const index of [0, 1, 2, 3] as const)
      s = run(s, { type: "nudge", index, dx: 1, dy: 0, big: false, scale: 1 });
    expect(adjustReadiness(s).ok).toBe(true);
  });

  it("reset goes back to the start", () => {
    const s = run(
      rescue(),
      { type: "nudge", index: 0, dx: 1, dy: 1, big: true, scale: 1 },
      { type: "reset" },
    );
    expect(s.corners).toEqual(RECT);
    expect(s.selected).toBeNull();
  });
});

describe("cornerPositions: a handle is named for where it is", () => {
  it("follows the corners' places, not their indices", () => {
    expect(cornerPositions(RECT)).toEqual([0, 1, 2, 3]);
    const turned: Quad4 = [RECT[1], RECT[2], RECT[3], RECT[0]];
    expect(cornerPositions(turned)).toEqual([1, 2, 3, 0]);
  });
});

describe("magnifierLayout: at least 4x, never under the finger, always on the stage", () => {
  const L = PAPER_ADJUST_LAYOUT;
  // The stage left on a 320x568 phone, a 390x844 phone, and a desktop window.
  const stages = [
    { width: 320, height: 330 },
    { width: 390, height: 600 },
    { width: 1280, height: 640 },
  ];

  it("enlarges at least four times", () => {
    expect(L.magnifierZoom).toBeGreaterThanOrEqual(4);
  });

  for (const stage of stages) {
    it(`${stage.width}x${stage.height}: clear of the finger's disc and inside the stage everywhere`, () => {
      const fit = fitPhoto(IMAGE, stage, L.handleTargetPx / 2);
      for (let x = 0; x <= stage.width; x += 10)
        for (let y = 0; y <= stage.height; y += 10) {
          const m = magnifierLayout({
            pointer: { x, y },
            corner: { x: 500, y: 900 },
            fit,
            stage,
          });
          const cx = m.left + m.size / 2;
          const cy = m.top + m.size / 2;
          const gap = Math.hypot(cx - x, cy - y) - m.size / 2;
          expect(gap, `at ${x},${y}`).toBeGreaterThanOrEqual(
            L.fingerRadiusPx - 1e-9,
          );
          expect(m.left).toBeGreaterThanOrEqual(0);
          expect(m.top).toBeGreaterThanOrEqual(0);
          expect(m.left + m.size).toBeLessThanOrEqual(stage.width);
          expect(m.top + m.size).toBeLessThanOrEqual(stage.height);
        }
    });
  }

  it("goes above the finger when there is room, beside it near the top", () => {
    const stage = { width: 390, height: 600 };
    const fit = fitPhoto(IMAGE, stage, 24);
    const corner = { x: 500, y: 900 };
    expect(
      magnifierLayout({ pointer: { x: 200, y: 400 }, corner, fit, stage }).side,
    ).toBe("above");
    expect(
      magnifierLayout({ pointer: { x: 60, y: 40 }, corner, fit, stage }).side,
    ).toBe("right");
    expect(
      magnifierLayout({ pointer: { x: 330, y: 40 }, corner, fit, stage }).side,
    ).toBe("left");
  });

  it("shows the corner (not the finger) at its centre, enlarged", () => {
    const stage = { width: 390, height: 600 };
    const fit = fitPhoto(IMAGE, stage, 24);
    const corner = { x: 512, y: 960 };
    const m = magnifierLayout({
      pointer: { x: 200, y: 400 },
      corner,
      fit,
      stage,
    });
    expect(m.backgroundWidth).toBeCloseTo(fit.width * L.magnifierZoom, 9);
    expect(m.backgroundX + corner.x * fit.scale * L.magnifierZoom).toBeCloseTo(
      m.size / 2,
      9,
    );
    expect(m.backgroundY + corner.y * fit.scale * L.magnifierZoom).toBeCloseTo(
      m.size / 2,
      9,
    );
  });
});

describe("cornerCheckDistances", () => {
  it("compares corner to corner whichever corner the placed frame starts from", () => {
    const placed: Quad4 = [
      { x: 803, y: 304 },
      { x: 800, y: 1150 },
      { x: 200, y: 1150 },
      { x: 200, y: 300 },
    ];
    expect(cornerCheckDistances(placed, RECT)).toEqual([0, 5, 0, 0]);
  });
});

describe("the named sizes", () => {
  it("a handle's target is at least 44 px", () => {
    expect(L().handleTargetPx).toBeGreaterThanOrEqual(44);
    expect(L().handleDotPx).toBeLessThan(L().handleTargetPx);
  });
});

function L() {
  return PAPER_ADJUST_LAYOUT;
}
