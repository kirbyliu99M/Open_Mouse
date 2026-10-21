/**
 * V3.2 F2 (candidate): the 手動調整邊框 screen as drawn (PaperAdjust.tsx,
 * rendered to static markup: the repo has no DOM test library), its styles,
 * where the easy-scan camera offers it, and what it may never do (send
 * anything, or read the photo). The rules it follows are tested in
 * paper-adjust-state.test.ts.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaperAdjust } from "../../src/client/camera/PaperAdjust";
import {
  PAPER_ADJUST_LAYOUT,
  adjustConfirmAction,
  adjustReducer,
  fitPhoto,
  scanMeasuredPaper,
  sheetView,
  startAdjust,
  toScreen,
  type AdjustableResult,
  type AdjustState,
} from "../../src/client/camera/paperAdjustState";
import { analyticsEventSchemas } from "../../src/lib/contracts/analytics";
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
} from "../../src/lib/contracts/measurement";
import type { PhotoOverlay } from "../../src/client/photo/pipeline";
import type { Quad4 } from "../../src/client/paper/manualQuad";
import { paperAdjustCopy } from "../../src/lib/copy/paper-adjust";

const IMAGE = { width: 1024, height: 1920 };
const RECT: Quad4 = [
  { x: 200, y: 300 },
  { x: 800, y: 300 },
  { x: 800, y: 1150 },
  { x: 200, y: 1150 },
];
const OVERLAY: PhotoOverlay = {
  imageWidth: IMAGE.width,
  imageHeight: IMAGE.height,
  markers: [],
  card: null,
  landmarksPx: null,
  paperCorners: RECT,
};
const URL_ = "blob:http://localhost/0d6c1e0a";

function render(
  extra: {
    entry?: "rescue" | "review" | "check";
    state?: AdjustState;
    warning?: "curled" | null;
    stage?: { width: number; height: number };
    magnifier?: boolean;
    locale?: "zh-TW" | "en";
    overlay?: PhotoOverlay;
  } = {},
) {
  return renderToStaticMarkup(
    createElement(PaperAdjust, {
      entry: extra.entry ?? "rescue",
      overlay: extra.overlay ?? OVERLAY,
      paperSize: "a4",
      previewUrl: URL_,
      locale: extra.locale ?? "zh-TW",
      onCancel: () => undefined,
      onConfirm: () => undefined,
      initialState: extra.state,
      initialStageSize: extra.stage ?? { width: 390, height: 600 },
      initialMagnifier: extra.magnifier,
      warning: extra.warning,
    }),
  );
}

const handles = (html: string) =>
  [...html.matchAll(/<button[^>]*class="paperAdjustHandle"[^>]*>/g)].map(
    (m) => m[0],
  );

describe("the handles", () => {
  it("draws four, named for where they are, described for the keyboard, placed at their corners", () => {
    const html = render();
    const all = handles(html);
    expect(all).toHaveLength(4);
    const copy = paperAdjustCopy("zh-TW");
    copy.cornerNames.forEach((name, i) => {
      expect(all[i]).toContain(`aria-label="${name}"`);
      expect(all[i]).toContain('aria-describedby="paper-adjust-keys"');
      expect(all[i]).toContain('data-placed="true"');
    });
    expect(html).toContain(copy.keyboardHint);
    // F10: the screen opens zoomed onto the frame (sheetView), not on the
    // whole photo.
    const fit = sheetView(IMAGE, { width: 390, height: 600 }, RECT);
    expect(fit.scale).toBeGreaterThan(
      fitPhoto(IMAGE, { width: 390, height: 600 }, 24).scale,
    );
    expect(html).toContain('data-view="zoomed"');
    const p = toScreen(RECT[2], fit);
    const half = PAPER_ADJUST_LAYOUT.handleTargetPx / 2;
    expect(all[2]).toContain(
      `transform:translate(${p.x - half}px, ${p.y - half}px)`,
    );
  });

  it("marks a corner still at its starting guess as not placed, in its name too", () => {
    const html = render({
      overlay: {
        ...OVERLAY,
        paperCorners: undefined,
        paperPartialCorners: [RECT[0], null, RECT[2], RECT[3]],
      },
    });
    const all = handles(html);
    expect(all[1]).toContain('data-placed="false"');
    expect(all[1]).toContain("還沒對齊");
    expect(html).toContain(paperAdjustCopy("zh-TW").instructionGuess);
    // The primary button says it cannot be used yet, without being removed
    // from the keyboard order.
    expect(html).toMatch(
      /<button[^>]*class="primaryButton paperAdjustConfirm"[^>]*aria-disabled="true"/,
    );
  });

  it("keeps a corner at the photo's very edge inside the stage, at 320 and 390 px", () => {
    const edge: Quad4 = [
      { x: 0, y: 0 },
      { x: IMAGE.width, y: 0 },
      { x: IMAGE.width, y: IMAGE.height },
      { x: 0, y: IMAGE.height },
    ];
    for (const stage of [
      { width: 320, height: 330 },
      { width: 390, height: 600 },
    ]) {
      const fit = fitPhoto(
        IMAGE,
        stage,
        PAPER_ADJUST_LAYOUT.handleTargetPx / 2,
      );
      for (const c of edge) {
        const p = toScreen(c, fit);
        const half = PAPER_ADJUST_LAYOUT.handleTargetPx / 2;
        expect(p.x - half).toBeGreaterThanOrEqual(-1e-9);
        expect(p.y - half).toBeGreaterThanOrEqual(-1e-9);
        expect(p.x + half).toBeLessThanOrEqual(stage.width + 1e-9);
        expect(p.y + half).toBeLessThanOrEqual(stage.height + 1e-9);
      }
      expect(handles(render({ stage }))).toHaveLength(4);
    }
  });
});

describe("the magnifier", () => {
  const dragging = (entry: "rescue" | "check" = "rescue") =>
    adjustReducer(startAdjust({ entry, overlay: OVERLAY, paperSize: "a4" }), {
      type: "pointerDown",
      index: 0,
      pointerId: 1,
      pointerType: "touch",
      point: { x: 200, y: 400 },
    });

  it("appears while a corner is dragged, showing the photo four times larger", () => {
    expect(render()).not.toContain("paperAdjustMagnifier");
    const html = render({ state: dragging() });
    const m = html.match(/<div[^>]*class="paperAdjustMagnifier"[^>]*>/)?.[0];
    expect(m).toBeDefined();
    expect(m).toContain('aria-hidden="true"');
    expect(m).toContain(`background-image:url(&quot;${URL_}&quot;)`);
    // Four times the photo as it is shown now (zoomed onto the frame, F10).
    const fit = sheetView(IMAGE, { width: 390, height: 600 }, RECT);
    expect(m).toContain(
      `background-size:${fit.width * PAPER_ADJUST_LAYOUT.magnifierZoom}px`,
    );
    // Above the finger (the press was at y 400).
    expect(m).toContain('data-side="above"');
  });

  it("the corner check can switch it off, and says which", () => {
    const off = render({
      entry: "check",
      state: dragging("check"),
      magnifier: false,
    });
    expect(off).not.toContain("paperAdjustMagnifier");
    expect(off).toMatch(/aria-pressed="false"[^>]*>放大鏡：關/);
    const on = render({ entry: "check", state: dragging("check") });
    expect(on).toContain("paperAdjustMagnifier");
    expect(on).toMatch(/aria-pressed="true"[^>]*>放大鏡：開/);
  });

  it("the rescue has no switch: the magnifier is always on there", () => {
    expect(render()).not.toContain("paper-adjust-magnifier-toggle");
  });
});

describe("the hidden-corner marks", () => {
  it("says which edge to tap, step by step, and how to stop", () => {
    let s = startAdjust({ entry: "rescue", overlay: OVERLAY, paperSize: "a4" });
    s = adjustReducer(s, { type: "select", index: 2 });
    s = adjustReducer(s, { type: "edgeStart" });
    const html = render({ state: s });
    expect(html).toContain("第 1 步");
    expect(html).toContain("右上角和右下角之間");
    expect(html).toContain(paperAdjustCopy("zh-TW").edgeModeCancel);
    expect(html).toContain('data-marking="true"');
    expect(html).toContain('data-hidden-corner="true"');
  });

  it("says why a corner could not be worked out", () => {
    let s = startAdjust({ entry: "rescue", overlay: OVERLAY, paperSize: "a4" });
    s = adjustReducer(s, { type: "select", index: 2 });
    s = adjustReducer(s, { type: "edgeStart" });
    s = adjustReducer(s, { type: "edgeTap", point: { x: 250, y: 1150 } });
    s = adjustReducer(s, { type: "edgeTap", point: { x: 300, y: 1150 } });
    if (s.notice?.kind !== "edgeProblem") throw new Error("no problem");
    expect(render({ state: s })).toContain(
      paperAdjustCopy("zh-TW").edgeProblem[s.notice.problem],
    );
  });
});

describe("words", () => {
  it("the English screen has the same parts", () => {
    const html = render({ locale: "en" });
    expect(html).toContain("Adjust the paper&#x27;s frame");
    expect(html).toContain("Measure with this frame");
    expect(handles(html)[0]).toContain('aria-label="Top-left corner"');
  });

  it("檢查邊框 (F7) is named as such, opens on the detector's corners, with its own button", () => {
    for (const locale of ["zh-TW", "en"] as const) {
      const copy = paperAdjustCopy(locale);
      const html = render({ entry: "review", locale });
      expect(html).toContain('data-entry="review"');
      expect(html).toContain(copy.review.title.replace(/'/g, "&#x27;"));
      expect(html).toContain(copy.review.confirm);
      // Every corner is the detector's: placed.
      expect(handles(html).every((h) => h.includes('data-placed="true"'))).toBe(
        true,
      );
    }
    expect(paperAdjustCopy("zh-TW").review.entry).toBe("檢查邊框");
  });

  it("a curled sheet is said before confirming (F7), and the confirm button stays usable", () => {
    for (const locale of ["zh-TW", "en"] as const) {
      const html = render({ warning: "curled", locale });
      expect(html).toContain('data-testid="paper-adjust-warning"');
      expect(html).toContain(
        paperAdjustCopy(locale).curledWarning.replace(/'/g, "&#x27;"),
      );
      const confirm = html.match(
        /<button[^>]*data-testid="paper-adjust-confirm"[^>]*>/,
      )![0];
      expect(confirm).not.toContain("aria-disabled");
    }
    expect(paperAdjustCopy("zh-TW").curledWarning).toBe(
      "紙好像沒有平貼，手動調整後量測可能不準，建議先把紙壓平再拍一次。",
    );
    expect(render()).not.toContain("paper-adjust-warning");
  });

  it("the corner check is named as such, with its own button", () => {
    const html = render({ entry: "check" });
    expect(html).toContain("拖角精度測試");
    expect(html).toContain("記錄這次");
    expect(html).toContain('data-entry="check"');
  });

  it("claims no accuracy and no health effect", () => {
    for (const locale of ["zh-TW", "en"] as const) {
      const text = JSON.stringify(paperAdjustCopy(locale));
      expect(text).not.toMatch(/精準|精確|準確|保證|健康|醫|治療|疼|痛/);
      expect(text).not.toMatch(/accura|precise|guarantee|health|medical|pain/i);
    }
  });
});

describe("styles (easy-scan.css)", () => {
  const css = readFileSync("src/client/camera/easy-scan.css", "utf8");
  const section = css.slice(css.indexOf(".paperAdjust {"));
  const rule = (selector: string) => {
    const at = section.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return section.slice(at, section.indexOf("}", at));
  };

  it("a handle's target is 48 px and never under 44 px", () => {
    const handle = rule(".paperAdjustHandle");
    expect(handle).toContain(`width: ${PAPER_ADJUST_LAYOUT.handleTargetPx}px`);
    expect(handle).toContain(`height: ${PAPER_ADJUST_LAYOUT.handleTargetPx}px`);
    expect(handle).toContain("min-width: 44px");
    expect(handle).toContain("min-height: 44px");
    expect(rule(".paperAdjustDot")).toContain(
      `width: ${PAPER_ADJUST_LAYOUT.handleDotPx}px`,
    );
    for (const s of [".paperAdjustTool", ".paperAdjustCancel"])
      expect(rule(s)).toContain("min-height: 44px");
  });

  it("the stage takes the pointer itself (no page scroll or zoom while dragging)", () => {
    expect(rule(".paperAdjustStage")).toContain("touch-action: none");
  });

  it("reduced motion removes the only transition, and nothing here animates on its own", () => {
    const reduced = section.slice(
      section.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced).toMatch(/\.paperAdjustDot \{\s*transition: none;/);
    expect(section).not.toMatch(/@keyframes|animation:/);
  });

  it("uses the dark theme's tokens: no new colour", () => {
    const end = section.indexOf(".easySheetAdjustedNote");
    const own = section.slice(0, end);
    expect(own).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(own).toContain("var(--bg)");
    expect(own).toContain("var(--accent-text)");
  });
});

describe("where the camera offers it (EasyScanCamera.tsx)", () => {
  const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");

  it("decides with adjustEntryFor, from the result on screen and ?debug=1 alone", () => {
    expect(source).toContain(
      "const adjustEntry = adjustEntryFor(result, debugOn);",
    );
    expect(source).toMatch(
      /new URLSearchParams\(window\.location\.search\)\.get\("debug"\) === "1"/,
    );
  });

  it("each button is drawn on its own entry alone, by the exact condition", () => {
    // The condition itself, so a widened one (`|| debugOn`) fails here; where
    // each sheet sits in the file is not asserted (layout may move freely).
    const count = (needle: string) => source.split(needle).length - 1;
    expect(count('{adjustEntry === "rescue" && (')).toBe(1);
    expect(count('{adjustEntry === "review" && (')).toBe(1);
    expect(count('{adjustEntry === "check" && (')).toBe(1);
    expect(count("adjustEntry ===")).toBe(3);
    expect(count('data-testid="adjust-frame-entry"')).toBe(1);
    expect(count('data-testid="frame-review-entry"')).toBe(1);
    expect(count('data-testid="corner-check-entry"')).toBe(1);
  });

  it("the failure sheet's main action stays 再拍一次; the adjustment is the button after it (F7)", () => {
    const failure = source.slice(
      source.indexOf('className="primaryButton easyTryAgainButton"'),
    );
    expect(failure.indexOf("{common.tryAgain}")).toBeGreaterThan(0);
    expect(failure.indexOf("{common.tryAgain}")).toBeLessThan(
      failure.indexOf('data-testid="adjust-frame-entry"'),
    );
    // A hand failure on a frame the person placed opens that frame again, and
    // a curled sheet says so before confirming.
    expect(source).toContain("previous={");
    expect(source).toContain("result.placedFrame ?? null");
    expect(source).toContain("warning={adjustWarningFor(result)}");
    // F10: no first-code special case any more (F7 opened PAPER_NOT_FOUND on
    // the centred sheet); the frame opens on the best guess in the overlay.
    expect(source).not.toContain("firstCode=");
  });

  it("confirming goes through adjustConfirmAction; the pipeline runs only for its rerun, and nothing is sent", () => {
    const confirm = source.slice(
      source.indexOf("const confirmAdjust = useCallback("),
      source.indexOf("const changePaperSize = useCallback("),
    );
    expect(confirm).toContain("adjustConfirmAction({");
    const rerunGuard = confirm.indexOf('action.kind !== "rerun"');
    const rerun = confirm.indexOf(
      "void runPipeline(fileRef.current, current.previewUrl, {",
    );
    expect(rerunGuard).toBeGreaterThan(0);
    expect(rerun).toBeGreaterThan(rerunGuard);
    expect(confirm.split("runPipeline(").length - 1).toBe(1);
    expect(confirm).toContain("source: placed.source,");
    // Whether a corner moved reaches adjustConfirmAction (its `moved` is
    // optional, so the type checker would not notice it missing): without it
    // a moved 檢查邊框 frame would close without measuring again (F7).
    expect(confirm).toContain("moved: placed.moved,");
    expect(confirm).not.toMatch(/fetch\(|sendBeacon|XMLHttpRequest|track\(/);
    // The check only writes the local attempt log.
    expect(confirm).toContain('kind: "cornerCheck"');
  });

  it("confirming without a rerun leaves the result alone: it returns before anything is run, and nothing in it writes the result (F7)", () => {
    const confirm = source.slice(
      source.indexOf("const confirmAdjust = useCallback("),
      source.indexOf("const changePaperSize = useCallback("),
    );
    // The guard returns, and the only run comes after that return.
    const guard = confirm.indexOf('action.kind !== "rerun"');
    const guardReturn = confirm.indexOf("return;", guard);
    const rerun = confirm.indexOf("void runPipeline(");
    expect(guard).toBeGreaterThan(0);
    expect(guardReturn).toBeGreaterThan(guard);
    expect(rerun).toBeGreaterThan(guardReturn);
    // The guard has no other way through: only a rerun on a result with a
    // photo goes on.
    const guardBlock = confirm.slice(guard - 20, guardReturn);
    expect(guardBlock.split("||").length - 1).toBe(2);
    expect(guardBlock).toContain("!fileRef.current");
    // So the measurement on screen and its submission stay as they were:
    // nothing here sets the result or writes into it.
    expect(confirm).not.toMatch(
      /setResult\(|resultRef\.current\s*=[^=]|\.submission\s*=[^=]/,
    );
  });

  it("a frame the person placed stays with the result when a gate turns it back, and goes back into a handedness rerun (F7)", () => {
    const count = (needle: string) => source.split(needle).length - 1;
    const process = source.slice(
      source.indexOf('kind: "gateFailure",'),
      source.indexOf('reportCaught(error, "easy-scan.process");'),
    );
    // Both gate-failure results the pipeline writes carry the placed frame.
    expect(process.split('kind: "gateFailure",').length - 1).toBe(2);
    expect(
      process.split(
        "placedFrame: paperInput.pipeline.manualPaperCorners ?? null,",
      ).length - 1,
    ).toBe(2);
    expect(
      count("placedFrame: paperInput.pipeline.manualPaperCorners ?? null,"),
    ).toBe(2);
    // The handedness toggle reruns the same photo with that frame.
    const toggle = source.slice(
      source.indexOf(
        'resultRef.current.errors[0]?.code === "HANDEDNESS_MISMATCH"',
      ),
    );
    const rerun = toggle.slice(0, toggle.indexOf("}, [runPipeline]);"));
    expect(rerun).toContain("void runPipeline(");
    expect(rerun).toContain("resultRef.current.placedFrame ?? undefined,");
  });

  it("a measurement from a placed frame says so on the sheet; its paper and the pipeline's frame come from one pipelinePaperInput", () => {
    expect(source).toContain("paperAdjustCopy(locale).measuredNote");
    const run = source.slice(
      source.indexOf("const runPipeline = useCallback("),
      source.indexOf("const confirmAdjust = useCallback("),
    );
    expect(run.length).toBeGreaterThan(0);
    // The frame the confirm passes in is read once, with the typed length and
    // the paper size, and that one reading is both the event's paper...
    expect(run).toMatch(
      /const paperInput = pipelinePaperInput\(\{\s*typedLengthMm: userLengthRef\.current,\s*paperSize: paperSizeRef\.current,\s*manualPaperCorners,\s*\}\);/,
    );
    expect(run).toContain("const paperUsed = paperInput.paper;");
    expect(run).toMatch(/paper:\s*paperUsed/);
    // ...and what the pipeline is given (calibration and manualPaperCorners).
    const call = run.slice(run.indexOf("await runPhotoPipelineImpl({"));
    expect(call.indexOf("...paperInput.pipeline,")).toBeGreaterThan(0);
    expect(call.indexOf("...paperInput.pipeline,")).toBeLessThan(
      call.indexOf("});"),
    );
    // Nothing else sets them in that call.
    expect(call.slice(0, call.indexOf("});"))).not.toMatch(
      /calibration:|manualPaperCorners/,
    );
  });
});

describe("PaperAdjust.tsx turns keys and moves into actions through the tested helpers", () => {
  const adjust = readFileSync("src/client/camera/PaperAdjust.tsx", "utf8");

  it("the arrow keys go through nudgeForKey, with the event's key, Shift and the fit", () => {
    expect(adjust).toMatch(
      /nudgeForKey\(\{\s*key: e\.key,\s*shiftKey: e\.shiftKey,\s*index,\s*fit,\s*\}\)/,
    );
    expect(adjust).toContain("dispatch(nudge);");
    expect(adjust).not.toContain("KEY_DIRECTIONS");
    expect(adjust).not.toMatch(/type: "nudge"/);
  });

  it("a pointer move goes through pointerMoveFor with the fit", () => {
    expect(adjust).toMatch(
      /pointerMoveFor\(\{ pointerId: e\.pointerId, point, fit \}\)/,
    );
    expect(adjust).toContain("const point = stagePoint(e);");
    expect(adjust).not.toMatch(/type: "pointerMove"/);
  });
});

// F10 items 3-5 on the screen itself (review of F10: the pure helpers were
// tested, their wiring was not, so removing it left every test green). The
// repo has no DOM test library, so the wiring is read from the source, as
// above and in camera-reused-focal-wiring.test.ts.
describe("PaperAdjust.tsx wires F10's magnifier, views, pinch and centred frame", () => {
  const adjust = readFileSync("src/client/camera/PaperAdjust.tsx", "utf8")
    .split("\r\n")
    .join("\n");
  const between = (from: string, to: string) => {
    const start = adjust.indexOf(from);
    const end = adjust.indexOf(to, start + from.length);
    expect(start, from).toBeGreaterThan(0);
    expect(end, to).toBeGreaterThan(start);
    return adjust.slice(start, end);
  };
  const stageDown = between("const onStageDown = (", "const onStageMove = (");
  const stageMove = between("const onStageMove = (", "const onStageUp = (");
  const handleDown = between("const onHandleDown =", "const onStageDown = (");
  const startPinch = between("const startPinch = (", "const beginDrag = (");

  it("the magnifier keeps its side through a drag: each move passes the last placement as previous (AC4, hysteresis)", () => {
    expect(stageMove).toMatch(
      /setMagnifierAt\(\(prev\) =>\s*magnifierPlacement\(\{\s*pointer: point,\s*stage: stageSize,\s*previous: prev,\s*\}\),?\s*\)/,
    );
    // The magnifier is drawn from that remembered placement.
    expect(adjust).toMatch(/magnifierLayout\([\s\S]*?previous: magnifierAt/);
  });

  it("a double tap on the photo switches between the whole photo and the frame (AC3)", () => {
    expect(stageDown).toMatch(
      /if \(isDoubleTap\(lastTapRef\.current, tap\)\) \{[\s\S]*?setView\(\s*showingWhole\s*\? \{ kind: "sheet", quad: state\.corners \}\s*: \{ kind: "whole" \},?\s*\);\s*return;\s*\}/,
    );
    // The first tap is remembered for the second; it still drags the chosen
    // corner (with no handle named: it confirms no guess, review of F10).
    expect(stageDown).toMatch(
      /lastTapRef\.current = tap;\s*beginDrag\(null, e, point\);/,
    );
    // A press on a handle names its corner.
    expect(handleDown).toContain("beginDrag(index, e, point);");
  });

  it("the view button switches between the whole photo and the frame, and says which (AC3)", () => {
    const button = between('data-testid="paper-adjust-view"', "</button>");
    expect(button).toMatch(
      /setView\(\s*showingWhole\s*\? \{ kind: "sheet", quad: state\.corners \}\s*: \{ kind: "whole" \},?\s*\)/,
    );
    expect(button).toContain(
      "{showingWhole ? copy.zoomToFrame : copy.wholePhoto}",
    );
  });

  it("two fingers pinch the view through pinchView, and a second finger undoes a corner drag", () => {
    expect(stageMove).toMatch(
      /setView\(\{\s*kind: "free",\s*fit: pinchView\(\{\s*start: pinch\.start,\s*from: pinch\.from,\s*to: \[a, b\],\s*image: state\.image,\s*stage: stageSize,\s*\}\),?\s*\}\)/,
    );
    expect(startPinch).toContain(
      'if (state.drag) dispatch({ type: "dragCancel" });',
    );
    expect(stageDown).toContain("if (startPinch(e.pointerId, point)) {");
    expect(handleDown).toContain("if (startPinch(e.pointerId, point)) {");
  });

  it("the centred-frame button dispatches centre and moves the view onto the centred sheet (AC2)", () => {
    const button = between('data-testid="paper-adjust-centre"', "</button>");
    expect(button).toContain('dispatch({ type: "centre" });');
    expect(button).toMatch(
      /setView\(\{\s*kind: "sheet",\s*quad: centredPaperFrame\(state\.image, state\.paperSize\),?\s*\}\)/,
    );
    expect(button).toContain("{copy.centreFrame}");
  });

  const GUESS: Quad4 = [
    { x: 190, y: 310 },
    { x: 815, y: 290 },
    { x: 790, y: 1160 },
    { x: 215, y: 1140 },
  ];
  const guessOverlay: PhotoOverlay = {
    ...OVERLAY,
    paperCorners: null,
    paperGuessCorners: GUESS,
  };

  it("a rescue opening on the rough guess shows the centred-frame button, the gesture hint and the whole-photo button", () => {
    const html = render({ overlay: guessOverlay });
    const copy = paperAdjustCopy("zh-TW");
    expect(html).toContain('data-testid="paper-adjust-centre"');
    expect(html).toContain(copy.centreFrame);
    expect(html).toContain(copy.gestureHint);
    expect(html).toContain('data-view="zoomed"');
    expect(html).toContain(copy.wholePhoto);
    expect(handles(html).every((h) => h.includes('data-placed="false"'))).toBe(
      true,
    );
  });

  it("no centred-frame button where it would change nothing: a centred start, or outside the rescue", () => {
    const centred = render({
      overlay: { ...OVERLAY, paperCorners: null },
    });
    expect(centred).not.toContain('data-testid="paper-adjust-centre"');
    const review = render({ entry: "review", overlay: guessOverlay });
    expect(review).not.toContain('data-testid="paper-adjust-centre"');
  });
});

describe("adjustConfirmAction (what confirming does)", () => {
  const failure: AdjustableResult = {
    kind: "gateFailure",
    errors: [{ code: "PAPER_EDGE_HIDDEN", message: "m" }],
    overlay: OVERLAY,
  };
  const measured: AdjustableResult = {
    kind: "measured",
    overlay: OVERLAY,
    submission: scanSubmissionSchema.parse({
      hand: "right",
      measurements: { handLengthMm: 186, palmLengthMm: 106, palmWidthMm: 82 },
      calibration: {
        method: "paper-edge",
        paperSize: "a4",
        edgeFitResidualMm: 0.4,
        minSideCoverage: 0.9,
        parallaxCorrected: true,
      },
      measurementModelVersion: MEASUREMENT_MODEL_VERSION,
    }),
  };

  it("a rescue on a photo still turned back, with its file, runs the pipeline again", () => {
    expect(
      adjustConfirmAction({ entry: "rescue", result: failure, hasFile: true }),
    ).toEqual({ kind: "rerun" });
  });

  it("a rescue does nothing without the file, or once the result is no longer the failure", () => {
    expect(
      adjustConfirmAction({ entry: "rescue", result: failure, hasFile: false }),
    ).toEqual({ kind: "none" });
    for (const result of [
      measured,
      { kind: "processing" } as const,
      { kind: "none" } as const,
    ])
      expect(
        adjustConfirmAction({ entry: "rescue", result, hasFile: true }),
      ).toEqual({ kind: "none" });
  });

  it("the check only records, against the detector's corners, on a measured photo", () => {
    expect(
      adjustConfirmAction({ entry: "check", result: measured, hasFile: true }),
    ).toEqual({ kind: "recordCheck", detected: RECT });
    // Never a rerun, even on a failure with its file.
    expect(
      adjustConfirmAction({ entry: "check", result: failure, hasFile: true }),
    ).toEqual({ kind: "none" });
    expect(
      adjustConfirmAction({
        entry: "check",
        result: {
          ...measured,
          overlay: { ...OVERLAY, paperCorners: null },
        } as AdjustableResult,
        hasFile: true,
      }),
    ).toEqual({ kind: "none" });
  });

  it("no entry open: nothing", () => {
    expect(
      adjustConfirmAction({ entry: null, result: failure, hasFile: true }),
    ).toEqual({ kind: "none" });
  });
});

describe("scanMeasuredPaper (the scan_measured event's paper)", () => {
  it("typed length: none; a placed frame: adjusted; else detected", () => {
    expect(scanMeasuredPaper({ typedLength: true, placedFrame: true })).toBe(
      "none",
    );
    expect(scanMeasuredPaper({ typedLength: true, placedFrame: false })).toBe(
      "none",
    );
    expect(scanMeasuredPaper({ typedLength: false, placedFrame: true })).toBe(
      "adjusted",
    );
    expect(scanMeasuredPaper({ typedLength: false, placedFrame: false })).toBe(
      "detected",
    );
  });

  it("every value it gives is accepted by the contract's scan_measured schema", () => {
    for (const typedLength of [true, false])
      for (const placedFrame of [true, false]) {
        const paper = scanMeasuredPaper({ typedLength, placedFrame });
        expect(
          analyticsEventSchemas.scan_measured.safeParse({
            flow: "easy",
            attempt: 1,
            paper,
          }).success,
        ).toBe(true);
      }
    expect(
      analyticsEventSchemas.scan_measured.safeParse({
        flow: "easy",
        attempt: 1,
        paper: "adjusted",
      }).success,
    ).toBe(true);
  });
});

describe("photos never leave the browser", () => {
  for (const file of [
    "src/client/camera/PaperAdjust.tsx",
    "src/client/camera/paperAdjustState.ts",
    "src/client/paper/manualQuad.ts",
  ]) {
    it(`${file} makes no request and reads no pixel`, () => {
      const code = readFileSync(file, "utf8")
        // comments may name what the code must not do
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(
        /fetch\(|sendBeacon|XMLHttpRequest|WebSocket|EventSource|navigator\.|track\(|getImageData|toDataURL|toBlob|createImageBitmap|FileReader|canvas/i,
      );
    });
  }
});
