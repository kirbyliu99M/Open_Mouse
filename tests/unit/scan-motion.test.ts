import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  answerPageDirection,
  answerPageSwap,
  closeAsIfRemoved,
  fadeMs,
} from "../../src/client/camera/scanMotion";
import { MOTION } from "../../src/lib/motion";

/**
 * V3.2 motion pass, the scan flow (builder A, candidate / 未拍板): the timings
 * the script waits for, the question pages' swap, the focus outcome of a
 * dialog that now leaves instead of being unmounted, and source pins on the
 * CSS (only transform and opacity, tokens, reduced-motion variants).
 */

describe("fadeMs", () => {
  it("names the token of each fade, and every fade is --motion-reduced under reduced motion", () => {
    expect(fadeMs("fast", false)).toBe(MOTION.FAST_MS);
    expect(fadeMs("base", false)).toBe(MOTION.BASE_MS);
    expect(fadeMs("out", false)).toBe(MOTION.OUT_MS);
    for (const kind of ["fast", "base", "out"] as const)
      expect(fadeMs(kind, true)).toBe(MOTION.REDUCED_MS);
  });
});

describe("answerPageDirection", () => {
  it("forward from grip to thickness, back the other way, none otherwise", () => {
    expect(answerPageDirection("grip", "thickness")).toBe(1);
    expect(answerPageDirection("thickness", "grip")).toBe(-1);
    expect(answerPageDirection("grip", "grip")).toBe(0);
    expect(answerPageDirection("sheet", "grip")).toBe(0);
    expect(answerPageDirection("grip", "sheet")).toBe(0);
    expect(answerPageDirection("thickness", "sheet")).toBe(0);
  });
});

describe("answerPageSwap", () => {
  it("forward: the old page leaves to the left, the new one comes from the right", () => {
    expect(answerPageSwap(1, false)).toEqual({
      outMs: MOTION.OUT_MS,
      inMs: MOTION.BASE_MS,
      outToPx: -MOTION.SHIFT_PX,
      inFromPx: MOTION.SHIFT_PX,
    });
  });
  it("back: the other way round", () => {
    expect(answerPageSwap(-1, false)).toEqual({
      outMs: MOTION.OUT_MS,
      inMs: MOTION.BASE_MS,
      outToPx: MOTION.SHIFT_PX,
      inFromPx: -MOTION.SHIFT_PX,
    });
  });
  it("reduced motion: a 120 ms fade each way and nothing moves", () => {
    for (const dir of [1, -1] as const)
      expect(answerPageSwap(dir, true)).toEqual({
        outMs: MOTION.REDUCED_MS,
        inMs: MOTION.REDUCED_MS,
        outToPx: 0,
        inFromPx: 0,
      });
  });
});

/** A fake document and dialog: `close()` moves focus to `restoreTo`, as a modal's does. */
function scene(opts: { focusInside: boolean; restoreTo: "earlier" | null }) {
  const body = { name: "body", focus: vi.fn(), blur: vi.fn() };
  const doc = { activeElement: body as unknown, body };
  const make = (name: string) => {
    const el = {
      name,
      isConnected: true,
      focus: vi.fn(() => {
        doc.activeElement = el;
      }),
      blur: vi.fn(() => {
        doc.activeElement = body;
      }),
    };
    return el;
  };
  const insideButton = make("inside");
  const outsideButton = make("outside");
  const earlier = make("earlier");
  doc.activeElement = opts.focusInside ? insideButton : outsideButton;
  const dialog = {
    open: true,
    contains: (node: unknown) => node === insideButton,
    close: vi.fn(() => {
      dialog.open = false;
      if (opts.restoreTo === "earlier") doc.activeElement = earlier;
    }),
  };
  return { doc, dialog, body, insideButton, outsideButton, earlier };
}

