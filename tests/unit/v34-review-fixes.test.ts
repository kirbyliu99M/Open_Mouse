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
  cardCheckUnanswered,
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
  HOLE_TOOLTIP_GAP,
  PICTURE_WAIT_MS,
  TOUR_EXIT_FADE_MS,
  edgeVisible,
  layoutSpotlight,
  placeTooltip,
  tipPresentation,
  tourExitMs,
  tourReturnFocus,
  tourTransition,
  type TourEffect,
  type TourEvent,
  type TourState,
} from "../../src/client/camera/tour/tourModel";
import { cardReferenceCopy } from "../../src/lib/copy/card-reference";
import {
  cardRuleLineShown,
  cardStaticShapes,
} from "../../src/client/card/cardLive";
import { CardGuideOverlay } from "../../src/client/card/CardGuideOverlay";
import { loadCardGuideOverlay } from "../../src/client/card/LazyCardGuideOverlay";
import {
  CARD_CHROME_ALLOWED_PAIRS,
  boxesOverlap,
  cardChromeBoxes,
  guideLabelTop,
} from "../../src/client/card/cardChromeLayout";
import {
  labelHeightPx,
  labelTopPx,
} from "../../src/client/card/CardGuideOverlay";

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
      /cardPathActive\(\{\s*cardMode: cardModeRef\.current,\s*typedLengthMm: userLengthRef\.current,\s*manualPaperCorners,\s*referenceShown: photoFromReferenceScreenRef\.current,\s*\}\)/,
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
    // R4: the outline only on a card result.
    expect(camera).toContain("outlineCorners={cardResult}");
    expect(camera).not.toMatch(/\{cardMode && result\.kind === "none"/);
  });
});

