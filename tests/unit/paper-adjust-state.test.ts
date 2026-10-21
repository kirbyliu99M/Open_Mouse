/**
 * V3.2 F2 (candidate): the rules of the 手動調整邊框 screen
 * (src/client/camera/paperAdjustState.ts): when it is offered, relative drag,
 * the keyboard steps, the magnifier's place, the hidden-corner marks and when
 * the frame may be used. Scenes are SIMULATED (模擬).
 */
import { describe, expect, it } from "vitest";
import {
  PAPER_ADJUST_LAYOUT,
  adjustConfirmAction,
  adjustEntryFor,
  adjustWarningFor,
  frameMoved,
  isPaperIssue,
  adjustReadiness,
  adjustReducer,
  cornerCheckDistances,
  cornerPositions,
  KEY_DIRECTIONS,
  edgeStepOf,
  fitPhoto,
  isGuessedCorner,
  magnifierLayout,
  nudgeForKey,
  pipelinePaperInput,
  pointerMoveFor,
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
import {
  MANUAL_QUAD_LIMITS,
  type Quad4,
} from "../../src/client/paper/manualQuad";
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

describe("adjustEntryFor (F7, Kirby's phone test 2026-10-21): like Adobe Scan, every paper failure can have its frame fixed", () => {
  const PAPER_CODES = [
    "PAPER_NOT_FOUND",
    "PAPER_EDGE_HIDDEN",
    "PAPER_CORNER_HIDDEN",
    "PAPER_CURLED",
    // Any other paper gate, present or future (tilt, aspect): the prefix decides.
    "PAPER_TILTED",
    "PAPER_ASPECT_MISMATCH",
  ];
  const HAND_CODES = [
    "HAND_NOT_DETECTED",
    "HAND_OUT_OF_BOUNDS",
    "HANDEDNESS_MISMATCH",
    "LOW_LANDMARK_CONFIDENCE",
  ];
  const PLACED = { corners: RECT, source: "adjusted" as const };

  it("isPaperIssue: every PAPER_* code, nothing else", () => {
    for (const code of PAPER_CODES) expect(isPaperIssue(code)).toBe(true);
    for (const code of [...HAND_CODES, "LOW_SHARPNESS", "DECODE_FAILED"])
      expect(isPaperIssue(code)).toBe(false);
    expect(isPaperIssue(undefined)).toBe(false);
  });

  it("offers the rescue after every paper failure on a decoded photo, wherever it is listed, with or without ?debug=1", () => {
    for (const code of PAPER_CODES)
      for (const debugOn of [false, true]) {
        expect(
          adjustEntryFor(
            { kind: "gateFailure", errors: [issue(code)], overlay: overlay() },
            debugOn,
          ),
          code,
        ).toBe("rescue");
        // Listed after a hand reason, or together with another paper reason.
        expect(
          adjustEntryFor(
            {
              kind: "gateFailure",
              errors: [issue("HAND_OUT_OF_BOUNDS"), issue(code)],
              overlay: overlay(),
            },
            debugOn,
          ),
          code,
        ).toBe("rescue");
        expect(
          adjustEntryFor(
            {
              kind: "gateFailure",
              errors: [issue("PAPER_EDGE_HIDDEN"), issue(code)],
              overlay: overlay({ paperCorners: RECT }),
            },
            debugOn,
          ),
          code,
        ).toBe("rescue");
      }
  });

  it("not after a hand failure on the detector's own frame: moving it cannot help, and the sheet keeps its explanation", () => {
    for (const code of [
      ...HAND_CODES,
      "LOW_SHARPNESS",
      "MEASUREMENT_OUT_OF_RANGE",
    ])
      for (const placedFrame of [undefined, null])
        expect(
          adjustEntryFor(
            {
              kind: "gateFailure",
              errors: [issue(code)],
              overlay: overlay({ paperCorners: RECT }),
              placedFrame,
            },
            false,
          ),
          code,
        ).toBeNull();
  });

  it("after a hand gate turned back a frame the person placed, the rescue is offered again", () => {
    for (const code of HAND_CODES)
      for (const source of ["adjusted", "manual"] as const)
        expect(
          adjustEntryFor(
            {
              kind: "gateFailure",
              errors: [issue(code)],
              overlay: overlay(),
              placedFrame: { corners: RECT, source },
            },
            false,
          ),
          code,
        ).toBe("rescue");
  });

  it("never without a decoded photo to adjust on", () => {
    for (const code of [
      "PAPER_EDGE_HIDDEN",
      "DECODE_FAILED",
      "PROCESSING_FAILED",
    ]) {
      expect(
        adjustEntryFor(
          { kind: "gateFailure", errors: [issue(code)], overlay: null },
          false,
        ),
      ).toBeNull();
      expect(
        adjustEntryFor(
          {
            kind: "gateFailure",
            errors: [issue(code)],
            overlay: overlay({ imageWidth: 0, imageHeight: 0 }),
            placedFrame: PLACED,
          },
          false,
        ),
      ).toBeNull();
    }
    expect(adjustEntryFor({ kind: "none" }, true)).toBeNull();
    expect(adjustEntryFor({ kind: "processing" }, true)).toBeNull();
  });

  it("on a photo measured from the detector's own corners: 檢查邊框 (review); with ?debug=1, Kirby's corner check instead", () => {
    const measured = {
      kind: "measured" as const,
      overlay: overlay({ paperCorners: RECT }),
      submission: AUTO,
    };
    expect(adjustEntryFor(measured, false)).toBe("review");
    expect(adjustEntryFor(measured, true)).toBe("check");
    // No corners to review.
    expect(
      adjustEntryFor({ ...measured, overlay: overlay() }, false),
    ).toBeNull();
  });

  it("not on a photo measured from a frame placed by hand, nor with a typed length", () => {
    const adjusted = submission({
      method: "paper-edge",
      paperSize: "a4",
      cornersSource: "adjusted",
      parallaxCorrected: true,
    });
    for (const debugOn of [false, true])
      expect(
        adjustEntryFor(
          {
            kind: "measured",
            overlay: overlay({ paperCorners: RECT }),
            submission: adjusted,
          },
          debugOn,
        ),
      ).toBeNull();
    const typed = submission({
      method: "user-length",
      referenceMeasurement: "handLengthMm",
      referenceMm: 186,
      parallaxCorrected: false,
    });
    for (const debugOn of [false, true])
      expect(
        adjustEntryFor(
          { kind: "measured", overlay: overlay(), submission: typed },
          debugOn,
        ),
      ).toBeNull();
  });
});

describe("adjustWarningFor: PAPER_CURLED is said before confirming (F7)", () => {
  it("curled when the sheet was measured as curled, wherever it is listed; nothing otherwise", () => {
    expect(
      adjustWarningFor({
        kind: "gateFailure",
        errors: [issue("PAPER_CURLED")],
        overlay: overlay(),
      }),
    ).toBe("curled");
    expect(
      adjustWarningFor({
        kind: "gateFailure",
        errors: [issue("PAPER_EDGE_HIDDEN"), issue("PAPER_CURLED")],
        overlay: overlay(),
      }),
    ).toBe("curled");
    expect(
      adjustWarningFor({
        kind: "gateFailure",
        errors: [issue("PAPER_EDGE_HIDDEN")],
        overlay: overlay(),
      }),
    ).toBeNull();
    expect(
      adjustWarningFor({
        kind: "measured",
        overlay: overlay({ paperCorners: RECT }),
        submission: AUTO,
      }),
    ).toBeNull();
  });

  it("a curled sheet can still be confirmed: the warning does not stop the frame", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlay({ paperPartialCorners: [...RECT] }),
      paperSize: "a4",
      firstCode: "PAPER_CURLED",
    });
    const ready = adjustReadiness(state);
    expect(ready.ok).toBe(true);
    expect(
      adjustConfirmAction({
        entry: "rescue",
        result: {
          kind: "gateFailure",
          errors: [issue("PAPER_CURLED")],
          overlay: overlay(),
        },
        hasFile: true,
      }),
    ).toEqual({ kind: "rerun" });
  });
});