describe("closeAsIfRemoved", () => {
  it("does nothing to a dialog that is not open (or none)", () => {
    const s = scene({ focusInside: true, restoreTo: "earlier" });
    s.dialog.open = false;
    closeAsIfRemoved(s.dialog, s.doc);
    expect(s.dialog.close).not.toHaveBeenCalled();
    closeAsIfRemoved(null, s.doc);
  });

  it("focus inside the dialog ends on <body>, as an unmount left it, even where close() would restore it", () => {
    for (const restoreTo of ["earlier", null] as const) {
      const s = scene({ focusInside: true, restoreTo });
      closeAsIfRemoved(s.dialog, s.doc);
      expect(s.dialog.close).toHaveBeenCalledOnce();
      expect(s.doc.activeElement).toBe(s.body);
    }
  });

  it("focus the next screen already took stays there, even where close() pulls it back", () => {
    const s = scene({ focusInside: false, restoreTo: "earlier" });
    closeAsIfRemoved(s.dialog, s.doc);
    expect(s.doc.activeElement).toBe(s.outsideButton);
    expect(s.outsideButton.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("focus elsewhere that close() leaves alone is not touched", () => {
    const s = scene({ focusInside: false, restoreTo: null });
    closeAsIfRemoved(s.dialog, s.doc);
    expect(s.doc.activeElement).toBe(s.outsideButton);
    expect(s.outsideButton.focus).not.toHaveBeenCalled();
    expect(s.outsideButton.blur).not.toHaveBeenCalled();
  });

  it("focus on <body> stays on <body> when close() would restore it", () => {
    const s = scene({ focusInside: false, restoreTo: "earlier" });
    s.doc.activeElement = s.body;
    closeAsIfRemoved(s.dialog, s.doc);
    expect(s.doc.activeElement).toBe(s.body);
  });
});

// ── Source pins on the CSS ────────────────────────────────────────────────

const source = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const easyCss = source("src/client/camera/easy-scan.css");
const answerCss = source("src/client/scan/answer-pages.css");
const cameraCss = source("src/client/camera/camera.css");

/** The body of `@keyframes name { ... }` (one level of nested braces). */
function keyframes(css: string, name: string): string {
  const start = css.indexOf(`@keyframes ${name} {`);
  expect(start, `@keyframes ${name}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`unterminated @keyframes ${name}`);
}
/** The property names declared in a block of CSS. */
function properties(block: string): string[] {
  return [...block.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]!);
}

/** The motion pass's section of easy-scan.css (to the end of the file). */
const easySection = easyCss.slice(
  easyCss.indexOf("/* ── V3.2 motion pass: leaving the way it came"),
);
/** Everything in it outside the reduced-motion block. */
const easyNormal = easySection.slice(
  0,
  easySection.indexOf("@media (prefers-reduced-motion: reduce)"),
);
/** The reduced-motion block of that section. */
const easyReduced = easySection.slice(
  easySection.indexOf("@media (prefers-reduced-motion: reduce)"),
  easySection.indexOf("@media (prefers-reduced-transparency: reduce)"),
);

describe("the scan flow's motion CSS (source pins)", () => {
  it("the section exists and its keyframes move only transform and opacity", () => {
    expect(easySection.length).toBeGreaterThan(100);
    const names = [
      "easyFadeOut",
      "easySheetSlideOut",
      "easyRiseIn",
      "easySinkOut",
      "easyDropIn",
      "easyLiftOut",
    ];
    for (const name of names)
      for (const property of properties(keyframes(easyCss, name)))
        expect(["transform", "opacity"], `${name}: ${property}`).toContain(
          property,
        );
    for (const name of ["answerFadeIn", "answerFadeOut"])
      for (const property of properties(keyframes(answerCss, name)))
        expect(["opacity"], `${name}: ${property}`).toContain(property);
  });

  it("uses the tokens only: no millisecond or second literals in the section", () => {
    expect(easySection).not.toMatch(/\d+(\.\d+)?m?s\b/);
  });

  it("every leaving piece is listed, with the token of its item", () => {
    const rule = (selector: string) => {
      const at = easyNormal.indexOf(`${selector} {`);
      expect(at, selector).toBeGreaterThanOrEqual(0);
      return easyNormal.slice(at, easyNormal.indexOf("}", at));
    };
    const expected: [string, string][] = [
      [
        '.easySheet[data-leaving="true"]',
        "easySheetSlideOut var(--motion-sheet-out) var(--ease-in)",
      ],
      [".easyTipScrim", "easyFadeOut var(--motion-sheet-out) var(--ease-in)"],
      [".easyPhotoLeaving", "easyFadeOut var(--motion-base) var(--ease-in)"],
      [
        '.easyScanShell .cameraCueWrap[data-leaving="true"]',
        "easyLiftOut var(--motion-fast) var(--ease-in)",
      ],
      [
        '.easyBottomDock[data-leaving="true"]',
        "easySinkOut var(--motion-fast) var(--ease-in)",
      ],
      [
        '.easyLengthStep[data-leaving="true"]',
        "easyFadeOut var(--motion-base) var(--ease-in)",
      ],
      [
        '.easyDetectorProgress[data-leaving="true"]',
        "easyFadeOut var(--motion-out) var(--ease-in)",
      ],
      [
        '.easyProcessingPill[data-leaving="true"]',
        "easyFadeOut var(--motion-fast) var(--ease-in)",
      ],
      [
        '.paperAdjust[data-leaving="true"]',
        "easyFadeOut var(--motion-out) var(--ease-in)",
      ],
      [".easyBottomDock", "easyRiseIn var(--motion-base) var(--ease-out)"],
      [
        ".easyScanShell .cameraCueWrap",
        "easyDropIn var(--motion-base) var(--ease-out)",
      ],
      [".easyLengthStep", "easyFadeIn var(--motion-base) var(--ease-out)"],
      [".easyProcessingPill", "easyFadeIn var(--motion-fast) var(--ease-out)"],
      [".easyManualDock", "easyFadeIn var(--motion-base) var(--ease-out)"],
    ];
    for (const [selector, animation] of expected)
      expect(rule(selector), selector).toContain(`animation: ${animation}`);
  });

  it("a closed dialog that is leaving is still painted, and nothing leaving takes the pointer", () => {
    for (const selector of [
      '.easySheet[data-leaving="true"] {\n  display: block;',
      '.paperAdjust[data-leaving="true"] {\n  display: flex;',
    ])
      expect(easyNormal).toContain(selector);
    expect(answerCss).toContain(
      '.answerDialog[data-leaving="true"] {\n  display: block;\n  pointer-events: none;',
    );
    for (const selector of [
      '.easySheet[data-leaving="true"]',
      ".easyTipScrim",
      ".easyPhotoLeaving",
      '.easyBottomDock[data-leaving="true"]',
      '.easyLengthStep[data-leaving="true"]',
      '.easyDetectorProgress[data-leaving="true"]',
      '.paperAdjust[data-leaving="true"]',
    ]) {
      const at = easyNormal.indexOf(`${selector} {`);
      const block = easyNormal.slice(at, easyNormal.indexOf("}", at));
      expect(block, selector).toContain("pointer-events: none;");
    }
  });

  it("reduced motion: every leaving piece is a --motion-reduced fade, every entrance too, nothing moves", () => {
    expect(easyReduced).toContain(
      "animation: easyFadeOut var(--motion-reduced) linear forwards;",
    );
    expect(easyReduced).toContain(
      "animation: easyFadeIn var(--motion-reduced) linear backwards;",
    );
    for (const selector of [
      '.easySheet[data-leaving="true"]',
      ".easyTipScrim",
      ".easyPhotoLeaving",
      '.easyScanShell .cameraCueWrap[data-leaving="true"]',
      '.easyBottomDock[data-leaving="true"]',
      '.easyLengthStep[data-leaving="true"]',
      '.easyDetectorProgress[data-leaving="true"]',
      '.easyProcessingPill[data-leaving="true"]',
      '.paperAdjust[data-leaving="true"]',
      ".easyScanShell .cameraCueWrap",
      ".easyBottomDock",
      ".easyLengthStep",
      ".easyScanShell .cameraResumeCard",
      ".easyScanShell .cameraErrorCard",
      ".easyScanNoCamera",
      ".easyManualDock",
      ".easyProcessingPill",
    ])
      expect(easyReduced, selector).toContain(selector);
    expect(easyReduced).not.toMatch(/translate|scale/);
    // The sheets fade under reduced motion (the tip used to just appear).
    expect(easyCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.easySheet \{\s*animation: easyFadeIn var\(--motion-reduced\) linear both;/,
    );
  });

  it("the sheets come in with the sheet token, and the resumed sheet no longer skips its rise", () => {
    expect(easyCss).toContain(
      "animation: easySheetSlideIn var(--motion-sheet-in) var(--ease-out) both;",
    );
    expect(easyCss).not.toContain("data-resumed");
    expect(easyCss).not.toContain("0.28s");
  });

  it("the question pages' dialog fades in and out with --motion-base, and the banner with --motion-fast", () => {
    expect(answerCss).toContain(
      ".answerDialog[open],\n.answerDialog[open]::backdrop {\n  animation: answerFadeIn var(--motion-base) var(--ease-out) backwards;",
    );
    expect(answerCss).toContain(
      "animation: answerFadeOut var(--motion-base) var(--ease-in) forwards;",
    );
    expect(answerCss).toMatch(
      /\.answerError \{\s*animation: answerFadeIn var\(--motion-fast\) var\(--ease-out\) backwards;/,
    );
    const reduced = answerCss.slice(
      answerCss.lastIndexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced).toContain(
      ".answerDialog[open]::backdrop,\n  .answerError {",
    );
    expect(reduced).toContain('.answerDialog[data-leaving="true"] {');
    expect(reduced).toContain("animation-duration: var(--motion-reduced);");
  });

  it("#20: the cue's colour is the one named exception, over --motion-fast, and at once under reduced motion", () => {
    expect(cameraCss).toContain(
      "transition: background-color var(--motion-fast) var(--ease-out);",
    );
    const reduced = cameraCss.slice(
      cameraCss.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced).toMatch(/\.cameraCue \{\s*transition: none;/);
  });

  it("the paper adjustment comes in with --motion-base (it was 180 ms), its backdrop with it", () => {
    expect(easyCss).toContain(
      ".paperAdjust[open],\n.paperAdjust[open]::backdrop {\n  animation: easyFadeIn var(--motion-base) var(--ease-out) backwards;",
    );
    expect(easyCss).not.toContain("easyFadeIn 180ms");
  });
});

// ── Source pins on the wiring ─────────────────────────────────────────────

describe("the wiring (source pins)", () => {
  const camera = source("src/client/camera/EasyScanCamera.tsx");

  it("each leaving piece is kept by useLeaving with the timing of its CSS", () => {
    for (const line of [
      'useLeaving(sheetNow, leaveMs("sheet", reducedMotion))',
      'fadeMs("base", reducedMotion),\n  );\n  // #21',
      'leaveMs("sheet", reducedMotion),\n  );\n  // #22',
      'leaveMs("fade", reducedMotion),\n  );\n  // #5',
    ])
      expect(camera).toContain(line);
  });

  it("the answer dialog's own close (to fade out) is not taken as a Back", () => {
    expect(camera).toContain(
      'if (e.currentTarget.dataset.leaving === "true") return;',
    );
  });

  it("a retake frees the photo's URL only after its fade", () => {
    const retake = camera.slice(
      camera.indexOf("const retake = useCallback(() => {"),
      camera.indexOf(
        'setResult({ kind: "none" });',
        camera.indexOf("const retake = useCallback(() => {"),
      ),
    );
    expect(retake).toContain("revokeAfterFade(result.previewUrl)");
    expect(retake).not.toContain("URL.revokeObjectURL");
  });
});