describe("item 2 [major]: no tour where it has nothing to point at", () => {
  it("tipPresentation: the tour over a live picture, a wait while the camera is asked for, else the sheet", () => {
    const at = (
      camera:
        "live" | "requesting" | "cameraError" | "noCamera" | "streamEnded",
      extra: {
        result?: string;
        typedLength?: boolean;
        pictureReady?: boolean;
      } = {},
    ) =>
      tipPresentation({
        camera,
        result: extra.result ?? "none",
        typedLength: extra.typedLength ?? false,
        pictureReady: extra.pictureReady ?? true,
      });
    expect(at("live")).toBe("tour");
    for (const camera of ["cameraError", "noCamera", "streamEnded"] as const)
      expect(at(camera)).toBe("sheet");
    expect(at("live", { result: "processing" })).toBe("sheet");
    // A typed hand length: the sheet at once, as on main, whatever the camera.
    expect(at("requesting", { typedLength: true })).toBe("sheet");
    expect(at("live", { typedLength: true })).toBe("sheet");
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
      /const tipView = tipPresentation\(\{\s*camera: camState\.kind,\s*result: result\.kind,\s*typedLength: userLengthMm !== null,\s*pictureReady: videoReady,\s*pictureTimedOut,\s*sheetTouched: tipSheetTouched,\s*\}\);\s*const tourScreen = tipView === "tour";/,
    );
    expect(camera).toContain('const tipSheetScreen = tipView === "sheet";');
    expect(camera).toMatch(
      /\{tipOpen && deviceFit === "phone" && !lengthStep && tourScreen && \(\s*<ScanTour/,
    );
    expect(camera).toContain(
      'if (tipOpen && deviceFit === "phone" && !lengthStep && tipSheetScreen) {',
    );
    expect(camera).toMatch(
      /const tipLeave = useLeaving\(\s*tipOpen && deviceFit === "phone" && !lengthStep && tipSheetScreen/,
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

  it("the overlay is loaded on first use (LazyCardGuideOverlay); the prefetch runs only with the flag on", () => {
    expect(camera).not.toMatch(/^import \{ CardGuideOverlay \}/m);
    expect(camera).toMatch(
      /import \{\s*LazyCardGuideOverlay as CardGuideOverlay,\s*loadCardGuideOverlay,\s*\} from "\.\.\/card\/LazyCardGuideOverlay";/,
    );
    const lazy = read("src/client/card/LazyCardGuideOverlay.tsx");
    expect(lazy).toContain(
      'import type { CardGuideOverlay as Overlay } from "./CardGuideOverlay";',
    );
    expect(camera).toMatch(
      /if \(!CARD_REFERENCE_ENABLED\) return;\s*void import\("\.\.\/card\/runCardPhoto"\)[\s\S]{0,200}?void loadCardGuideOverlay\(\);/,
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
  it("each step's 下一步 is a new element, described by the step's title and body", () => {
    expect(tour).toMatch(
      /<button\s+type="button"\s+key=\{step\.id\}\s+ref=\{primaryRef\}\s+className="primaryButton"\s+aria-describedby="scan-tour-title scan-tour-body"/,
    );
    expect(tour).toContain('<div id="scan-tour-body">');
  });
});

describe("item 15 [minor]: focus lands on the button once the card can be seen", () => {
  it("focuses each screen once, after the card is placed (not on its hidden first paint)", () => {
    expect(tour).toMatch(
      /const placedForFocus = state\.phase === "welcome" \|\| placement !== null;/,
    );
    expect(tour).toMatch(
      /if \(screenKey === null \|\| !placedForFocus\) return;[\s\S]{0,260}?if \(focusedScreenRef\.current === screenKey && inDialog\) return;\s*focusedScreenRef\.current = screenKey;\s*primaryRef\.current\?\.focus\(\);/,
    );
    // Declared before use (the placement is worked out first).
    expect(tour.indexOf("const placement =")).toBeLessThan(
      tour.indexOf("const placedForFocus"),
    );
  });
});

describe("item 17 [minor]: the tour fades out (none under reduced motion)", () => {
  it("tourExitMs: 150 ms, 0 under reduced motion", () => {
    expect(TOUR_EXIT_FADE_MS).toBeLessThanOrEqual(160);
    expect(tourExitMs(false)).toBe(TOUR_EXIT_FADE_MS);
    expect(tourExitMs(true)).toBe(0);
  });

  it("the dialog keeps its screen, fades (data-leaving), then closes; CSS matches the time", () => {
    expect(tour).toContain('data-leaving={leaving ? "true" : undefined}');
    expect(tour).toMatch(
      /const ms = tourExitMs\(prefersReducedMotion\(\)\);\s*if \(ms === 0 \|\| !dialogRef\.current\?\.open\) \{\s*finish\(\);/,
    );
    expect(tour).toContain("if (!closing) setState(next);");
    const tourCss = read("src/client/camera/tour/scan-tour.css");
    expect(tourCss).toContain(
      `animation: easyFadeOut ${TOUR_EXIT_FADE_MS}ms ease-in forwards;`,
    );
    expect(tourCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.scanTour\[data-leaving="true"\] \{\s*animation: none;/,
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
      /if \(dialogRef\.current\?\.open\) dialogRef\.current\.close\(\);\s*setState\(next\);\s*now\.onClose\(\);/,
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
      /<ReferenceMenu[\s\S]*?disabled=\{shutterMeasuring \|\| capturingUi\}/,
    );
  });
});

describe("item 14 [major]: the card guide is drawn from the static layout", () => {
  const view = { width: 390, height: 844 };
  const copy = cardReferenceCopy("en");

  it("cardStaticShapes: brackets, centre line, wrist line and card slot, all neutral, no level", () => {
    for (const side of ["right", "left"] as const) {
      const shapes = cardStaticShapes(side, view);
      const kinds = shapes.map((s) => s.kind);
      expect(kinds).toContain("brackets");
      expect(kinds).toContain("line");
      expect(kinds).not.toContain("level");
      expect(shapes.some((s) => s.kind === "zone" && s.card)).toBe(true);
      expect(shapes.every((s) => !("tone" in s) || s.tone === "neutral")).toBe(
        true,
      );
    }
  });

  it("drawn with no live reading: the card slot target and the labels exist", () => {
    const html = renderToStaticMarkup(
      createElement(CardGuideOverlay, {
        shapes: cardStaticShapes("right", view),
        width: view.width,
        height: view.height,
        copy,
      }),
    );
    expect(html).toContain('data-tour="card-slot"');
    expect(html).toContain(copy.handZone);
    expect(html).toContain(copy.wristLine);
  });

  it("the camera draws it whenever card mode is on: before the first sample and under the tour", () => {
    expect(camera).toMatch(
      /shapes=\{\s*cardShapes\.length > 0 && !tipOpen\s*\? cardShapes\s*: cardStaticShapes\(handChip\.hand, stageSize\)\s*\}/,
    );
  });
});

describe("item 16 [minor]: the card guide's words are measurable pills", () => {
  it("HTML labels, solid white on rgba(0,0,0,0.6); no SVG text", () => {
    const html = renderToStaticMarkup(
      createElement(CardGuideOverlay, {
        shapes: cardStaticShapes("right", { width: 390, height: 844 }),
        width: 390,
        height: 844,
        copy: cardReferenceCopy("zh-TW"),
      }),
    );
    expect(html).not.toContain("<text");
    expect(html).not.toContain("<tspan");
    const labels = [
      ...html.matchAll(/<span class="cardGuideLabel" style="([^"]*)"/g),
    ].map((m) => m[1]);
    expect(labels.length).toBeGreaterThanOrEqual(3);
    for (const style of labels) {
      expect(style).toContain("background:rgba(0,0,0,0.6)");
      expect(style).toContain("color:#fff");
    }
  });

  it("is on the reviewed OVER_LIVE_PICTURE list of the axe spec", () => {
    const axe = read("tests/e2e/a11y-axe.spec.ts");
    const list = between(axe, "const OVER_LIVE_PICTURE", "];");
    expect(list).toContain('{ selector: ".cardGuideLabel" }');
  });
});

describe("item 3 (e2e): the photo's text carries no numbers before 有", () => {
  it("no dimension lines (their text) are drawn while the outline check is open", () => {
    const frozen = read("src/client/camera/FrozenPhoto.tsx");
    // The only text on the photo is the dimension overlay, drawn from `dimensions`.
    expect(frozen).toContain('{phase === "measured" && dimensions && (');
    expect(camera).toContain(
      "dimensions={measuredView && !cardCheckOpen ? dimensions : null}",
    );
  });
});

describe("B1 [blocker]: the first-run tour never waits on a stream nobody attached", () => {
  it("the stream is attached and played in its own effect, whatever the tip / tour", () => {
    const effect = between(
      camera,
      "// Review B1: the live picture plays whenever the camera is live and the",
      "useLayoutEffect(() => {",
    );
    expect(effect).not.toContain("tipOpen");
    expect(effect).toMatch(
      /if \(camState\.kind !== "live" \|\| !showStage \|\| result\.kind !== "none"\)\s*return;/,
    );
    expect(effect).toContain(
      "if (video.srcObject !== stream) video.srcObject = stream;",
    );
    expect(effect).toContain("video.play().catch(() => {});");
    expect(effect).toContain("}, [camState.kind, showStage, result.kind]);");
    // Only the live loop (sampling, auto-capture) stays paused under the tip.
    expect(camera).toContain(
      'if (camState.kind !== "live" || tipOpen || manualActive) return;',
    );
  });

  it("no picture within PICTURE_WAIT_MS: the tip sheet, never a blank screen", () => {
    expect(PICTURE_WAIT_MS).toBe(2500);
    const at = (pictureReady: boolean, pictureTimedOut: boolean) =>
      tipPresentation({
        camera: "live",
        result: "none",
        typedLength: false,
        pictureReady,
        pictureTimedOut,
      });
    expect(at(false, false)).toBe("wait");
    expect(at(false, true)).toBe("sheet");
    expect(at(true, false)).toBe("tour");
    expect(camera).toMatch(
      /if \(camState\.kind !== "live" \|\| videoReady\) return;\s*const timer = window\.setTimeout\(\s*\(\) => setPictureTimedOut\(true\),\s*PICTURE_WAIT_MS,\s*\);/,
    );
    expect(camera).toMatch(/if \(!tipOpen\) \{\s*setPictureTimedOut\(false\);/);
  });
});

describe("M1 [major]: a card chunk that fails to load never reaches the error page", () => {
  it("loadCardGuideOverlay: null on failure, tried again next time, kept once loaded", async () => {
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new Error("ChunkLoadError");
    };
    expect(await loadCardGuideOverlay(failing)).toBeNull();
    expect(await loadCardGuideOverlay(failing)).toBeNull();
    expect(calls).toBe(2);
    const ok = await loadCardGuideOverlay(async () => ({ CardGuideOverlay }));
    expect(ok).toBe(CardGuideOverlay);
    expect(await loadCardGuideOverlay(failing)).toBe(CardGuideOverlay);
    expect(calls).toBe(2);
  });

  it("the card analysis import sits inside the pipeline's try (a normal retry error)", () => {
    const cardRun = between(
      camera,
      "const runCardPipeline = useCallback(",
      "runCardPipelineRef.current = runCardPipeline;",
    );
    const tryAt = cardRun.indexOf("try {");
    const importAt = cardRun.indexOf('await import("../card/runCardPhoto")');
    expect(tryAt).toBeGreaterThan(0);
    expect(importAt).toBeGreaterThan(tryAt);
    expect(cardRun).toContain('"PROCESSING_FAILED"');
  });
});

describe("m1 [minor]: the tour card keeps the placement labels visible", () => {
  it("a tall ring with labels inside: the card goes where it does not cover them", () => {
    const viewport = { width: 390, height: 844 };
    const hole = { x: 10, y: 80, width: 370, height: 740 };
    const labels = { x: 10, y: 700, width: 370, height: 60 };
    const tooltip = { width: 358, height: 300 };
    const without = placeTooltip(hole, tooltip, viewport, "auto");
    expect(without.overlaps).toBe(true);
    const placed = placeTooltip(hole, tooltip, viewport, "auto", labels);
    const coversLabels =
      placed.y < labels.y + labels.height &&
      placed.y + tooltip.height > labels.y;
    expect(coversLabels).toBe(false);
    // Nothing to keep clear: as before.
    expect(placeTooltip(hole, tooltip, viewport, "auto", null)).toEqual(
      without,
    );
    // Round 6 (G6/G7): the ring is cropped above the card instead; the
    // labels then sit at the cropped edge (layoutSpotlight below).
    expect(tour).toContain("layoutSpotlight(");
  });
});

describe("m2 [minor]: uploads from screens without the reference take the paper path", () => {
  it("cardPathActive: referenceShown false is the paper path", () => {
    expect(
      cardPathActive({
        cardMode: true,
        typedLengthMm: null,
        referenceShown: false,
      }),
    ).toBe(false);
    expect(
      cardPathActive({
        cardMode: true,
        typedLengthMm: null,
        referenceShown: true,
      }),
    ).toBe(true);
  });

  it("R1: an upload's origin is recorded at the tap (live dock true, the other screens false), read and cleared when the file returns; a shot always counts", () => {
    const dock = between(camera, 'className="easyUploadIconButton"', "<span");
    expect(dock).toMatch(
      /onPointerDown=\{\(\) => \{\s*uploadFromReferenceScreenRef\.current = true;\s*\}\}/,
    );
    expect(dock).toMatch(
      /onClick=\{\(\) => \{\s*uploadFromReferenceScreenRef\.current = true;\s*\}\}/,
    );
    const fallbacks = [
      ...camera.matchAll(
        /className="easyUploadFallbackButton"\s*htmlFor="easy-scan-upload"\s*onPointerDown=\{\(\) => \{\s*uploadFromReferenceScreenRef\.current = false;/g,
      ),
    ];
    expect(fallbacks).toHaveLength(2);
    const pick = between(
      camera,
      "const onFilePicked = useCallback(",
      "void runPipeline(file, previewUrl);",
    );
    expect(pick).toMatch(
      /photoFromReferenceScreenRef\.current =\s*uploadFromReferenceScreenRef\.current;\s*uploadFromReferenceScreenRef\.current = false;/,
    );
    // Read before the stream is stopped, and nothing reads the live screen at file time.
    expect(pick.indexOf("uploadFromReferenceScreenRef.current;")).toBeLessThan(
      pick.indexOf("stopStream();"),
    );
    expect(camera).not.toContain("referenceScreenRef.current =\n");
    expect(camera).toMatch(
      /handedOff = true;\s*photoFromReferenceScreenRef\.current = true;\s*void runPipeline\(file, previewUrl\);/,
    );
  });
});

describe("n1, n2: the menu during a shot; the iOS level hint", () => {
  it("n1: the menu is disabled from the shutter press (capturingUi)", () => {
    expect(camera).toMatch(
      /capturingRef\.current = true;[\s\S]{0,120}?setCapturingUi\(true\);/,
    );
    expect(camera).toMatch(
      /capturingRef\.current = false;\s*setCapturingUi\(false\);/,
    );
  });

  it("n2: card mode on iOS without the sensor offers a 44 px tap that asks for it", () => {
    expect(camera).toMatch(
      /\{cardActive && deviceTilt\.state === "needs-permission" && \([\s\S]*?className="easyTiltPermission"\s*onClick=\{\(\) => void deviceTilt\.request\(\)\}/,
    );
    expect(cardReferenceCopy("zh-TW").tiltPermission).toBe("開啟水平提示");
    expect(between(css, "/* iOS, card mode: the tap that asks", "}")).toContain(
      "min-height: 44px;",
    );
    const axe = read("tests/e2e/a11y-axe.spec.ts");
    expect(between(axe, "const OVER_LIVE_PICTURE", "];")).toContain(
      '{ selector: ".easyTiltPermission" }',
    );
  });
});

describe("round 4: R2 dock while the tip is open, R3 fallback sheet, R4 card results", () => {
  it("R2: the live dock is inert while the tip / tour is open or waiting", () => {
    expect(camera).toMatch(
      /const dock = dockRef\.current;\s*if \(dock\) dock\.inert = liveChromeLeave\.leaving \|\| tipOpen;\s*\}, \[tipOpen, liveChromeLeave\.leaving, liveChromeLeave\.shown\]\);/,
    );
    // The leaving pin of the motion pass stays as it was.
    expect(camera).toMatch(
      /className="easyBottomDock easyBottomDock-withHandle"[\s\S]{0,200}?inert=\{liveChromeLeave\.leaving\}/,
    );
  });

  it("R3: a picture that arrives after the fallback sheet brings the tour", () => {
    expect(
      tipPresentation({
        camera: "live",
        result: "none",
        typedLength: false,
        pictureReady: true,
        pictureTimedOut: true,
      }),
    ).toBe("tour");
    // The sheet is closed for the tour while untouched (tipOpen still true).
    expect(camera).toMatch(
      /\} else if \(tourScreen\) \{[\s\S]{0,200}?tipDialogRef\.current\?\.close\(\);/,
    );
  });

  it("G1: dismissing any tip sheet marks the tip seen, as on main (the picture-wait fallback too)", () => {
    const dismiss = between(
      camera,
      "const dismissTip = useCallback(",
      "}, []);",
    );
    expect(dismiss).toMatch(
      /tipDialogRef\.current\?\.close\(\);[\s\S]*?\n\s*markFirstRunTipSeen\(getBrowserStorage\(\)\);/,
    );
    expect(dismiss).not.toMatch(/if \([\s\S]*?\)\s*markFirstRunTipSeen/);
    expect(camera).not.toContain("pictureWaitFallback");
  });

  it("R3: in card mode the fallback sheet gives the card rule, not the paper line", () => {
    expect(camera).toMatch(
      /\{cardActive\s*\? cardCopy\.cardRule\s*: easy\.tipPaperOnTable\(PAPER_SIZE_LABELS\[paperSize\]\)\}/,
    );
  });

  it("R4: card results carry reference card; the outline follows the result, not the stored mode", () => {
    const cardRun = between(
      camera,
      "const runCardPipeline = useCallback(",
      "runCardPipelineRef.current = runCardPipeline;",
    );
    expect(cardRun.match(/reference: "card",/g)?.length).toBe(
      cardRun.match(/setResult\(\{\s*kind: "(measured|gateFailure)"/g)?.length,
    );
    const paperRun = between(
      camera,
      "const runPipeline = useCallback(",
      "const runCardPipeline = useCallback(",
    );
    expect(paperRun).not.toContain('reference: "card"');
    expect(camera).toMatch(
      /const cardResult =\s*\(result\.kind === "measured" \|\| result\.kind === "gateFailure"\) &&\s*result\.reference === "card";/,
    );
  });
});

describe("R5 (a11y): the outline question is a modal sheet like the others", () => {
  const check = between(camera, "{cardCheckOpen && (", "</dialog>");

  it("a <dialog> labelled by the question, with Esc as 沒有，重拍", () => {
    expect(check).toMatch(
      /<dialog\s+ref=\{cardCheckDialogRef\}\s+className="easySheet easyResultSheet easyCardCheck"\s+aria-labelledby="easy-card-check-title"\s+data-testid="card-check"/,
    );
    expect(check).not.toContain('role="dialog"');
    expect(check).toContain('id="easy-card-check-title"');
    expect(check).toMatch(
      /onCancel=\{\(e\) => \{\s*e\.preventDefault\(\);\s*retake\(\);\s*\}\}/,
    );
    // The No button does the same.
    expect(
      between(check, 'data-testid="card-check-no"', "</button>"),
    ).toContain("onClick={retake}");
  });

  it("opened with showModal, focus on 有, closed before it unmounts", () => {
    expect(camera).toMatch(
      /useLayoutEffect\(\(\) => \{\s*if \(!cardCheckOpen\) return;\s*const dialog = cardCheckDialogRef\.current;\s*if \(!dialog\) return;\s*if \(!dialog\.open\) dialog\.showModal\(\);\s*cardCheckYesRef\.current\?\.focus\(\);\s*return \(\) => \{\s*if \(dialog\.open\) dialog\.close\(\);\s*\};\s*\}, \[cardCheckOpen\]\);/,
    );
    expect(check).toMatch(
      /ref=\{cardCheckYesRef\}\s*data-testid="card-check-yes"/,
    );
  });

  it("the photo stays visible behind it (the result sheets' transparent backdrop)", () => {
    expect(between(css, ".easySheet::backdrop {", "}")).toContain(
      "background: transparent;",
    );
  });
});

describe("round 5: F2 focus after the tour, F3 upload origin, F4 late picture, F5 card-check close", () => {
  it("F2: the dock's inert is a layout effect declared before the focus-return effect", () => {
    const inertAt = camera.indexOf(
      "if (dock) dock.inert = liveChromeLeave.leaving || tipOpen;",
    );
    const focusAt = camera.indexOf("tourReturnFocus(tipTrigger)");
    expect(inertAt).toBeGreaterThan(0);
    expect(inertAt).toBeLessThan(focusAt);
    const before = camera.slice(
      camera.lastIndexOf("useLayoutEffect(() => {", inertAt),
      inertAt,
    );
    expect(before).toContain("const dock = dockRef.current;");
    expect(camera).not.toMatch(
      /useEffect\(\(\) => \{\s*const dock = dockRef\.current;/,
    );
  });

  it("F3: the input itself records the origin (live dock on screen); a cancelled or empty pick clears it", () => {
    expect(camera).toMatch(
      /id="easy-scan-upload"[\s\S]{0,400}?onClick=\{\(\) => \{\s*uploadFromReferenceScreenRef\.current = liveDockShownRef\.current;\s*\}\}/,
    );
    expect(camera).toMatch(
      /liveDockShownRef\.current =\s*Boolean\(liveChromeLeave\.shown\) &&\s*!liveChromeLeave\.leaving &&\s*!lengthStep;/,
    );
    const pick = between(
      camera,
      "const onFilePicked = useCallback(",
      "stopStream();",
    );
    expect(pick).toMatch(
      /if \(!file \|\| manualActiveRef\.current\) \{\s*uploadFromReferenceScreenRef\.current = false;\s*return;\s*\}/,
    );
  });

  it("G2: the picker-cancel listener is attached by a callback ref, whenever the input mounts", () => {
    expect(camera).toMatch(/id="easy-scan-upload"\s*ref=\{attachFileInput\}/);
    const attach = between(
      camera,
      "const attachFileInput = useCallback(",
      "}, []);",
    );
    expect(attach).toContain("fileInputCleanupRef.current?.();");
    expect(attach).toContain('input.addEventListener("cancel", onCancel);');
    expect(attach).toMatch(
      /const onCancel = \(\) => \{\s*uploadFromReferenceScreenRef\.current = false;\s*\};/,
    );
    expect(camera).not.toContain("fileInputRef");
  });

  it("G3: a retake and a resumed loop drop the old card drawing", () => {
    expect(
      between(camera, "const retake = useCallback(() => {", "setResult("),
    ).toContain("setCardShapes([]);");
    expect(camera).toMatch(
      /sample fire an auto-capture\.\s*resetLoopState\(\);\s*\/\/ Review G3[^\n]*\n\s*setCardShapes\(\[\]\);/,
    );
  });

  it("F4: a late picture replaces the fallback sheet only while it is untouched", () => {
    const at = (sheetTouched: boolean) =>
      tipPresentation({
        camera: "live",
        result: "none",
        typedLength: false,
        pictureReady: true,
        pictureTimedOut: true,
        sheetTouched,
      });
    expect(at(false)).toBe("tour");
    expect(at(true)).toBe("sheet");
    // A touched flag without a timeout changes nothing.
    expect(
      tipPresentation({
        camera: "live",
        result: "none",
        typedLength: false,
        pictureReady: true,
        sheetTouched: true,
      }),
    ).toBe("tour");
    expect(camera).toContain(
      "onPointerDownCapture={() => setTipSheetTouched(true)}",
    );
    expect(camera).toContain(
      "onKeyDownCapture={() => setTipSheetTouched(true)}",
    );
    expect(camera).toContain("sheetTouched: tipSheetTouched,");
  });

  it("F5: the card-check dialog closed without an answer is a retake", () => {
    expect(
      cardCheckUnanswered({ kind: "measured", cardCheck: "pending" }),
    ).toBe(true);
    expect(cardCheckUnanswered({ kind: "measured" })).toBe(false);
    expect(cardCheckUnanswered({ kind: "none" })).toBe(false);
    const check = between(camera, "{cardCheckOpen && (", "</dialog>");
    expect(check).toMatch(
      /onClose=\{\(\) => \{\s*if \(cardCheckUnanswered\(resultRef\.current\)\) retake\(\);\s*\}\}/,
    );
  });
});

describe("round 6: G5 card screen layout, G6/G7 spotlight crop, G8–G10", () => {
  const inter = (
    a: { y: number; height: number },
    b: { y: number; height: number },
  ) => a.y < b.y + b.height && b.y < a.y + a.height;

  it("G5/K1–K3: no two of top bar, cue, short rule, level-hint button, level ring, wrist label, chip, shutter, upload, slot, slot label overlap (360/390/430 wide; short and tall)", () => {
    const locales = [cardReferenceCopy("zh-TW"), cardReferenceCopy("en")];
    const sizes = [
      { width: 360, height: 640 },
      { width: 360, height: 780 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
    ];
    for (const viewport of sizes)
      for (const words of locales)
        for (const tilt of [false, true])
          for (const typedEntry of [false, true])
            for (const side of ["right", "left"] as const) {
              const boxes = cardChromeBoxes(viewport, {
                ruleText: words.cardRuleShort,
                tiltText: words.tiltPermission,
                tilt,
                typedEntry,
                side,
              });
              const list = Object.entries(boxes).filter(
                (e): e is [string, NonNullable<(typeof e)[1]>] => e[1] !== null,
              );
              const allowed = (x: string, y: string) =>
                CARD_CHROME_ALLOWED_PAIRS.some(
                  ([p, q]) => (p === x && q === y) || (p === y && q === x),
                );
              for (let a = 0; a < list.length; a++)
                for (let b = a + 1; b < list.length; b++)
                  if (!allowed(list[a][0], list[b][0]))
                    expect(
                      boxesOverlap(list[a][1], list[b][1]),
                      `${list[a][0]} × ${list[b][0]} at ${viewport.width}×${viewport.height} tilt=${tilt} typed=${typedEntry} ${side}`,
                    ).toBe(false);
            }
  });

  it("G5: guideLabelTop keeps a label above the dock; with no floor it is centred", () => {
    expect(guideLabelTop(500, 20, null)).toBe(490);
    expect(guideLabelTop(500, 20, 600)).toBe(490);
    expect(guideLabelTop(500, 20, 505)).toBe(505 - 8 - 20);
    expect(
      labelHeightPx({ text: "a" + String.fromCharCode(10) + "b", size: 15 }),
    ).toBeCloseTo(2 * 15 * 1.2 + 4, 9);
  });

  it("G5: the card rule and the level-hint button sit under the cue, not in the dock, and hide under the tour", () => {
    const wrap = between(
      camera,
      'data-testid="camera-cue"',
      'className="easyBottomRow"',
    );
    expect(wrap).toMatch(
      /\{cardActive && !tipOpen && \([\s\S]*?className="easyCardRule"[\s\S]*?className="easyTiltPermission"/,
    );
    const dock = between(camera, "ref={dockRef}", 'className="easyBottomRow"');
    expect(dock).not.toContain("easyTiltPermission");
    expect(camera).toMatch(
      /: cardMode\s*\? \/\/ Review G5[^\n]*\n[^\n]*\n\s*""/,
    );
    expect(camera).toContain("labelFloorPx={dockTopPx}");
    const axe = read("tests/e2e/a11y-axe.spec.ts");
    expect(between(axe, "const OVER_LIVE_PICTURE", "];")).toContain(
      '{ selector: ".easyCardRule" }',
    );
    // Paper mode's hint line is untouched.
    expect(camera).toMatch(/: easyHintText\(\{/);
  });

  it("G5: the wrist label sits at the line's left end, just above it", () => {
    const shapes = cardStaticShapes("right", { width: 390, height: 844 });
    const label = shapes.find(
      (s) => s.kind === "label" && s.text === "手腕大約在這附近",
    );
    expect(label).toMatchObject({ anchor: "start" });
    if (label?.kind !== "label") throw new Error("no wrist label");
    expect(label.at.y).toBeLessThan(0.7);
    expect(label.at.x).toBeLessThan(0.1);
  });

  it("G6: a tall ring is cropped to end 14 px above the card pinned at the bottom; the card never covers it", () => {
    const viewport = { width: 390, height: 844 };
    // Card layout down to the wrist line (y 0.08–0.70 of 844, padded 6).
    const ring = { x: 6, y: 61, width: 345, height: 538 };
    const tooltip = { width: 358, height: 290 };
    const { placement, hole } = layoutSpotlight(
      ring,
      ring,
      tooltip,
      viewport,
      "auto",
    );
    expect(placement.overlaps).toBe(false);
    expect(placement.y).toBe(844 - 16 - 290);
    expect(hole.y).toBe(ring.y);
    expect(hole.y + hole.height).toBe(placement.y - HOLE_TOOLTIP_GAP);
    expect(inter(hole, { y: placement.y, height: tooltip.height })).toBe(false);
  });

  it("H2: the paper ring keeps its real bottom edge lit (the card pinned at the top, the ring cropped from above); the wrist line is at that edge", () => {
    const viewport = { width: 390, height: 844 };
    const ring = { x: 18, y: 98, width: 354, height: 640 };
    const tooltip = { width: 358, height: 208 };
    const { placement, hole } = layoutSpotlight(
      ring,
      ring,
      tooltip,
      viewport,
      "dock-bottom",
      "bottom",
    );
    expect(placement.y).toBe(16);
    expect(hole.y + hole.height).toBe(ring.y + ring.height);
    expect(hole.y).toBe(16 + 208 + HOLE_TOOLTIP_GAP);
    expect(inter(hole, { y: placement.y, height: tooltip.height })).toBe(false);
    // The line is drawn at the paper's real bottom edge, only when the ring's
    // bottom is the paper's own and the card does not cover it.
    expect(tour).toMatch(
      /step\.target === "paper-frame" &&\s*ring &&[\s\S]{0,200}?hole\.y \+ hole\.height === ring\.y \+ ring\.height &&[\s\S]{0,300}?edgeVisible\(ring\.y \+ ring\.height - SPOTLIGHT_PAD/,
    );
    expect(tour).toMatch(/hole\.y \+ hole\.height - SPOTLIGHT_PAD - 2/);
    expect(tour).toContain('step.target === "paper-frame" ? "bottom" : "top",');
    expect(edgeVisible(700, { y: 620, height: 208 })).toBe(false);
    expect(edgeVisible(600, { y: 620, height: 208 })).toBe(true);
  });

  it("G8 note: a small ring (the chip) on a short screen: the card scrolls inside instead of covering it", () => {
    const viewport = { width: 360, height: 640 };
    const chip = { x: 18, y: 462, width: 76, height: 56 };
    const tooltip = { width: 328, height: 520 };
    const { placement, hole } = layoutSpotlight(
      chip,
      chip,
      tooltip,
      viewport,
      "auto",
    );
    expect(hole).toEqual(chip);
    expect(placement.maxHeight).toBeDefined();
    const shown = { y: placement.y, height: placement.maxHeight! };
    expect(inter(shown, chip)).toBe(false);
    expect(shown.y).toBeGreaterThanOrEqual(16);
    expect(tour).toMatch(/maxHeight: placement\.maxHeight, overflowY: "auto"/);
    // The natural height is measured (scrollHeight), so the limit does not feed back.
    expect(tour).toContain("Math.max(box.height, el.scrollHeight)");
  });

  it("G8: the card step-1 body matches the live rule", () => {
    const zh = read("src/lib/copy/scan-tour.ts");
    expect(zh).toContain(
      "用悠遊卡、一卡通這類標準大小的淺色或亮面卡片，背面朝上放；證件、信用卡有個資不要用，名片大小不對。",
    );
    expect(zh).toContain("Use a light or glossy standard-size card");
  });

  it("G9: card mode's typed-length link says no card; paper keeps its words", () => {
    expect(cardReferenceCopy("zh-TW").noCardEntry).toBe(
      "沒有卡片？改用尺量手長",
    );
    expect(cardReferenceCopy("en").noCardEntry).toBe(
      "No card? Use a ruler instead",
    );
    expect(camera).toContain(
      "{cardActive ? cardCopy.noCardEntry : noPaperLabel}",
    );
  });
});

describe("round 7: H1 column wrap, H3 dock top, H4 wrist label only, H5 '?' during the wait", () => {
  it("H1: card mode makes the cue band a column (data-card); paper keeps main's row", () => {
    expect(camera).toContain(
      'data-card={cardActive && !tipOpen ? "true" : undefined}',
    );
    expect(
      between(css, '.easyScanStaged .cameraCueWrap[data-card="true"] {', "}"),
    ).toMatch(/flex-direction: column;\s*align-items: center;/);
    // No unconditional change to the wrap.
    expect(css).not.toMatch(/\.cameraCueWrap \{[^}]*flex-direction: column/);
    // K1: one line.
    expect(between(css, ".easyCardRule {", "}")).toContain(
      "white-space: nowrap;",
    );
  });

  it("H3: the dock's top is measured without its transform", () => {
    expect(camera).toContain(
      "const top = stage.clientHeight - dock.offsetHeight;",
    );
    expect(camera).not.toMatch(
      /dock\.getBoundingClientRect\(\)\.top - stage\.getBoundingClientRect\(\)\.top/,
    );
  });

  it("H4: only the wrist label is kept above the dock; left out when its line is under it; others stay centred", () => {
    const wrist = {
      text: "Wrist about here",
      x: 10,
      y: 450,
      anchor: "start" as const,
      size: 13,
      wristLineY: 470,
    };
    const h = labelHeightPx(wrist);
    expect(labelTopPx(wrist, null)).toBeCloseTo(450 - h / 2, 9);
    expect(labelTopPx(wrist, 455)).toBeNull();
    expect(labelTopPx(wrist, 480)).toBeCloseTo(
      Math.min(450 - h / 2, 480 - 8 - h),
      9,
    );
    const slot = {
      text: "Card" + String.fromCharCode(10) + "here",
      x: 280,
      y: 400,
      anchor: "middle" as const,
      size: 15,
    };
    expect(labelTopPx(slot, 300)).toBeCloseTo(400 - labelHeightPx(slot) / 2, 9);
  });

  it("H5: '?' while the first-run tip is open keeps the first-run variant", () => {
    const open = between(camera, "const openTip = useCallback(", "}, []);");
    expect(open).toMatch(
      /if \(!tipOpenRef\.current\) setTipTrigger\("help"\);\s*setTipOpen\(true\);/,
    );
  });
});

describe("round 8: K1 one short rule line, K2 level ring, K3 level-hint row", () => {
  const zh = cardReferenceCopy("zh-TW");
  const en = cardReferenceCopy("en");

  it("K1: the live line is the short rule; the full rule stays for the tour and the tips", () => {
    expect(zh.cardRuleShort).toBe("淺色卡片、背面朝上，放進虛線框");
    expect(en.cardRuleShort.length).toBeLessThan(40);
    const row = between(camera, 'className="easyCardRow"', "</div>");
    expect(row).toContain("{cardCopy.cardRuleShort}");
    expect(row).not.toContain("{cardCopy.cardRule}");
    // The fallback tip sheet keeps the full rule.
    expect(camera).toContain("? cardCopy.cardRule");
  });

  it("K1: the line shows while there is no hand, and goes once a hand is read", () => {
    expect(cardRuleLineShown(null, zh)).toBe(true);
    expect(cardRuleLineShown(zh.hintNoHand, zh)).toBe(true);
    expect(cardRuleLineShown(zh.hintLoading, zh)).toBe(true);
    expect(cardRuleLineShown(zh.hintCloser, zh)).toBe(false);
    expect(cardRuleLineShown(zh.hintOk, zh)).toBe(false);
    expect(camera).toContain("{cardRuleLineShown(cardHint, cardCopy) && (");
  });

  it("K2: the level ring sits inside the card slot's top, clear of the top bar, both hands", () => {
    for (const side of ["right", "left"] as const)
      for (const viewport of [
        { width: 360, height: 640 },
        { width: 390, height: 844 },
        { width: 430, height: 932 },
      ]) {
        const b = cardChromeBoxes(viewport, {
          ruleText: zh.cardRuleShort,
          tiltText: zh.tiltPermission,
          tilt: true,
          typedEntry: true,
          side,
        });
        expect(boxesOverlap(b.level!, b.topBar!)).toBe(false);
        // Its centre is inside the slot.
        const cx = b.level!.x + 18;
        const cy = b.level!.y + 18;
        expect(cx > b.slot!.x && cx < b.slot!.x + b.slot!.width).toBe(true);
        expect(cy > b.slot!.y && cy < b.slot!.y + b.slot!.height).toBe(true);
      }
  });

  it("K3: the level-hint button is in the rule's row, on the card side, above the slot", () => {
    const b = cardChromeBoxes(
      { width: 360, height: 640 },
      {
        ruleText: zh.cardRuleShort,
        tiltText: zh.tiltPermission,
        tilt: true,
        typedEntry: true,
        side: "right",
      },
    );
    expect(b.tilt!.x).toBeGreaterThan(b.rule!.x + b.rule!.width);
    expect(b.tilt!.y + b.tilt!.height).toBeLessThanOrEqual(b.slot!.y);
    expect(between(css, ".easyCardRow {", "}")).toMatch(
      /display: flex;[\s\S]*justify-content: space-between;/,
    );
  });
});
