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
  adjustReducer,
  fitPhoto,
  startAdjust,
  toScreen,
  type AdjustState,
} from "../../src/client/camera/paperAdjustState";
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
    entry?: "rescue" | "check";
    state?: AdjustState;
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
    const fit = fitPhoto(IMAGE, { width: 390, height: 600 }, 24);
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
    const fit = fitPhoto(IMAGE, { width: 390, height: 600 }, 24);
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

  it("the rescue button is in the failure sheet only, under 再拍一次; the check in the measured sheet only", () => {
    const failure = source.slice(
      source.indexOf('className="primaryButton easyTryAgainButton"'),
    );
    const rescue = source.indexOf('adjustEntry === "rescue"');
    const check = source.indexOf('adjustEntry === "check"');
    const measured = source.indexOf('{result.kind === "measured" ? (');
    const failureSheet = source.indexOf(
      'className="easySheetTitle easySheetTitleError"',
    );
    expect(rescue).toBeGreaterThan(failureSheet);
    expect(failure.indexOf('adjustEntry === "rescue"')).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(measured);
    expect(check).toBeLessThan(failureSheet);
  });

  it("confirming a rescue runs the same pipeline on the same file with the frame, and sends nothing itself", () => {
    const confirm = source.slice(
      source.indexOf("const confirmAdjust = useCallback("),
      source.indexOf("const changePaperSize = useCallback("),
    );
    expect(confirm).toContain(
      "void runPipeline(fileRef.current, current.previewUrl, {",
    );
    expect(confirm).toContain("source: placed.source,");
    expect(confirm).not.toMatch(/fetch\(|sendBeacon|XMLHttpRequest|track\(/);
    // The check only writes the local attempt log.
    expect(confirm).toContain('kind: "cornerCheck"');
  });

  it("a measurement from a placed frame says so on the sheet, and goes to analytics as paper: adjusted", () => {
    expect(source).toContain("paperAdjustCopy(locale).measuredNote");
    expect(source).toMatch(/manualPaperCorners\s*\?\s*"adjusted"/);
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
