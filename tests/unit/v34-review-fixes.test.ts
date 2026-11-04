/**
 * v3.4 release review fixes (2026-11-05, candidate 未拍板; review report
 * scan-lab-2026-10-29/v34-review.md, items 0-4, 5+6, 8, 9, 10, 13).
 *
 * Kirby: 「A4 & Card 是並存，make no mistake on the build」. The pure rules
 * are tested directly; how EasyScanCamera and ScanTour wire them is read from
 * the source, as the other camera wiring tests do (the repo has no DOM test
 * library, so the camera cannot be driven by taps here).
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  cardPathActive,
  referenceChangeAllowed,
} from "../../src/client/camera/cardRoute";
import {
  ReferenceMenu,
  referenceMenuKey,
} from "../../src/client/camera/ReferenceMenu";
import { uploadDebugPhoto } from "../../src/client/camera/debugPhotoUpload";
import {
  buildTourSteps,
  tourReturnFocus,
  tourScreenShown,
  tourTransition,
  type TourEffect,
  type TourEvent,
  type TourState,
} from "../../src/client/camera/tour/tourModel";
import { cardReferenceCopy } from "../../src/lib/copy/card-reference";

const read = (path: string) =>
  readFileSync(path, "utf8").split("\r\n").join("\n");
const camera = read("src/client/camera/EasyScanCamera.tsx");
const tour = read("src/client/camera/tour/ScanTour.tsx");
const css = read("src/client/camera/easy-scan.css");

const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  expect(a, from).toBeGreaterThanOrEqual(0);
  expect(b, to).toBeGreaterThan(a);
  return src.slice(a, b);
};

describe("item 0 [blocker]: 有 on the outline check opens the measured sheet", () => {
  const sheetEffect = between(
    camera,
    "// The measured / gate-failure bottom sheet: a native <dialog>",
    "// A question page is a modal of its own",
  );

  it("the sheet waits while the outline question is open", () => {
    expect(camera).toContain(
      'const cardCheckOpen =\n    result.kind === "measured" && result.cardCheck === "pending";',
    );
    expect(camera).toMatch(/onSheet &&\s*!adjustOpen &&\s*!cardCheckOpen/);
  });

  it("answering runs the sheet's layout effect again (its deps see the check), which calls showModal", () => {
    expect(sheetEffect).toContain(
      "if (dialog && !dialog.open) dialog.showModal();",
    );
    const deps = sheetEffect.match(/\}, \[([^\]]*)\]\);\s*$/);
    expect(deps?.[1].split(",").map((d) => d.trim())).toEqual([
      "result.kind",
      "onSheet",
      "adjustOpen",
      "cardCheckOpen",
    ]);
  });

  it("有 clears the check, 沒有 goes back to the camera (a retake)", () => {
    const yes = between(camera, 'data-testid="card-check-yes"', "</button>");
    expect(yes).toContain("? { ...prev, cardCheck: undefined }");
    const no = between(camera, 'data-testid="card-check-no"', "</button>");
    expect(no).toContain("onClick={retake}");
  });
});

describe("item 1 [major]: a typed hand length never takes the card path", () => {
  it("cardPathActive: only the card, with no typed length and no placed frame", () => {
    expect(cardPathActive({ cardMode: true, typedLengthMm: null })).toBe(true);
    expect(cardPathActive({ cardMode: false, typedLengthMm: null })).toBe(
      false,
    );
    expect(cardPathActive({ cardMode: true, typedLengthMm: 181 })).toBe(false);
    expect(
      cardPathActive({
        cardMode: true,
        typedLengthMm: null,
        manualPaperCorners: { corners: [] },
      }),
    ).toBe(false);
    expect(
      cardPathActive({
        cardMode: true,
        typedLengthMm: null,
        manualPaperCorners: undefined,
      }),
    ).toBe(true);
  });

  it("the photo, the live loop and the shutter all ask it", () => {
    const runPipeline = between(
      camera,
      "const runPipeline = useCallback(",
      "const runId = ++runIdRef.current;",
    );
    expect(runPipeline).toMatch(
      /cardPathActive\(\{\s*cardMode: cardModeRef\.current,\s*typedLengthMm: userLengthRef\.current,\s*manualPaperCorners,\s*\}\)/,
    );
    expect(camera).not.toContain(
      "if (cardModeRef.current && !manualPaperCorners)",
    );
    expect(camera).not.toMatch(/if \(cardModeRef\.current\) \{\s*cardSample/);
    expect(camera).toMatch(
      /cardPathActive\(\{\s*cardMode: cardModeRef\.current,\s*typedLengthMm: userLengthRef\.current,\s*\}\)\s*\)\s*\{\s*cardSample\(/,
    );
  });

  it("the card overlay, the card-layout target and the outline drawing follow it", () => {
    expect(camera).toContain(
      "const cardActive = cardPathActive({ cardMode, typedLengthMm: userLengthMm });",
    );
    expect(camera).toContain(
      '{cardActive && result.kind === "none" && stageSize && (\n              <CardGuideOverlay',
    );
    expect(camera).toMatch(
      /\{cardActive && result\.kind === "none" && stageSize && \(\s*\/\/ The scan tour's spotlight target/,
    );
    expect(camera).toContain("outlineCorners={cardActive}");
    expect(camera).not.toMatch(/\{cardMode && result\.kind === "none"/);
  });
});

describe("item 2 [major]: no tour where it has nothing to point at", () => {
  it("tourScreenShown: the live camera with no photo and no typed length", () => {
    for (const camera of ["live", "requesting"] as const)
      expect(
        tourScreenShown({ camera, result: "none", typedLength: false }),
      ).toBe(true);
    for (const camera of ["cameraError", "noCamera", "streamEnded"] as const)
      expect(
        tourScreenShown({ camera, result: "none", typedLength: false }),
      ).toBe(false);
    expect(
      tourScreenShown({
        camera: "live",
        result: "processing",
        typedLength: false,
      }),
    ).toBe(false);
    expect(
      tourScreenShown({ camera: "live", result: "none", typedLength: true }),
    ).toBe(false);
  });

  const run = (
    events: TourEvent[],
    steps = buildTourSteps({ reference: "a4", cardModeAvailable: false }),
  ) => {
    let state: TourState = { phase: "closed" };
    const effects: TourEffect[] = [];
    for (const e of events) {
      const t = tourTransition(state, e, steps);
      state = t.state;
      effects.push(...t.effects);
    }
    return { state, effects };
  };

  it("教我 with no step: the answer is kept, no scan_tour_started, not marked seen", () => {
    const { state, effects } = run(
      [{ type: "openAuto" }, { type: "answerFirst" }],
      [],
    );
    expect(state.phase).toBe("closed");
    const names = effects.flatMap((e) =>
      e.kind === "track" ? [e.event.name] : [],
    );
    expect(names).toEqual(["scan_tour_first_use_answer"]);
    expect(effects.some((e) => e.kind === "close")).toBe(true);
    expect(effects.some((e) => e.kind === "markSeen")).toBe(false);
  });

  it("the camera mounts the tour only on that screen, and the old tip sheet everywhere else", () => {
    expect(camera).toMatch(
      /const tourScreen = tourScreenShown\(\{\s*camera: camState\.kind,\s*result: result\.kind,\s*typedLength: userLengthMm !== null,\s*\}\);/,
    );
    expect(camera).toMatch(
      /\{tipOpen && deviceFit === "phone" && !lengthStep && tourScreen && \(\s*<ScanTour/,
    );
    expect(camera).toContain(
      'if (tipOpen && deviceFit === "phone" && !lengthStep && !tourScreen) {',
    );
    expect(camera).toMatch(
      /const tipLeave = useLeaving\(\s*tipOpen && deviceFit === "phone" && !lengthStep && !tourScreen/,
    );
  });
});

describe("item 3 [major]: no length on the photo before the card outline is confirmed", () => {
  it("dimensions wait for the outline check as they wait for the adjustment", () => {
    expect(camera).toMatch(
      /const dimensions: readonly DimensionSpec\[\] \| null =\s*result\.kind === "measured" && result\.overlay\.landmarksPx && !adjustOpen/,
    );
    const photo = between(
      camera,
      "const renderPhoto = (measuredView: boolean) =>",
      "/>",
    );
    expect(photo).toContain(
      "dimensions={measuredView && !cardCheckOpen ? dimensions : null}",
    );
  });
});

describe("item 4 [minor]: the card's code is not in /scan/easy's first load", () => {
  it("runCardPhoto is a type-only import and loaded with import() in the card pipeline", () => {
    expect(camera).toContain(
      'import type { runCardPhoto } from "../card/runCardPhoto";',
    );
    expect(camera).not.toMatch(/^import \{ runCardPhoto \}/m);
    expect(camera).not.toContain("runCardPhotoImpl = runCardPhoto");
    expect(camera).toMatch(
      /runCardPhotoImpl \?\?\s*\(await import\("\.\.\/card\/runCardPhoto"\)\)\.runCardPhoto/,
    );
  });

  it("the overlay is next/dynamic; the prefetch runs only with the flag on", () => {
    expect(camera).not.toMatch(/^import \{ CardGuideOverlay \}/m);
    expect(camera).toMatch(
      /const CardGuideOverlay = dynamic\(\s*\(\) => import\("\.\.\/card\/CardGuideOverlay"\)/,
    );
    expect(camera).toMatch(
      /if \(!CARD_REFERENCE_ENABLED\) return;\s*void import\("\.\.\/card\/runCardPhoto"\)/,
    );
  });
});

describe("items 5+6 [minor]: the chip's menu (flag on) and main's toggle (flag off)", () => {
  const copy = cardReferenceCopy("zh-TW");
  const menu = (current: "a4" | "letter" | "card") =>
    renderToStaticMarkup(
      createElement(ReferenceMenu, {
        current,
        label:
          current === "card" ? copy.chip : current === "a4" ? "A4" : "Letter",
        copy,
        disabled: false,
        onSelect: () => undefined,
        initialOpen: true,
      }),
    );

  it("opens a menu of A4 / Letter / 卡片 with the current one checked", () => {
    const html = menu("letter");
    expect(html).toContain('role="menu"');
    const items = [
      ...html.matchAll(/<button[^>]*role="menuitemradio"[^>]*>/g),
    ].map((m) => m[0]);
    expect(items).toHaveLength(3);
    expect(items.map((b) => b.match(/data-reference="(\w+)"/)?.[1])).toEqual([
      "a4",
      "letter",
      "card",
    ]);
    expect(items.map((b) => b.includes('aria-checked="true"'))).toEqual([
      false,
      true,
      false,
    ]);
    expect(html).toContain(copy.menuTitle);
    expect(html).toContain(copy.menuCardDetail);
    expect(html).toMatch(
      /aria-haspopup="menu"[^>]*aria-expanded="true"|aria-expanded="true"[^>]*aria-haspopup="menu"/,
    );
    expect(html).toContain('data-tour="reference-chip"');
  });

  it("closed: only the chip", () => {
    const html = renderToStaticMarkup(
      createElement(ReferenceMenu, {
        current: "a4",
        label: "A4",
        copy,
        disabled: true,
        onSelect: () => undefined,
      }),
    );
    expect(html).not.toContain('role="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("disabled");
  });

  it("keyboard: arrows wrap, Home/End, Esc closes back to the chip, Tab closes", () => {
    expect(referenceMenuKey("ArrowDown", 2, 3)).toEqual({
      kind: "focus",
      index: 0,
    });
    expect(referenceMenuKey("ArrowUp", 0, 3)).toEqual({
      kind: "focus",
      index: 2,
    });
    expect(referenceMenuKey("Home", 2, 3)).toEqual({ kind: "focus", index: 0 });
    expect(referenceMenuKey("End", 0, 3)).toEqual({ kind: "focus", index: 2 });
    expect(referenceMenuKey("Escape", 1, 3)).toEqual({
      kind: "close",
      refocusChip: true,
    });
    expect(referenceMenuKey("Tab", 1, 3)).toEqual({
      kind: "close",
      refocusChip: false,
    });
    expect(referenceMenuKey("a", 1, 3)).toBeNull();
  });

  it("every row is at least 44 px", () => {
    expect(between(css, ".easyReferenceMenuItem {", "}")).toContain(
      "min-height: 44px;",
    );
  });

  it("flag on: the menu; flag off: main's A4 ↔ Letter button, no aria-label, no card", () => {
    expect(camera).toMatch(
      /\{userLengthMm === null && CARD_REFERENCE_ENABLED \? \([\s\S]*?<ReferenceMenu[\s\S]*?onSelect=\{selectReference\}/,
    );
    const flagOff = between(
      camera,
      "// Card flag off: main's A4 ↔ Letter toggle.",
      "</button>",
    );
    expect(flagOff).toContain("onClick={() => changePaperSize()}");
    expect(flagOff).not.toContain("aria-label");
  });

  it("the motion sensor is asked for only when the card is chosen", () => {
    expect(camera.match(/deviceTiltRef\.current\.request\(\)/g)).toHaveLength(
      1,
    );
    expect(camera).toContain(
      "if (step.cardMode) void deviceTiltRef.current.request();",
    );
  });

  it("on load: the stored paper size as on main, the card on top of it", () => {
    expect(camera).toMatch(
      /setPaperSize\(readStoredPaperSize\(storage\)\);\s*if \(readStoredReference\(storage, CARD_REFERENCE_ENABLED\) === "card"\)\s*setCardMode\(true\);/,
    );
  });
});

describe("item 8 [minor]: a card shot is never uploaded to the debug store", () => {
  it("the card pipeline drops the debug photo before anything is logged", () => {
    const cardRun = between(
      camera,
      "const runCardPipeline = useCallback(",
      "void logAttempt(info",
    );
    expect(cardRun).toContain("debugPhotoRef.current = null;");
  });

  it("uploadDebugPhoto sends nothing without a photo", () => {
    const fetchImpl = vi.fn();
    uploadDebugPhoto(
      null,
      { record: {} },
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("item 9 [minor]: each new step is announced", () => {
  it("focus goes to the step's title (tabIndex -1, a new node per step)", () => {
    expect(tour).toMatch(
      /<h2\s+key=\{step\.id\}\s+id="scan-tour-title"\s+className="scanTourTitle"\s+ref=\{stepTitleRef\}\s+tabIndex=\{-1\}/,
    );
    expect(tour).toContain(
      'if (state.phase === "step") stepTitleRef.current?.focus();',
    );
  });
});

describe("item 10 [minor]: closing the tour gives focus back", () => {
  it("tourReturnFocus: '?' when it opened the tour, else the shutter", () => {
    expect(tourReturnFocus("help")).toBe("help");
    expect(tourReturnFocus("auto")).toBe("shutter");
  });

  it("the dialog is closed before the parent unmounts it, and the camera focuses the target", () => {
    expect(tour).toMatch(
      /if \(dialogRef\.current\?\.open\) dialogRef\.current\.close\(\);\s*now\.onClose\(\);/,
    );
    expect(camera).toMatch(
      /tourReturnFocus\(tipTrigger\) === "help"\s*\? helpTriggerRef\.current\s*: \(shutterRef\.current \?\? helpTriggerRef\.current\);/,
    );
    expect(camera).toContain("ref={shutterRef}");
  });
});

describe("item 13 [minor]: no reference change while a shot is measured", () => {
  it("referenceChangeAllowed", () => {
    expect(referenceChangeAllowed({ capturing: false, measuring: false })).toBe(
      true,
    );
    expect(referenceChangeAllowed({ capturing: true, measuring: false })).toBe(
      false,
    );
    expect(referenceChangeAllowed({ capturing: false, measuring: true })).toBe(
      false,
    );
  });

  it("selectReference refuses while capturing or measuring (flag on); the menu is disabled while 測量中…", () => {
    const select = between(
      camera,
      "const selectReference = useCallback(",
      "const step = referenceSelect(",
    );
    expect(select).toMatch(
      /CARD_REFERENCE_ENABLED &&\s*!referenceChangeAllowed\(\{\s*capturing: capturingRef\.current,\s*measuring: shutterMeasuringRef\.current,\s*\}\)/,
    );
    expect(camera).toMatch(
      /<ReferenceMenu[\s\S]*?disabled=\{shutterMeasuring\}/,
    );
  });
});