describe("where the frame opens (F7)", () => {
  it("PAPER_NOT_FOUND: the centred sheet, 72 % of the photo's width, all four corners not placed", () => {
    const state = startAdjust({
      entry: "rescue",
      // Even with corners left over from a partial detection.
      overlay: overlay({
        paperPartialCorners: [RECT[0], null, RECT[2], RECT[3]],
      }),
      paperSize: "a4",
      firstCode: "PAPER_NOT_FOUND",
    });
    expect(state.start.from).toBe("centred");
    expect(state.placed).toEqual([false, false, false, false]);
    const xs = state.corners.map((c) => c.x);
    const ys = state.corners.map((c) => c.y);
    const width = Math.max(...xs) - Math.min(...xs);
    expect(width / IMAGE.width).toBeCloseTo(
      MANUAL_QUAD_LIMITS.defaultWidthFraction,
      6,
    );
    expect(MANUAL_QUAD_LIMITS.defaultWidthFraction).toBe(0.72);
    // Centred.
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(
      IMAGE.width / 2,
      6,
    );
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(
      IMAGE.height / 2,
      6,
    );
    // A4's shape.
    expect((Math.max(...ys) - Math.min(...ys)) / width).toBeCloseTo(
      297 / 210,
      6,
    );
    // Nothing can be confirmed until each corner was dragged.
    expect(adjustReadiness(state)).toEqual({ ok: false, notPlaced: 0 });
  });

  it("a paper gate after the four corners were found: starts from them, placed", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlay({ paperPartialCorners: [...RECT] }),
      paperSize: "a4",
      firstCode: "PAPER_EDGE_HIDDEN",
    });
    expect(state.start.from).toBe("detected");
    expect(state.corners).toEqual(RECT);
    expect(state.placed).toEqual([true, true, true, true]);
  });

  it("after a frame placed by hand was turned back: that frame again, every corner placed, its source kept", () => {
    const placed: Quad4 = [
      { x: 210, y: 320 },
      { x: 790, y: 305 },
      { x: 812, y: 1140 },
      { x: 190, y: 1162 },
    ];
    for (const source of ["adjusted", "manual"] as const) {
      const state = startAdjust({
        entry: "rescue",
        overlay: overlay({ paperCorners: RECT }),
        paperSize: "a4",
        previous: { corners: placed, source },
        firstCode: "HAND_OUT_OF_BOUNDS",
      });
      expect(state.corners).toEqual(placed);
      expect(state.placed).toEqual([true, true, true, true]);
      const ready = adjustReadiness(state);
      expect(ready).toEqual({ ok: true, corners: placed, source });
      // Moving one corner keeps the others where they were.
      const moved = run(
        state,
        {
          type: "pointerDown",
          index: 1,
          pointerId: 1,
          pointerType: "touch",
          point: { x: 0, y: 0 },
        },
        { type: "pointerMove", pointerId: 1, point: { x: 5, y: 5 }, scale: 1 },
      );
      expect(moved.corners[0]).toEqual(placed[0]);
      expect(moved.corners[1]).toEqual({ x: 795, y: 310 });
      expect(frameMoved(moved)).toBe(true);
    }
  });

  it("a previous frame that is no longer usable falls back to the usual start", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlay(),
      paperSize: "a4",
      previous: {
        corners: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        source: "manual",
      },
    });
    expect(state.start.from).toBe("centred");
    expect(state.placed).toEqual([false, false, false, false]);
  });
});

