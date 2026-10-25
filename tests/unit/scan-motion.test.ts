import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  answerPageSwap,
  closeAsIfRemoved,
  fadeMs,
  leavingAfter,
  leavingTimedOut,
  leavingView,
  leaveShieldStyle,
  pageSwapKeyframes,
  settleSwap,
  type LeavingState,
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

describe("pageSwapKeyframes (the WAAPI keyframes of the page swap)", () => {
  it("animate only opacity and transform, both ways and under reduced motion", () => {
    for (const reduced of [false, true])
      for (const dir of [1, -1] as const) {
        const frames = pageSwapKeyframes(answerPageSwap(dir, reduced));
        for (const frame of [...frames.out, ...frames.in])
          for (const key of Object.keys(frame))
            expect(["opacity", "transform"]).toContain(key);
      }
  });
  it("the old page goes where the person is going, the new one comes from the other side and rests at 0", () => {
    const forward = pageSwapKeyframes(answerPageSwap(1, false));
    expect(forward.out).toEqual([
      { opacity: 0, transform: `translateX(${-MOTION.SHIFT_PX}px)` },
    ]);
    expect(forward.in).toEqual([
      { opacity: 0, transform: `translateX(${MOTION.SHIFT_PX}px)` },
      { opacity: 1, transform: "translateX(0)" },
    ]);
    const reduced = pageSwapKeyframes(answerPageSwap(-1, true));
    expect(reduced.out[0]!.transform).toBe("translateX(0px)");
    expect(reduced.in[0]!.transform).toBe("translateX(0px)");
  });
});

describe("settleSwap (what a page swap does once its old page has faded)", () => {
  const base = { mine: 3, latest: 3, stillValid: true, dialogLeaving: false };
  it("applies the change when nothing happened meanwhile", () => {
    expect(settleSwap(base)).toBe("apply");
  });
  it("leaves it to a later swap", () => {
    expect(settleSwap({ ...base, latest: 4 })).toBe("superseded");
    expect(
      settleSwap({
        ...base,
        latest: 4,
        stillValid: false,
        dialogLeaving: true,
      }),
    ).toBe("superseded");
  });
  it("review item 2: 返回 from the thickness page, then 送出 started a send: dropped, and the page shown again", () => {
    expect(settleSwap({ ...base, stillValid: false })).toBe("release");
  });
  it("review item 3: 確認 on the grip page, then 返回 left the dialog: dropped, and the page kept faded in the fading dialog", () => {
    expect(
      settleSwap({ ...base, stillValid: false, dialogLeaving: true }),
    ).toBe("keep");
    // Even a change that would still be valid is not made in a leaving dialog.
    expect(settleSwap({ ...base, dialogLeaving: true })).toBe("keep");
  });
});

describe("useLeaving's rules (leavingAfter, leavingTimedOut, leavingView)", () => {
  const shown: LeavingState = { wasPresent: true, leaving: false };
  const gone: LeavingState = { wasPresent: false, leaving: false };

  it("present → absent starts the leave and shows the last value, marked leaving", () => {
    const next = leavingAfter(shown, false);
    expect(next).toEqual({ wasPresent: false, leaving: true });
    expect(leavingView(null, next, "last")).toEqual({
      shown: "last",
      leaving: true,
    });
  });

  it("the time up ends the leave: nothing shown", () => {
    const after = leavingTimedOut({ wasPresent: false, leaving: true });
    expect(after).toEqual(gone);
    expect(leavingView(null, after, "last")).toEqual({
      shown: null,
      leaving: false,
    });
  });

  it("review item 1: wanted back during its leave, it is simply shown, not leaving", () => {
    const leaving = leavingAfter(shown, false);
    const back = leavingAfter(leaving, true);
    expect(back).toEqual(shown);
    expect(leavingView("new", back, "last")).toEqual({
      shown: "new",
      leaving: false,
    });
    // ...and the old leave's timer firing late changes nothing that shows.
    expect(leavingView("new", leavingTimedOut(back), "last")).toEqual({
      shown: "new",
      leaving: false,
    });
  });

  it("a second leave after coming back starts afresh (the hook's timer restarts on the new leave)", () => {
    const again = leavingAfter(
      leavingAfter(leavingAfter(shown, false), true),
      false,
    );
    expect(again).toEqual({ wasPresent: false, leaving: true });
  });

  it("no change of presence returns the same object (no re-render), and nothing was ever shown means nothing leaves", () => {
    expect(leavingAfter(shown, true)).toBe(shown);
    expect(leavingAfter(gone, false)).toBe(gone);
    expect(leavingTimedOut(gone)).toBe(gone);
    expect(
      leavingView(null, { wasPresent: false, leaving: true }, null),
    ).toEqual({
      shown: null,
      leaving: false,
    });
  });
});

