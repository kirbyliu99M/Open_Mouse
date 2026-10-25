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
import { PaperAdjust, refusalText } from "../../src/client/camera/PaperAdjust";
import {
  PAPER_ADJUST_LAYOUT,
  adjustConfirmAction,
  adjustReadiness,
  adjustReducer,
  cornerPositions,
  fitPhoto,
  scanMeasuredPaper,
  sheetView,
  startAdjust,
  toScreen,
  wholeView,
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
    entry?: "rescue" | "review";
    state?: AdjustState;
    leave?: "cancel" | "retake";
    stage?: { width: number; height: number };
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
      leave: extra.leave,
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
    // V3.2 F17 (Adobe-style): the screen opens on the WHOLE photo, the frame
    // on the sheet; it never opens zoomed onto the frame (sheetView, F10).
    const fit = wholeView(IMAGE, { width: 390, height: 600 });
    expect(fit.scale).toBeLessThan(
      sheetView(IMAGE, { width: 390, height: 600 }, RECT).scale,
    );
    expect(fit.scale).toBeLessThanOrEqual(
      fitPhoto(IMAGE, { width: 390, height: 600 }, 24).scale,
    );
    expect(html).toContain('data-view="whole"');
    const p = toScreen(RECT[2], fit);
    const half = PAPER_ADJUST_LAYOUT.handleTargetPx / 2;
    expect(all[2]).toContain(
      `transform:translate(${p.x - half}px, ${p.y - half}px)`,
    );
  });

  const PARTIAL: PhotoOverlay = {
    ...OVERLAY,
    paperCorners: undefined,
    paperPartialCorners: [RECT[0], null, RECT[2], RECT[3]],
  };

  it("three corners found: the three open placed, the guessed fourth says in its name that it is not, and confirming is refused until it moved (F14)", () => {
    const html = render({ overlay: PARTIAL });
    const all = handles(html);
    expect(all.map((h) => h.includes('data-placed="true"'))).toEqual([
      true,
      false,
      true,
      true,
    ]);
    expect(all[1]).toContain('aria-label="右上角，還沒對齊"');
    expect(all[0]).not.toContain("還沒對齊");
    expect(all[2]).not.toContain("還沒對齊");
    expect(all[3]).not.toContain("還沒對齊");
    expect(html).toMatch(
      /<button[^>]*class="primaryButton paperAdjustConfirm"[^>]*aria-disabled="true"/,
    );
    expect(render({ overlay: PARTIAL, locale: "en" })).toContain(
      'aria-label="Top-right corner, not placed yet"',
    );
  });

  it("three corners found, the fourth dragged: all four placed and the frame may be confirmed", () => {
    const start = startAdjust({
      entry: "rescue",
      overlay: PARTIAL,
      paperSize: "a4",
    });
    const moved = adjustReducer(
      adjustReducer(start, {
        type: "pointerDown",
        index: 1,
        pointerId: 1,
        pointerType: "touch",
        point: { x: 0, y: 0 },
      }),
      {
        type: "pointerMove",
        pointerId: 1,
        point: { x: 8, y: 6 },
        scale: 1,
      },
    );
    const html = render({ overlay: PARTIAL, state: moved });
    expect(handles(html).every((h) => h.includes('data-placed="true"'))).toBe(
      true,
    );
    expect(html).not.toContain("還沒對齊");
    const confirm = html.match(
      /<button[^>]*data-testid="paper-adjust-confirm"[^>]*>/,
    )![0];
    expect(confirm).not.toContain("aria-disabled");
  });

  it("a refused confirm names the corner still to line up in the status line, in both languages", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: PARTIAL,
      paperSize: "a4",
    });
    const readiness = adjustReadiness(state);
    expect(readiness.ok).toBe(false);
    if (readiness.ok) return;
    const positions = cornerPositions(state.corners);
    expect(refusalText(readiness, positions, paperAdjustCopy("zh-TW"))).toBe(
      "右上角還沒對齊，請拖到紙角。",
    );
    expect(refusalText(readiness, positions, paperAdjustCopy("en"))).toBe(
      "Move the top-right corner to the paper's corner.",
    );
    // A frame that cannot be used for another reason keeps its own words.
    expect(
      refusalText(
        { ok: false, problem: "too_small" },
        positions,
        paperAdjustCopy("zh-TW"),
      ),
    ).toBe(paperAdjustCopy("zh-TW").quadProblem.too_small);
  });

  it("the centred sheet: its corners still say in their names that they are not placed (no visible mark), and confirming is refused until they are", () => {
    const html = render({ overlay: { ...OVERLAY, paperCorners: undefined } });
    const all = handles(html);
    expect(all.every((h) => h.includes('data-placed="false"'))).toBe(true);
    expect(all[0]).toContain('aria-label="左上角，還沒對齊"');
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
  const dragging = (entry: "rescue" | "review" = "rescue") =>
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
    // Four times the photo as it is shown now (the whole photo, F17).
    const fit = wholeView(IMAGE, { width: 390, height: 600 });
    expect(m).toContain(
      `background-size:${fit.width * PAPER_ADJUST_LAYOUT.magnifierZoom}px`,
    );
    // Above the finger (the press was at y 400).
    expect(m).toContain('data-side="above"');
  });

  it("no switch on any entry (F15 removed the corner check's): the magnifier is always on", () => {
    for (const entry of ["rescue", "review"] as const) {
      expect(render({ entry })).not.toContain("paper-adjust-magnifier-toggle");
      expect(render({ entry, state: dragging(entry) })).toContain(
        "paperAdjustMagnifier",
      );
    }
    const adjust = readFileSync("src/client/camera/PaperAdjust.tsx", "utf8");
    expect(adjust).not.toMatch(/magnifierOn|initialMagnifier/);
  });
});