describe("檢查邊框 on a measured photo (review, F7)", () => {
  const measured = {
    kind: "measured" as const,
    overlay: overlay({ paperCorners: RECT }),
    submission: AUTO,
  };
  const open = () =>
    startAdjust({
      entry: "review",
      overlay: measured.overlay,
      paperSize: "a4",
    });

  it("opens on the detector's own corners, all placed", () => {
    const state = open();
    expect(state.corners).toEqual(RECT);
    expect(state.placed).toEqual([true, true, true, true]);
    expect(frameMoved(state)).toBe(false);
  });

  it("confirmed without moving: the action is none, so nothing runs (that none leaves the result and its submission untouched is checked on EasyScanCamera's confirmAdjust in paper-adjust-screen.test.ts)", () => {
    const state = open();
    // A tap that selects a corner, and a press that never moves, move nothing.
    const tapped = run(
      state,
      { type: "select", index: 2 },
      {
        type: "pointerDown",
        index: 2,
        pointerId: 3,
        pointerType: "touch",
        point: { x: 40, y: 40 },
      },
      {
        type: "pointerMove",
        pointerId: 3,
        point: { x: 40, y: 40 },
        scale: 0.4,
      },
      { type: "pointerUp", pointerId: 3 },
    );
    expect(frameMoved(tapped)).toBe(false);
    expect(adjustReadiness(tapped).ok).toBe(true);
    const action = adjustConfirmAction({
      entry: "review",
      result: measured,
      hasFile: true,
      moved: frameMoved(tapped),
    });
    expect(action).toEqual({ kind: "none" });
    // The same frame, moved, is the only way to a rerun.
    expect(
      adjustConfirmAction({
        entry: "review",
        result: measured,
        hasFile: true,
        moved: true,
      }),
    ).toEqual({ kind: "rerun" });
  });

  it("a corner moved and back to exactly where it was is not a move", () => {
    const back = run(
      open(),
      {
        type: "pointerDown",
        index: 0,
        pointerId: 1,
        pointerType: "mouse",
        point: { x: 10, y: 10 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 30, y: 10 }, scale: 1 },
      { type: "pointerMove", pointerId: 1, point: { x: 10, y: 10 }, scale: 1 },
    );
    expect(frameMoved(back)).toBe(false);
  });

  it("moved: measured again from the moved frame, as adjusted (the pipeline's input and the event's paper say so)", () => {
    const moved = run(open(), {
      type: "nudge",
      index: 3,
      dx: 1,
      dy: 0,
      big: true,
      scale: 1,
    });
    expect(frameMoved(moved)).toBe(true);
    const ready = adjustReadiness(moved);
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.source).toBe("adjusted");
    expect(
      adjustConfirmAction({
        entry: "review",
        result: measured,
        hasFile: true,
        moved: true,
      }),
    ).toEqual({ kind: "rerun" });
    const input = pipelinePaperInput({
      typedLengthMm: null,
      paperSize: "a4",
      manualPaperCorners: { corners: ready.corners, source: ready.source },
    });
    expect(input.paper).toBe("adjusted");
    expect(input.pipeline.manualPaperCorners?.source).toBe("adjusted");
  });

  it("does nothing without the file, or once the result is no longer the measurement", () => {
    expect(
      adjustConfirmAction({
        entry: "review",
        result: measured,
        hasFile: false,
        moved: true,
      }),
    ).toEqual({ kind: "none" });
    expect(
      adjustConfirmAction({
        entry: "review",
        result: { kind: "processing" },
        hasFile: true,
        moved: true,
      }),
    ).toEqual({ kind: "none" });
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
      // The guess starts inside the sheet: dragged the whole way to TR.
      {
        type: "pointerMove",
        pointerId: 2,
        point: {
          x: 5 + (RECT[1].x - s.corners[1].x) * scale,
          y: 5 + (RECT[1].y - s.corners[1].y) * scale,
        },
        scale,
      },
    );
    expect(s.placed[1]).toBe(true);
    expect(s.corners[1].x).toBeCloseTo(RECT[1].x, 9);
    expect(s.corners[1].y).toBeCloseTo(RECT[1].y, 9);
  });

  it("a pointer back where the press began puts the corner back where it started", () => {
    // The review's case: out 3 screen px and back to the very same point.
    let s = run(
      rescue(),
      {
        type: "pointerDown",
        index: 0,
        pointerId: 1,
        pointerType: "mouse",
        point: { x: 100, y: 100 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 103, y: 100 }, scale },
    );
    expect(s.corners[0]).toEqual({ x: 200 + 3 / scale, y: 300 });
    expect(s.drag?.moved).toBe(true);
    s = run(
      s,
      { type: "pointerMove", pointerId: 1, point: { x: 100, y: 100 }, scale },
      { type: "pointerUp", pointerId: 1 },
    );
    expect(s.corners[0]).toEqual(RECT[0]);
    expect(s.placed[0]).toBe(true);
  });

  it("a press that never moves leaves the drag unmoved", () => {
    const s = run(
      rescue(),
      {
        type: "pointerDown",
        index: 0,
        pointerId: 1,
        pointerType: "mouse",
        point: { x: 100, y: 100 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 100, y: 100 }, scale },
    );
    expect(s.drag?.moved).toBe(false);
    expect(s.corners).toEqual(RECT);
  });
});