describe("leaveShieldStyle (the tap-absorbing layer over a leaving piece)", () => {
  it("covers the piece's box, one z-index above it", () => {
    expect(
      leaveShieldStyle({
        left: 0,
        top: 600,
        width: 390,
        height: 244,
        zIndex: "10",
      }),
    ).toEqual({ left: 0, top: 600, width: 390, height: 244, zIndex: 11 });
  });
  it("an auto z-index counts as 0", () => {
    expect(
      leaveShieldStyle({
        left: 1,
        top: 2,
        width: 3,
        height: 4,
        zIndex: "auto",
      })!.zIndex,
    ).toBe(1);
  });
  it("a piece with no box gets no layer", () => {
    expect(
      leaveShieldStyle({ left: 0, top: 0, width: 0, height: 10, zIndex: "4" }),
    ).toBeNull();
    expect(
      leaveShieldStyle({ left: 0, top: 0, width: 10, height: 0, zIndex: "4" }),
    ).toBeNull();
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

  it("a closed dialog that is leaving is still painted, and no leaving rule lets taps through (e2e round 2: no pointer-events: none)", () => {
    for (const selector of [
      '.easySheet[data-leaving="true"] {\n  display: block;',
      '.paperAdjust[data-leaving="true"] {\n  display: flex;',
    ])
      expect(easyNormal).toContain(selector);
    expect(answerCss).toContain(
      '.answerDialog[data-leaving="true"] {\n  display: block;\n  animation:',
    );
    // Not in any rule of the motion section (leaving, scrim, shield, photo),
    // nor in the question dialog's leaving rule.
    expect(easySection).not.toContain("pointer-events: none");
    const answerLeaving = answerCss.slice(
      answerCss.indexOf('.answerDialog[data-leaving="true"] {'),
      answerCss.indexOf(
        "}",
        answerCss.indexOf('.answerDialog[data-leaving="true"] {'),
      ),
    );
    expect(answerLeaving).not.toContain("pointer-events");
    // The tap-absorbing layer: fixed, transparent, takes the pointer.
    expect(easySection).toMatch(
      /\.easyLeaveShield \{\s*position: fixed;\s*background: transparent;/,
    );
  });

  it("every piece that leaves has the tap-absorbing layer while it leaves, but for the two listed exceptions", () => {
    const camera = source("src/client/camera/EasyScanCamera.tsx");
    for (const [leave, target] of [
      ["answersLeave", "answerDialogRef"],
      ["lengthLeave", "lengthStepRef"],
      ["liveChromeLeave", "dockRef"],
      ["measuringLeave", "pillRef"],
      ["sheetLeave", "sheetDialogRef"],
    ])
      expect(camera, leave).toContain(
        `{${leave}.leaving && <LeaveShield target={${target}} />}`,
      );
    expect(source("src/client/camera/PaperAdjust.tsx")).toContain(
      "{leaving && <LeaveShield target={dialogRef} />}",
    );
    expect(source("src/client/camera/DetectorProgress.tsx")).toContain(
      "{loading.leaving && <LeaveShield target={rootRef} />}",
    );
    // The tip: its scrim is the layer (it covers the screen, as the backdrop did).
    expect(camera).toContain(
      '<div className="easyTipScrim" aria-hidden="true" />',
    );
    // Exceptions, by design: the cue never takes a tap (pointer-events: none
    // on .easyScanStaged .cameraCueWrap while shown), and the retaken photo is
    // part of the stage, whose own tap (focus the live camera coming back) is
    // the control now under the finger.
    expect(camera.split("<LeaveShield").length - 1).toBe(5);
  });

  it("reduced motion: every leaving piece is a --motion-reduced fade, every entrance too, nothing moves", () => {
    // Each rule of the block, by its exact selectors (review item 5: a
    // substring check let an entrance pass on its leaving rule's selector).
    const rules = new Map<string, string>();
    const inner = easyReduced.slice(easyReduced.indexOf("{") + 1);
    for (const m of inner.matchAll(/([^{}]+)\{([^{}]*)\}/g))
      for (const selector of m[1]!.split(","))
        rules.set(selector.trim(), m[2]!.trim());
    const leaves = [
      '.easySheet[data-leaving="true"]',
      ".easyTipScrim",
      ".easyPhotoLeaving",
      '.easyScanShell .cameraCueWrap[data-leaving="true"]',
      '.easyBottomDock[data-leaving="true"]',
      '.easyLengthStep[data-leaving="true"]',
      '.easyDetectorProgress[data-leaving="true"]',
      '.easyProcessingPill[data-leaving="true"]',
      '.paperAdjust[data-leaving="true"]',
    ];
    const entrances = [
      ".easyScanShell .cameraCueWrap",
      ".easyBottomDock",
      ".easyLengthStep",
      ".easyScanShell .cameraResumeCard",
      ".easyScanShell .cameraErrorCard",
      ".easyScanNoCamera",
      ".easyManualDock",
      ".easyProcessingPill",
    ];
    for (const selector of leaves)
      expect(rules.get(selector), selector).toBe(
        "animation: easyFadeOut var(--motion-reduced) linear forwards;",
      );
    for (const selector of entrances)
      expect(rules.get(selector), selector).toBe(
        "animation: easyFadeIn var(--motion-reduced) linear backwards;",
      );
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

  it("every leaving copy is out of the accessibility tree, not only inert (e2e round: Playwright saw two 'Edit hand length' buttons)", () => {
    const leaving = [
      "answersLeave",
      "lengthLeave",
      "liveChromeLeave",
      "measuringLeave",
      "sheetLeave",
      "tipLeave",
    ];
    for (const name of leaving) {
      const inerts = camera.split(`inert={${name}.leaving}`).length - 1;
      const hidden =
        camera.split(`aria-hidden={${name}.leaving || undefined}`).length - 1;
      expect(inerts, name).toBeGreaterThan(0);
      expect(hidden, name).toBe(inerts);
    }
    expect(source("src/client/camera/PaperAdjust.tsx")).toContain(
      "aria-hidden={leaving || undefined}",
    );
    expect(source("src/client/camera/DetectorProgress.tsx")).toContain(
      "aria-hidden={loading.leaving || undefined}",
    );
  });

  it("the pages swap inside a box that clips the slide sideways only, so the dialog never scrolls sideways (e2e round: short screens)", () => {
    expect(camera).toContain('<div className="answerSwap">');
    expect(answerCss).toMatch(
      /\.answerSwap \{\s*height: 100%;\s*overflow-x: clip;\s*\}/,
    );
  });

  it("a send first ends a page still sliding in (the F23 veil is fixed to the viewport only without a transform)", () => {
    const send = camera.slice(
      camera.indexOf("const sendScan = useCallback("),
      camera.indexOf(
        "if (manualValues) {",
        camera.indexOf("const sendScan = useCallback("),
      ),
    );
    expect(send).toContain("finishAnswerPageSwap();");
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