describe("only what is needed (F14, Kirby's phone test of preview 5, 2026-10-22: no need for multiple indicators)", () => {
  const GUESS: Quad4 = [
    { x: 190, y: 310 },
    { x: 815, y: 290 },
    { x: 760, y: 1160 },
    { x: 215, y: 1140 },
  ];
  const variants = () => [
    render(),
    render({ entry: "review" }),
    render({ overlay: { ...OVERLAY, paperCorners: null } }),
    render({
      overlay: { ...OVERLAY, paperCorners: null, paperGuessCorners: GUESS },
    }),
    render({ locale: "en" }),
  ];

  it("no instruction or gesture lines, no hidden-corner tool, no reset, no warning box", () => {
    for (const html of variants()) {
      expect(html).not.toContain("paperAdjustHint");
      expect(html).not.toContain("paperAdjustWarning");
      expect(html).not.toContain("paper-adjust-edge-mode");
      expect(html).not.toContain("data-marking");
      expect(html).not.toContain("data-hidden-corner");
      // Under the heading: nothing but the heading.
      expect(html).toMatch(
        /<header class="paperAdjustHeader"><h2[^>]*>[^<]*<\/h2><\/header>/,
      );
      // The status line is empty while the frame can be used.
      expect(html).toMatch(/data-testid="paper-adjust-status"><\/p>/);
    }
  });

  it("F17: keeps the photo, the frame, four handles, confirm and cancel only: no whole / zoomed toggle and no centred-frame button, on any entry", () => {
    for (const html of variants()) {
      expect(html).toContain('class="paperAdjustPhoto"');
      expect(html).toContain("<polygon");
      expect(handles(html)).toHaveLength(4);
      expect(html).toContain('data-testid="paper-adjust-confirm"');
      expect(html).toContain('data-testid="paper-adjust-cancel"');
      expect(html).not.toContain('data-testid="paper-adjust-view"');
      expect(html).not.toContain('data-testid="paper-adjust-centre"');
      expect(html).not.toContain("paperAdjustTools");
      expect(html).toContain('data-view="whole"');
      expect(html.match(/<button/g)).toHaveLength(6);
    }
  });

  it("the way out says 重拍 / Retake when the screen opened by itself, else 取消 / Cancel", () => {
    const cancel = (html: string) =>
      html.match(/data-testid="paper-adjust-cancel">([^<]*)</)?.[1];
    expect(cancel(render())).toBe("取消");
    expect(cancel(render({ leave: "retake" }))).toBe("重拍");
    expect(cancel(render({ leave: "retake", locale: "en" }))).toBe("Retake");
    expect(cancel(render({ locale: "en" }))).toBe("Cancel");
  });

  it("every handle looks the same: the per-corner marks are gone from the styles", () => {
    const css = readFileSync("src/client/camera/easy-scan.css", "utf8");
    expect(css).not.toMatch(/paperAdjustHandle\[data-placed/);
    expect(css).not.toMatch(
      /data-hidden-corner|paperAdjustEdge|paperAdjustWarning/,
    );
  });

  it("the words the screen no longer shows are gone from the copy (both languages)", () => {
    for (const locale of ["zh-TW", "en"] as const) {
      const keys = Object.keys(paperAdjustCopy(locale));
      for (const gone of [
        "instructionDetected",
        "instructionGuess",
        "instructionRough",
        "gestureHint",
        "notConfirmed",
        "edgeModeStart",
        "edgeModeCancel",
        "edgeStep",
        "edgeSolved",
        "edgeProblem",
        "edgeUndone",
        "chooseCornerFirst",
        "placeNeighboursFirst",
        "reset",
        "curledWarning",
        // F15: 檢查邊框, Kirby's corner check and the sheet's "adjusted by
        // hand" line are gone (the results page says that one).
        "review",
        "check",
        "measuredNote",
        // F17: the whole / zoomed toggle and 改用置中框 are gone.
        "wholePhoto",
        "zoomToFrame",
        "centreFrame",
      ])
        expect(keys).not.toContain(gone);
    }
  });
});

describe("words", () => {
  it("the English screen has the same parts", () => {
    const html = render({ locale: "en" });
    expect(html).toContain("Adjust the paper&#x27;s frame");
    expect(html).toContain("Measure with this frame");
    expect(handles(html)[0]).toContain('aria-label="Top-left corner"');
  });

  it("F15: the screen that opens by itself on a measured photo has the same heading and confirm button as the rescue, on the detector's corners, all placed and ready", () => {
    for (const locale of ["zh-TW", "en"] as const) {
      const copy = paperAdjustCopy(locale);
      const html = render({ entry: "review", locale, leave: "retake" });
      expect(html).toContain('data-entry="review"');
      expect(html).toContain(copy.title.replace(/'/g, "&#x27;"));
      expect(html).toContain(copy.confirm);
      expect(html).toContain(
        `data-testid="paper-adjust-cancel">${copy.retake}<`,
      );
      // Every corner is the detector's: placed, and confirm is usable at once.
      expect(handles(html).every((h) => h.includes('data-placed="true"'))).toBe(
        true,
      );
      const confirm = html.match(
        /<button[^>]*data-testid="paper-adjust-confirm"[^>]*>/,
      )![0];
      expect(confirm).not.toContain("aria-disabled");
    }
  });

  it("a curled sheet adds no line here (F14): the results page says it (F13), and the confirm button stays usable", () => {
    for (const locale of ["zh-TW", "en"] as const) {
      const html = render({ locale });
      expect(html).not.toContain("paper-adjust-warning");
      const confirm = html.match(
        /<button[^>]*data-testid="paper-adjust-confirm"[^>]*>/,
      )![0];
      expect(confirm).not.toContain("aria-disabled");
    }
  });

  it("F15: the corner check's and 檢查邊框's words are nowhere on the screen", () => {
    for (const entry of ["rescue", "review"] as const) {
      const html = render({ entry });
      expect(html).not.toContain("拖角精度測試");
      expect(html).not.toContain("記錄這次");
      expect(html).not.toContain("檢查邊框");
    }
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
    expect(rule(".paperAdjustCancel")).toContain("min-height: 44px");
    // F17: the small tool buttons are gone, and so are their styles.
    expect(section).not.toContain(".paperAdjustTool");
  });

  it("the stage takes the pointer itself (no page scroll or zoom while dragging)", () => {
    expect(rule(".paperAdjustStage")).toContain("touch-action: none");
  });

  it("reduced motion removes the only transition; the one animation is the screen's fade-in (F15), with the motion tokens and a --motion-reduced fade under reduced motion (V3.2 motion pass #22)", () => {
    const reduced = section.slice(
      section.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced).toMatch(/\.paperAdjustDot \{\s*transition: none;/);
    const own = section.slice(0, section.indexOf(".easyAdjustFrameButton"));
    expect(own).not.toMatch(/@keyframes/);
    expect(own.match(/animation:/g)).toHaveLength(1);
    expect(own).toMatch(
      /\.paperAdjust\[open\],\s*\.paperAdjust\[open\]::backdrop \{\s*animation: easyFadeIn var\(--motion-base\) var\(--ease-out\) backwards;\s*\}/,
    );
    expect(own).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.paperAdjust\[open\],\s*\.paperAdjust\[open\]::backdrop \{\s*animation-duration: var\(--motion-reduced\);/,
    );
  });

  it("uses the dark theme's tokens: no new colour", () => {
    const end = section.indexOf(".easyAdjustFrameButton");
    const own = section.slice(0, end);
    expect(own).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(own).toContain("var(--bg)");
    expect(own).toContain("var(--accent-text)");
  });
});

describe("where the camera offers it (EasyScanCamera.tsx)", () => {
  const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");

  it("decides with adjustEntryFor, from the result on screen alone (F15: ?debug=1 no longer changes it)", () => {
    expect(source).toContain("const adjustEntry = adjustEntryFor(result);");
    expect(source).not.toMatch(/adjustEntryFor\([^)]*debugOn/);
  });

  it("F15: the one button left is the failure sheet's rescue; 檢查邊框 and the corner check are gone", () => {
    const count = (needle: string) => source.split(needle).length - 1;
    // V3.2 motion pass #1: decided on the result the sheet shows.
    expect(count('{adjustEntryFor(sheetResult) === "rescue" && (')).toBe(1);
    expect(count('{adjustEntry === "review"')).toBe(0);
    expect(count('"check"')).toBe(0);
    expect(count('data-testid="adjust-frame-entry"')).toBe(1);
    expect(count("frame-review-entry")).toBe(0);
    expect(count("corner-check-entry")).toBe(0);
    expect(source).not.toMatch(
      /cornerCheckNote|\.review\.|\.check\.|measuredNote/,
    );
    // The button opens only the rescue.
    const open = source.slice(
      source.indexOf("const openAdjust = useCallback("),
      source.indexOf("const cancelAdjust = useCallback("),
    );
    expect(open).toContain(
      'if (adjustEntry !== "rescue" || manualActiveRef.current) return;',
    );
  });

  it("F15: a measured photo opens the adjustment by itself (adjustOpensDirectly), as review, with no sheet under it, right where the result is set", () => {
    const run = source.slice(
      source.indexOf("const runPipeline = useCallback("),
      source.indexOf("const confirmAdjust = useCallback("),
    );
    expect(run).toMatch(
      /setResult\(measured\);\s*(?:\/\/[^\n]*\n\s*)*if \(adjustOpensDirectly\(measured\)\) \{\s*setAdjustDirect\(true\);\s*setAdjustOpen\("review"\);\s*\}/,
    );
    // F14's paper failures still open the rescue the same way.
    expect(run).toMatch(
      /if \(adjustOpensDirectly\(failure\)\) \{\s*setAdjustDirect\(true\);\s*setAdjustOpen\("rescue"\);\s*\}/,
    );
    // Its way out goes back to the camera, as F14's.
    const cancel = source.slice(
      source.indexOf("const cancelAdjust = useCallback("),
      source.indexOf("const confirmAdjust = useCallback("),
    );
    expect(cancel).toContain("if (adjustDirect) retake();");
  });

  it("F15: a retake is never a return: the next photo's sheet slides in with focus on its heading, even after 重拍 on the adjustment that opened by itself", () => {
    const retake = source.slice(
      source.indexOf("const retake = useCallback("),
      source.indexOf("const adjustEntry = adjustEntryFor(result);"),
    );
    expect(retake).toContain("sheetResumedRef.current = false;");
    expect(retake).toContain("adjustReturnRef.current = false;");
    // The only other places that set them: the sheet's own layout effect
    // (closed under a question page or the adjustment) and confirmAdjust.
    const count = (needle: string) => source.split(needle).length - 1;
    expect(count("sheetResumedRef.current = true;")).toBe(1);
    expect(count("adjustReturnRef.current = true;")).toBe(1);
  });

  it("F15: confirming tells the camera whether any corner moved, from frameMoved on the screen's own state (PaperAdjust.tsx)", () => {
    const adjust = readFileSync("src/client/camera/PaperAdjust.tsx", "utf8");
    const confirm = adjust.slice(
      adjust.indexOf("const confirm = () => {"),
      adjust.indexOf("};", adjust.indexOf("onConfirm({")),
    );
    expect(confirm).toMatch(
      /onConfirm\(\{\s*corners: readiness\.corners,\s*source: readiness\.source,\s*moved: frameMoved\(state\),\s*\}\)/,
    );
  });

  it("F15: no length is drawn on the photo while the adjustment is open", () => {
    expect(source).toMatch(
      /const dimensions: readonly DimensionSpec\[\] \| null =\s*result\.kind === "measured" && result\.overlay\.landmarksPx && !adjustOpen/,
    );
  });

  it("F15: the measured sheet has only its title, numbers, retake, continue (and Debug with ?debug=1)", () => {
    const sheet = source.slice(
      source.indexOf('{sheetResult.kind === "measured" ? ('),
      source.indexOf('className="easySheetTitle easySheetTitleError"'),
    );
    expect(sheet.length).toBeGreaterThan(0);
    expect(sheet).toContain("{common.handMeasured}");
    expect(sheet).toContain('data-testid="easy-sheet-numbers"');
    expect(sheet).toContain("aria-label={common.retakePhoto}");
    expect(sheet).toContain('data-testid="answers-continue-button"');
    expect(sheet).not.toContain("unverifiedNote");
    expect(sheet).not.toContain("easy-sheet-adjusted-note");
    expect(sheet).not.toContain("easySheetNote");
    expect(sheet.split("<button").length - 1).toBe(2);
    // The typed-length disclosure is untouched.
    expect(sheet).toContain("easy.disclosureBased(");
    expect(source).toContain("{debugOn && debugSnapshot && (");
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
    // F14: no warning on the screen any more; the way out says 重拍 when it
    // opened by itself.
    expect(source).not.toContain("warning={");
    // V3.2 motion pass #22: kept with its props while it fades out.
    expect(source).toContain(
      'leave: adjustDirect ? ("retake" as const) : ("cancel" as const),',
    );
    expect(source).toContain("leave={adjustLeave.shown.leave}");
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
    // F15: every confirm writes the corner record to the local attempt log
    // (confirmCornerCheck decides), before and whatever the action is.
    expect(confirm).toContain("const check = confirmCornerCheck({");
    expect(confirm).toMatch(
      /if \(check\)\s*void logAttempt\(captureInfoRef\.current, \{\s*kind: "cornerCheck",\s*magnifier: check\.magnifier,\s*distancesPx: check\.distancesPx,\s*imageLongEdgePx: check\.imageLongEdgePx,\s*\}\);/,
    );
    expect(confirm.indexOf("confirmCornerCheck({")).toBeLessThan(
      confirm.indexOf("adjustConfirmAction({"),
    );
    expect(confirm.split("logAttempt(").length - 1).toBe(1);
    // The sheet that follows a screen that opened by itself slides in as a
    // new result (not a return), with focus on its heading.
    expect(confirm).toMatch(
      /if \(direct\) \{\s*sheetResumedRef\.current = false;\s*adjustReturnRef\.current = false;\s*\}/,
    );
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

  it("a measurement's paper and the pipeline's frame come from one pipelinePaperInput (F15: the sheet no longer says the frame was adjusted; the results page does)", () => {
    expect(source).not.toContain("measuredNote");
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

  it("a pointer move goes through pointerMoveFor with the fit (F17: the newest move, once per animation frame)", () => {
    expect(adjust).toMatch(
      /dispatch\(pointerMoveFor\(\{ \.\.\.move, fit \}\)\)/,
    );
    expect(adjust).toMatch(
      /pendingMoveRef\.current = \{ pointerId: e\.pointerId, point \};/,
    );
    expect(adjust).toContain("requestAnimationFrame(");
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

  const applyMove = between("const applyMove = (", "const dropPendingMove = (");
  const stageUp = between("const onStageUp = (", "const onStageWheel = (");

  it("the magnifier keeps its side through a drag: each move passes the last placement as previous (AC4, hysteresis)", () => {
    expect(applyMove).toMatch(
      /setMagnifierAt\(\(prev\) =>\s*magnifierPlacement\(\{\s*pointer: move\.point,\s*stage: stageSize,\s*previous: prev,\s*\}\),?\s*\)/,
    );
    // The magnifier is drawn from that remembered placement, only while a
    // corner is dragged.
    expect(adjust).toMatch(/magnifierLayout\([\s\S]*?previous: magnifierAt/);
    expect(adjust).toMatch(/const magnifier =\s*drag && stageSize/);
  });

  it("F17: a release first applies the move still waiting for a frame, so the corner ends where the finger left it", () => {
    expect(stageUp).toMatch(
      /if \(pendingMoveRef\.current\?\.pointerId === e\.pointerId\) flushPendingMove\(\);[\s\S]*dispatch\(\{ type: "pointerUp", pointerId: e\.pointerId \}\);/,
    );
    expect(startPinch).toContain("dropPendingMove();");
    expect(adjust).toContain("cancelAnimationFrame(frameRef.current)");
  });

  it("F17: no double tap and no zoom onto the frame: the view opens whole and changes only by two fingers or the wheel", () => {
    expect(adjust).not.toMatch(
      /isDoubleTap\(|lastTapRef|sheetView\(|kind: "sheet"/,
    );
    expect(adjust).toContain('useState<ViewChoice>({ kind: "whole" })');
    const setViews = adjust.match(/setView\(/g) ?? [];
    // pinchView and the wheel's zoomViewAt, nothing else.
    expect(setViews).toHaveLength(2);
    expect(stageDown).toContain("beginDrag(null, e, point);");
    // A press on a handle names its corner.
    expect(handleDown).toContain("beginDrag(index, e, point);");
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

  it("F17: a rescue opening on the rough guess shows the whole photo with the frame on the guess, every corner placed", () => {
    const html = render({ overlay: guessOverlay });
    expect(html).toContain('data-view="whole"');
    expect(html).not.toContain('data-testid="paper-adjust-centre"');
    expect(handles(html).every((h) => h.includes('data-placed="true"'))).toBe(
      true,
    );
    const fit = wholeView(IMAGE, { width: 390, height: 600 });
    const p = toScreen(GUESS[0], fit);
    const half = PAPER_ADJUST_LAYOUT.handleTargetPx / 2;
    expect(handles(html)[0]).toContain(
      `transform:translate(${p.x - half}px, ${p.y - half}px)`,
    );
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

  it("F15: review confirmed as it opened is none (the sheet shows the result already made); moved, with its file, is a rerun", () => {
    expect(
      adjustConfirmAction({
        entry: "review",
        result: measured,
        hasFile: true,
        moved: false,
      }),
    ).toEqual({ kind: "none" });
    // `moved` left out is not a move.
    expect(
      adjustConfirmAction({ entry: "review", result: measured, hasFile: true }),
    ).toEqual({ kind: "none" });
    expect(
      adjustConfirmAction({
        entry: "review",
        result: measured,
        hasFile: true,
        moved: true,
      }),
    ).toEqual({ kind: "rerun" });
    // Never a rerun of a failure from review.
    expect(
      adjustConfirmAction({
        entry: "review",
        result: failure,
        hasFile: true,
        moved: true,
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