describe("the corner the detector did not find: a nudge does not accept the guess", () => {
  const partial = () =>
    startAdjust({
      entry: "rescue",
      overlay: overlay({
        paperPartialCorners: [RECT[0], null, RECT[2], RECT[3]],
      }),
      paperSize: "a4",
    });
  const minMove =
    Math.hypot(IMAGE.width, IMAGE.height) *
    MANUAL_QUAD_LIMITS.guessMinMoveFraction;

  it("names the guessed corner, only in a partial start", () => {
    const s = partial();
    expect([0, 1, 2, 3].map((i) => isGuessedCorner(s, i as 0))).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect([0, 1, 2, 3].map((i) => isGuessedCorner(rescue(), i as 0))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(MANUAL_QUAD_LIMITS.guessMinMoveFraction).toBe(0.03);
  });

  it("one arrow press, or ten with Shift, leaves it not placed and the frame unusable", () => {
    const scale = 0.4;
    let s = run(partial(), {
      type: "nudge",
      index: 1,
      dx: 1,
      dy: 0,
      big: false,
      scale,
    });
    expect(s.placed[1]).toBe(false);
    expect(adjustReadiness(s)).toEqual({ ok: false, notPlaced: 1 });
    s = run(s, { type: "nudge", index: 1, dx: 1, dy: 0, big: true, scale });
    // 1 + 10 screen px at 0.4 = 27.5 photo px: still under the minimum.
    expect(1 / scale + 10 / scale).toBeLessThan(minMove);
    expect(s.placed[1]).toBe(false);
    expect(adjustReadiness(s)).toEqual({ ok: false, notPlaced: 1 });
  });

  it("a drag past the minimum places it, and a drag back near its start unplaces it", () => {
    const start = partial();
    const from = start.corners[1];
    const down: AdjustAction = {
      type: "pointerDown",
      index: 1,
      pointerId: 1,
      pointerType: "touch",
      point: { x: 0, y: 0 },
    };
    // Just short of the minimum (photo px; scale 1).
    let s = run(start, down, {
      type: "pointerMove",
      pointerId: 1,
      point: { x: minMove - 1, y: 0 },
      scale: 1,
    });
    expect(s.corners[1]).toEqual({ x: from.x + minMove - 1, y: from.y });
    expect(s.placed[1]).toBe(false);
    s = run(s, {
      type: "pointerMove",
      pointerId: 1,
      point: { x: minMove + 1, y: 0 },
      scale: 1,
    });
    expect(s.placed[1]).toBe(true);
    s = run(s, {
      type: "pointerMove",
      pointerId: 1,
      point: { x: 2, y: 0 },
      scale: 1,
    });
    expect(s.placed[1]).toBe(false);
  });

  it("a corner the detector found is placed by any move, however small", () => {
    const s = run(partial(), {
      type: "nudge",
      index: 0,
      dx: 1,
      dy: 0,
      big: false,
      scale: 1,
    });
    expect(s.placed[0]).toBe(true);
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

describe("keys and pointer moves become actions at the photo's scale (PaperAdjust.tsx)", () => {
  // A 390 px phone stage, the photo fitted with the handle inset (simulated).
  const fit = fitPhoto(
    IMAGE,
    { width: 390, height: 700 },
    PAPER_ADJUST_LAYOUT.handleTargetPx / 2,
  );

  it("each arrow key nudges its own way, Shift is the big step, other keys do nothing", () => {
    expect(Object.keys(KEY_DIRECTIONS).sort()).toEqual([
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
    ]);
    const cases = [
      ["ArrowLeft", -1, 0],
      ["ArrowRight", 1, 0],
      ["ArrowUp", 0, -1],
      ["ArrowDown", 0, 1],
    ] as const;
    for (const [key, dx, dy] of cases)
      for (const shiftKey of [false, true])
        expect(nudgeForKey({ key, shiftKey, index: 2, fit })).toEqual({
          type: "nudge",
          index: 2,
          dx,
          dy,
          big: shiftKey,
          scale: fit.scale,
        });
    for (const key of ["Enter", " ", "a", "Tab", "toString", "constructor"])
      expect(nudgeForKey({ key, shiftKey: false, index: 0, fit })).toBeNull();
  });

  it("an arrow on screen moves the corner the same way in the photo", () => {
    const up = nudgeForKey({ key: "ArrowUp", shiftKey: false, index: 0, fit })!;
    const s = run(rescue(), up);
    expect(s.corners[0].x).toBe(RECT[0].x);
    expect(s.corners[0].y).toBeCloseTo(RECT[0].y - 1 / fit.scale, 9);
    expect(s.corners[0].y).toBeLessThan(RECT[0].y);
  });

  it("a pointer move carries the fitted scale, so 1 screen px is about 3 photo px on a phone (not 1)", () => {
    const move = pointerMoveFor({ pointerId: 3, point: { x: 11, y: 7 }, fit });
    expect(move).toEqual({
      type: "pointerMove",
      pointerId: 3,
      point: { x: 11, y: 7 },
      scale: fit.scale,
    });
    expect(fit.scale).toBeLessThan(0.35);
    const s = run(
      rescue(),
      {
        type: "pointerDown",
        index: 0,
        pointerId: 3,
        pointerType: "touch",
        point: { x: 10, y: 7 },
      },
      move,
    );
    expect(s.corners[0].x - RECT[0].x).toBeCloseTo(1 / fit.scale, 9);
    expect(s.corners[0].x - RECT[0].x).toBeGreaterThan(2.5);
  });
});

describe("what the pipeline is told about the paper (pipelinePaperInput)", () => {
  const corners = { corners: RECT, source: "manual" as const };

  it("with paper and a placed frame: the frame goes in and the event says adjusted", () => {
    expect(
      pipelinePaperInput({
        typedLengthMm: null,
        paperSize: "letter",
        manualPaperCorners: corners,
      }),
    ).toEqual({
      pipeline: {
        calibration: { method: "paper-edge", paperSize: "letter" },
        manualPaperCorners: corners,
      },
      paper: "adjusted",
    });
  });

  it("with a typed length: no frame, whatever was placed, and no sheet", () => {
    const r = pipelinePaperInput({
      typedLengthMm: 190,
      paperSize: "a4",
      manualPaperCorners: corners,
    });
    expect(r).toEqual({
      pipeline: { calibration: { method: "user-length", handLengthMm: 190 } },
      paper: "none",
    });
    expect("manualPaperCorners" in r.pipeline).toBe(false);
  });

  it("with paper and no frame: the detector's run, detected", () => {
    const r = pipelinePaperInput({ typedLengthMm: null, paperSize: "a4" });
    expect(r).toEqual({
      pipeline: { calibration: { method: "paper-edge", paperSize: "a4" } },
      paper: "detected",
    });
    expect("manualPaperCorners" in r.pipeline).toBe(false);
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

  it("refuses to start while a neighbour of the hidden corner is only a starting guess", () => {
    // No corners found: the centred sheet, nothing placed (also the check's start).
    for (const entry of ["rescue", "check"] as const) {
      let s = startAdjust({ entry, overlay: overlay(), paperSize: "a4" });
      expect(s.start.from).toBe("centred");
      s = run(s, { type: "select", index: 1 }, { type: "edgeStart" });
      expect(s.edge).toBeNull();
      expect(s.notice).toEqual({
        kind: "placeNeighboursFirst",
        index: 1,
        missing: 0,
      });
      // Taps outside the edge mode change nothing.
      const before = s;
      s = run(
        s,
        { type: "edgeTap", point: { x: 300, y: 300 } },
        { type: "edgeTap", point: { x: 600, y: 700 } },
      );
      expect(s).toBe(before);
      expect(s.placed[1]).toBe(false);
      // One neighbour placed is not enough.
      s = run(s, {
        type: "nudge",
        index: 0,
        dx: 1,
        dy: 0,
        big: false,
        scale: 1,
      });
      s = run(s, { type: "select", index: 1 }, { type: "edgeStart" });
      expect(s.notice).toEqual({
        kind: "placeNeighboursFirst",
        index: 1,
        missing: 2,
      });
      // Both placed: the marks may begin.
      s = run(
        s,
        { type: "nudge", index: 2, dx: 0, dy: 1, big: false, scale: 1 },
        { type: "select", index: 1 },
        { type: "edgeStart" },
      );
      expect(s.edge).toEqual({ index: 1, points: [] });
      expect(s.notice).toBeNull();
    }
  });

  it("refuses the second tap too when a neighbour stopped being placed meanwhile", () => {
    let s = run(start(), { type: "edgeTap", point: mid(c[1], c[2]) });
    s = { ...s, placed: [true, false, false, true] };
    s = run(s, { type: "edgeTap", point: mid(c[3], c[2]) });
    expect(s.edge).toBeNull();
    expect(s.placed[2]).toBe(false);
    expect(s.notice).toEqual({
      kind: "placeNeighboursFirst",
      index: 2,
      missing: 1,
    });
  });

  const solvedBR = () =>
    run(
      start(),
      { type: "edgeTap", point: mid(c[1], c[2]) },
      { type: "edgeTap", point: mid(c[3], c[2]) },
    );

  it("a worked-out corner goes back to not placed when either neighbour moves (drag or keys)", () => {
    const solved = solvedBR();
    expect(solved.placed[2]).toBe(true);
    expect(solved.solved).toEqual([false, false, true, false]);

    const keyed = run(solved, {
      type: "nudge",
      index: 1,
      dx: 0,
      dy: 1,
      big: true,
      scale: 1,
    });
    expect(keyed.placed).toEqual([true, true, false, true]);
    expect(keyed.solved).toEqual([false, false, false, false]);
    expect(keyed.corners[2]).toEqual(solved.corners[2]);
    expect(keyed.notice).toEqual({ kind: "edgeUndone", index: 2 });
    expect(adjustReadiness(keyed)).toEqual({ ok: false, notPlaced: 2 });

    const dragged = run(
      solved,
      {
        type: "pointerDown",
        index: 3,
        pointerId: 7,
        pointerType: "touch",
        point: { x: 100, y: 100 },
      },
      {
        type: "pointerMove",
        pointerId: 7,
        point: { x: 104, y: 100 },
        scale: 0.5,
      },
      {
        type: "pointerMove",
        pointerId: 7,
        point: { x: 108, y: 100 },
        scale: 0.5,
      },
      { type: "pointerUp", pointerId: 7 },
    );
    expect(dragged.placed[2]).toBe(false);
    expect(dragged.notice).toEqual({ kind: "edgeUndone", index: 2 });
    expect(adjustReadiness(dragged)).toEqual({ ok: false, notPlaced: 2 });

    // The neighbour put back on the paper's corner, the marks again: placed again.
    const again = run(
      keyed,
      { type: "nudge", index: 1, dx: 0, dy: -1, big: true, scale: 1 },
      { type: "select", index: 2 },
      { type: "edgeStart" },
      { type: "edgeTap", point: mid(c[1], c[2]) },
      { type: "edgeTap", point: mid(c[3], c[2]) },
    );
    expect(again.corners[1]).toEqual(c[1]);
    expect(again.notice).toEqual({ kind: "edgeSolved", index: 2 });
    expect(again.placed).toEqual([true, true, true, true]);
    expect(
      Math.hypot(again.corners[2].x - c[2].x, again.corners[2].y - c[2].y),
    ).toBeLessThan(0.05);
  });

  it("a move of a corner that is not a neighbour, or a press without a move, leaves it placed", () => {
    const solved = solvedBR();
    const opposite = run(solved, {
      type: "nudge",
      index: 0,
      dx: 1,
      dy: 1,
      big: false,
      scale: 1,
    });
    expect(opposite.placed[2]).toBe(true);
    expect(opposite.solved[2]).toBe(true);
    const pressed = run(
      solved,
      {
        type: "pointerDown",
        index: 1,
        pointerId: 3,
        pointerType: "mouse",
        point: { x: 50, y: 50 },
      },
      { type: "pointerMove", pointerId: 3, point: { x: 50, y: 50 }, scale: 1 },
      { type: "pointerUp", pointerId: 3 },
    );
    expect(pressed.placed[2]).toBe(true);
  });

  it("once the person drags the worked-out corner itself, it no longer depends on its neighbours", () => {
    let s = run(solvedBR(), {
      type: "nudge",
      index: 2,
      dx: 1,
      dy: 0,
      big: false,
      scale: 1,
    });
    expect(s.solved[2]).toBe(false);
    s = run(s, { type: "nudge", index: 1, dx: 0, dy: 1, big: false, scale: 1 });
    expect(s.placed[2]).toBe(true);
    expect(s.notice).toBeNull();
  });

  it("reset forgets which corners were worked out", () => {
    const s = run(solvedBR(), { type: "reset" });
    expect(s.solved).toEqual([false, false, false, false]);
    expect(s.placed).toEqual([true, true, false, true]);
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

  it("two corners dragged onto the photo's corner block it as degenerate (no crash later)", () => {
    // TR and BR both dragged past the photo's top-right: both clamp to (W, 0).
    const far = { x: 5000, y: -5000 };
    const s = run(
      rescue(),
      {
        type: "pointerDown",
        index: 1,
        pointerId: 1,
        pointerType: "mouse",
        point: { x: 0, y: 0 },
      },
      { type: "pointerMove", pointerId: 1, point: far, scale: 1 },
      { type: "pointerUp", pointerId: 1 },
      {
        type: "pointerDown",
        index: 2,
        pointerId: 2,
        pointerType: "mouse",
        point: { x: 0, y: 0 },
      },
      { type: "pointerMove", pointerId: 2, point: far, scale: 1 },
      { type: "pointerUp", pointerId: 2 },
    );
    expect(s.corners[1]).toEqual({ x: IMAGE.width, y: 0 });
    expect(s.corners[2]).toEqual({ x: IMAGE.width, y: 0 });
    expect(adjustReadiness(s)).toEqual({ ok: false, problem: "degenerate" });
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
