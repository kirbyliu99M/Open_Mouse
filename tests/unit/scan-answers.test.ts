import { readFileSync } from "node:fs";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// LocaleProvider reads the router; there is none outside the app.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import { LocaleProvider as Provider } from "../../src/client/i18n/LocaleProvider";
import { GripPage, ThicknessPage } from "../../src/client/scan/AnswerPages";
import {
  INITIAL_ANSWERS,
  answersReducer,
  buildSubmission,
  gripControls,
  thicknessControls,
  type AnswersAction,
  type AnswersState,
} from "../../src/client/scan/answers";
import { submitScan } from "../../src/client/scan/submitScan";
import {
  SUBMIT_OVERLAY,
  overlayFadeMs,
  overlayPhaseFor,
} from "../../src/client/scan/submitOverlayPhase";
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
  type ScanSubmission,
} from "../../src/lib/contracts/measurement";
import { en, zhTW } from "../../src/lib/copy/scan-answers";

const LocaleProvider = Provider as unknown as FunctionComponent<{
  initialLocale: "en" | "zh-TW";
}>;

const BASE: ScanSubmission = scanSubmissionSchema.parse({
  hand: "right",
  measurements: {
    handLengthMm: 190,
    palmLengthMm: 108,
    palmWidthMm: 84,
    thumbLengthMm: 58,
    indexLengthMm: 68,
    middleLengthMm: 74,
    ringLengthMm: 69,
    pinkyLengthMm: 54,
  },
  calibration: {
    method: "paper-edge",
    paperSize: "a4",
    edgeFitResidualMm: 0.6,
    minSideCoverage: 0.92,
    parallaxCorrected: true,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
});

/** Runs the actions in order from the start. */
function run(...actions: AnswersAction[]): AnswersState {
  return actions.reduce(answersReducer, INITIAL_ANSWERS);
}

describe("copy", () => {
  it("zh-TW is exactly the text of the approved Pencil frames", () => {
    expect(zhTW.gripTitle).toBe("握滑鼠的方式");
    expect(zhTW.gripSubtitle).toBe("點選最像你平常的握法。");
    expect(zhTW.grip.palm).toEqual({
      name: "趴握",
      hint: "整個手掌貼在滑鼠上",
    });
    expect(zhTW.grip.claw).toEqual({
      name: "抓握",
      hint: "手掌後段貼著，手指拱起",
    });
    expect(zhTW.grip.fingertip).toEqual({
      name: "指握",
      hint: "只有指尖碰滑鼠，掌心懸空",
    });
    expect([zhTW.gripConfirm, zhTW.skip, zhTW.back, zhTW.stepGrip]).toEqual([
      "確認",
      "跳過",
      "返回",
      "1／2",
    ]);
    expect(zhTW.thicknessTitle).toBe("手掌厚度");
    expect(zhTW.thicknessSubtitle).toBe("點選最接近你的一項。");
    expect(zhTW.thickness.thick).toEqual({
      name: "厚",
      hint: "掌肉豐厚，大拇指根部明顯隆起",
    });
    expect(zhTW.thickness.medium).toEqual({
      name: "中",
      hint: "掌心有自然的弧度，介於兩者之間",
    });
    expect(zhTW.thickness.thin).toEqual({
      name: "薄",
      hint: "掌心偏平，手背的筋骨線條較明顯",
    });
    expect([zhTW.skipAndSee, zhTW.retake]).toEqual(["跳過並看結果", "重拍"]);
    expect([zhTW.thicknessSubmit, zhTW.stepThickness]).toEqual([
      "看結果",
      "2／2",
    ]);
  });

  it("English has every string, none empty, and none left in Chinese", () => {
    const strings = (v: unknown): string[] =>
      typeof v === "string"
        ? [v]
        : Object.values(v as Record<string, unknown>).flatMap(strings);
    for (const s of strings(en)) {
      expect(s.trim(), s).not.toBe("");
      expect(s, s).not.toMatch(/[㐀-鿿]/);
    }
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhTW).sort());
  });
});

describe("the page state machine", () => {
  it("starts on the sheet, 繼續 opens the grip page", () => {
    expect(INITIAL_ANSWERS.step).toBe("sheet");
    expect(run({ type: "open" }).step).toBe("grip");
  });

  it("確認 needs a choice, then moves to the thickness page", () => {
    const open = run({ type: "open" });
    expect(answersReducer(open, { type: "confirmGrip" }).step).toBe("grip");
    const chosen = run(
      { type: "open" },
      { type: "chooseGrip", grip: "claw" },
      { type: "confirmGrip" },
    );
    expect(chosen).toEqual({
      step: "thickness",
      grip: "claw",
      thickness: null,
    });
  });

  it("back keeps every answer, one page at a time", () => {
    const onThickness = run(
      { type: "open" },
      { type: "chooseGrip", grip: "fingertip" },
      { type: "confirmGrip" },
      { type: "chooseThickness", thickness: "thin" },
    );
    const backOnce = answersReducer(onThickness, { type: "back" });
    expect(backOnce).toEqual({
      step: "grip",
      grip: "fingertip",
      thickness: "thin",
    });
    const backTwice = answersReducer(backOnce, { type: "back" });
    expect(backTwice).toEqual({
      step: "sheet",
      grip: "fingertip",
      thickness: "thin",
    });
    // Back on the sheet goes nowhere.
    expect(answersReducer(backTwice, { type: "back" })).toBe(backTwice);
    // And going forward again finds the answers where they were.
    const again = answersReducer(backTwice, { type: "open" });
    expect(again.grip).toBe("fingertip");
    expect(again.thickness).toBe("thin");
  });

  it("skipping the grip page leaves no grip, even after a choice on it", () => {
    const skipped = run(
      { type: "open" },
      { type: "chooseGrip", grip: "palm" },
      { type: "skipGrip" },
    );
    expect(skipped).toEqual({ step: "thickness", grip: null, thickness: null });
  });

  it("skipping the thickness page clears a choice made on it", () => {
    const skipped = run(
      { type: "open" },
      { type: "skipGrip" },
      { type: "chooseThickness", thickness: "thick" },
      { type: "skipThickness" },
    );
    expect(skipped.thickness).toBeNull();
  });

  it("a choice is ignored on the page it does not belong to", () => {
    const onSheet = INITIAL_ANSWERS;
    expect(answersReducer(onSheet, { type: "chooseGrip", grip: "palm" })).toBe(
      onSheet,
    );
    const onGrip = run({ type: "open" });
    expect(
      answersReducer(onGrip, { type: "chooseThickness", thickness: "thin" }),
    ).toBe(onGrip);
  });

  it("a new photo resets everything", () => {
    const answered = run(
      { type: "open" },
      { type: "chooseGrip", grip: "claw" },
      { type: "confirmGrip" },
      { type: "chooseThickness", thickness: "medium" },
    );
    expect(answersReducer(answered, { type: "reset" })).toEqual(
      INITIAL_ANSWERS,
    );
  });
});

describe("what the buttons may do", () => {
  it("normal flow: 確認 waits for a choice, 跳過 is shown", () => {
    expect(gripControls(null, false)).toEqual({
      confirmEnabled: false,
      showSkip: true,
    });
    expect(gripControls("palm", false)).toEqual({
      confirmEnabled: true,
      showSkip: true,
    });
  });

  it("required mode hides 跳過 and keeps 確認 disabled until a choice", () => {
    expect(gripControls(null, true)).toEqual({
      confirmEnabled: false,
      showSkip: false,
    });
    expect(gripControls("claw", true)).toEqual({
      confirmEnabled: true,
      showSkip: false,
    });
  });

  it("看結果 waits for a choice, and nothing works while the scan is sent", () => {
    expect(thicknessControls(null, false)).toEqual({
      submitEnabled: false,
      skipEnabled: true,
      backEnabled: true,
    });
    expect(thicknessControls("thin", false).submitEnabled).toBe(true);
    expect(thicknessControls("thin", true)).toEqual({
      submitEnabled: false,
      skipEnabled: false,
      backEnabled: false,
    });
  });
});

describe("the pages as rendered", () => {
  const render = (node: ReturnType<typeof createElement>, locale = "zh-TW") =>
    renderToStaticMarkup(
      createElement(
        LocaleProvider,
        { initialLocale: locale as "en" | "zh-TW" },
        node,
      ),
    );
  const noop = () => {};

  it("the grip page has 跳過, and 確認 is disabled with nothing chosen", () => {
    const html = render(
      createElement(GripPage, {
        value: null,
        onChange: noop,
        onConfirm: noop,
        onSkip: noop,
        onBack: noop,
      }),
    );
    expect(html).toContain("握滑鼠的方式");
    expect(html).toContain('data-testid="grip-skip"');
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-testid="grip-confirm"/,
    );
    expect(html).toContain("1／2");
    // Three native radios, none checked.
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).not.toContain("checked");
    // Nothing chosen: the neutral picture is the active layer.
    expect(html).toMatch(
      /data-active="true"[^>]*data-testid="grip-art-neutral"/,
    );
  });

  it("required mode: no 跳過 on the page, and 確認 still waits", () => {
    const html = render(
      createElement(GripPage, {
        value: null,
        onChange: noop,
        onConfirm: noop,
        onBack: noop,
        required: true,
      }),
    );
    expect(html).not.toContain('data-testid="grip-skip"');
    expect(html).not.toContain(zhTW.skip);
    // Soft-disabled: focusable and pressable, says it is not available and
    // points at the line that says why (never a silent `disabled`).
    expect(html).toMatch(
      /<button[^>]*aria-disabled="true"[^>]*data-testid="grip-confirm"/,
    );
    expect(html).not.toMatch(
      /<button[^>]*\sdisabled=""[^>]*data-testid="grip-confirm"/,
    );
    const hintId =
      /aria-describedby="([^"]+)"[^>]*data-testid="grip-confirm"/.exec(
        html,
      )?.[1];
    expect(hintId).toBeTruthy();
    expect(html).toContain(`id="${hintId}"`);
    // The subtitle says why the grip is needed; the normal page's does not.
    expect(html).toContain(zhTW.gripSubtitleRequired);
    expect(html).not.toContain(zhTW.gripSubtitle);
    // The normal flow keeps its plain disabled button and subtitle.
    const normal = render(
      createElement(GripPage, {
        value: null,
        onChange: noop,
        onConfirm: noop,
        onSkip: noop,
        onBack: noop,
      }),
    );
    expect(normal).toMatch(
      /<button[^>]*disabled=""[^>]*data-testid="grip-confirm"/,
    );
    expect(normal).toContain(zhTW.gripSubtitle);
  });

  it("a chosen grip enables 確認 and makes its line art the active layer", () => {
    const html = render(
      createElement(GripPage, {
        value: "claw",
        onChange: noop,
        onConfirm: noop,
        onSkip: noop,
        onBack: noop,
      }),
    );
    expect(html).not.toMatch(/disabled=""[^>]*data-testid="grip-confirm"/);
    expect(html).toMatch(/data-active="true"[^>]*data-testid="grip-art-claw"/);
    expect(html).toMatch(
      /data-active="false"[^>]*data-testid="grip-art-neutral"/,
    );
  });

  it("the thickness page is in English too, with the error line when the send failed", () => {
    const html = render(
      createElement(ThicknessPage, {
        value: "medium",
        onChange: noop,
        onSubmit: noop,
        onSkip: noop,
        onBack: noop,
        busy: false,
        errorKind: "network",
        onRetake: noop,
      }),
      "en",
    );
    expect(html).toContain(en.thicknessTitle);
    expect(html).toContain(en.thicknessSubmit);
    expect(html).toContain('role="alert"');
    expect(html).toContain("No connection");
    expect(html).toContain(en.stepThickness);
  });

  it("the thickness skip keeps its visible word and is named for what it does", () => {
    const zh = render(
      createElement(ThicknessPage, {
        value: null,
        onChange: noop,
        onSubmit: noop,
        onSkip: noop,
        onBack: noop,
        busy: false,
        errorKind: null,
        onRetake: noop,
      }),
    );
    expect(zh).toMatch(
      /<button[^>]*aria-label="跳過並看結果"[^>]*data-testid="thickness-skip"[^>]*>跳過<\/button>/,
    );
    const english = render(
      createElement(ThicknessPage, {
        value: null,
        onChange: noop,
        onSubmit: noop,
        onSkip: noop,
        onBack: noop,
        busy: false,
        errorKind: null,
        onRetake: noop,
      }),
      "en",
    );
    expect(english).toMatch(
      /aria-label="Skip and see results"[^>]*data-testid="thickness-skip"[^>]*>Skip<\/button>/,
    );
    // The grip page's skip is just 跳過: it does not send anything.
    expect(
      render(
        createElement(GripPage, {
          value: null,
          onChange: noop,
          onConfirm: noop,
          onSkip: noop,
          onBack: noop,
        }),
      ),
    ).not.toContain("跳過並看結果");
  });

  it("the banner offers a retake only where the error sentence asks for a new photo", () => {
    const banner = (
      errorKind: "invalid" | "tooLarge" | "rateLimited" | "network" | "server",
    ) =>
      render(
        createElement(ThicknessPage, {
          value: "thin",
          onChange: noop,
          onSubmit: noop,
          onSkip: noop,
          onBack: noop,
          busy: false,
          errorKind,
          onRetake: noop,
        }),
      );
    for (const kind of ["invalid", "tooLarge"] as const) {
      expect(banner(kind), kind).toContain('data-testid="thickness-retake"');
      expect(banner(kind), kind).toContain("重拍");
    }
    for (const kind of ["rateLimited", "network", "server"] as const)
      expect(banner(kind), kind).not.toContain("thickness-retake");
  });

  it("for a typed hand size the banner button says Change the numbers and the sentences stop speaking of a photo", () => {
    const html = render(
      createElement(ThicknessPage, {
        value: "thin",
        onChange: noop,
        onSubmit: noop,
        onSkip: noop,
        onBack: noop,
        busy: false,
        errorKind: "invalid",
        onRetake: noop,
        retakeLabel: "Change the numbers",
        errorText: { invalid: "These numbers could not be saved." },
      }),
      "en",
    );
    expect(html).toContain("These numbers could not be saved.");
    expect(html).not.toContain("photo");
    expect(html).toMatch(
      /data-testid="thickness-retake"[^>]*>Change the numbers<\/button>/,
    );
  });

  // V3.2 F13 (Kirby 2026-10-22): the button never turns into 「傳送中…」;
  // the veil with the particle loader comes over the page instead.
  const sendingPage = (busy: boolean, locale: "zh-TW" | "en" = "zh-TW") =>
    render(
      createElement(ThicknessPage, {
        value: "thin",
        onChange: noop,
        onSubmit: noop,
        onSkip: noop,
        onBack: noop,
        busy,
        errorKind: null,
        onRetake: noop,
      }),
      locale,
    );

  it("while sending, the button keeps its word, every control is off, and the veil with the loader is up", () => {
    const html = sendingPage(true);
    expect(html).not.toContain("傳送中");
    expect(html).not.toContain("正在開啟結果");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-testid="thickness-submit"[^>]*>看結果<\/button>/,
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-testid="thickness-skip"/,
    );
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(
      /<div class="submitOverlay" data-phase="shown" data-testid="submit-overlay" aria-busy="true"/,
    );
    // F23: opaque by its CSS (the page colour), no veil opacity of its own.
    expect(html).not.toContain("--submit-veil-opacity");
    expect(html).toContain("--submit-fade-ms:220ms");
    expect(html).toMatch(/class="particleLoader submitOverlay-loader"/);
    // The loader's status says it is matching; no word about sending.
    expect(html).toContain('role="status">正在比對<');
  });

  it("in English too: no Sending anywhere while it is sent", () => {
    const html = sendingPage(true, "en");
    expect(html).not.toMatch(/Sending|Opening/);
    expect(html).toMatch(/data-testid="thickness-submit"[^>]*>See results</);
    expect(html).toContain('data-testid="submit-overlay"');
  });

  it("not sending: no veil, the button is the page's own", () => {
    const html = sendingPage(false);
    expect(html).not.toContain("submit-overlay");
    expect(html).toMatch(
      /<button[^>]*data-testid="thickness-submit"[^>]*>看結果<\/button>/,
    );
  });
});

describe("the send veil's phases (submitOverlayPhase.ts, V3.2 F13)", () => {
  it("busy shows it; a failure fades it out, then it is gone; idle stays hidden", () => {
    expect(overlayPhaseFor("hidden", true)).toBe("shown");
    expect(overlayPhaseFor("shown", true)).toBe("shown");
    expect(overlayPhaseFor("shown", false)).toBe("leaving");
    expect(overlayPhaseFor("leaving", false)).toBe("leaving");
    expect(overlayPhaseFor("hidden", false)).toBe("hidden");
    // A retry while it is still fading brings it straight back.
    expect(overlayPhaseFor("leaving", true)).toBe("shown");
  });

  it("F23: the send shows it at once and opaque; a failure still fades it out (220 ms), none under reduced motion (candidate)", () => {
    // Shown the moment the send starts, from any phase.
    for (const from of ["hidden", "leaving", "shown"] as const)
      expect(overlayPhaseFor(from, true)).toBe("shown");
    expect(SUBMIT_OVERLAY.VEIL_OPACITY).toBe(1);
    // A failure: leaving, then hidden after the fade.
    expect(overlayPhaseFor("shown", false)).toBe("leaving");
    expect(overlayFadeMs(false)).toBe(220);
    expect(overlayFadeMs(true)).toBe(0);
  });
});

const source = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");

// No DOM test library: the veil's wiring is pinned by its source, so a change
// that the static renders above cannot see (the fade timer, reduced motion,
// the leaving rule) fails here.
describe("the send veil's wiring (source pins, F13)", () => {
  it("a change of busy moves the phase with overlayPhaseFor", () => {
    const veil = source("src/client/scan/SubmitOverlay.tsx");
    expect(veil).toContain("const reducedMotion = usePrefersReducedMotion();");
    const adjust = veil.slice(
      veil.indexOf("if (busy !== seenBusy) {"),
      veil.indexOf("useEffect(() => {"),
    );
    expect(adjust).toContain("setSeenBusy(busy);");
    expect(adjust).toContain("setPhase(overlayPhaseFor(phase, busy));");
  });

  it("leaving turns hidden after overlayFadeMs(reducedMotion), not a fixed time", () => {
    const veil = source("src/client/scan/SubmitOverlay.tsx");
    const effect = veil.slice(
      veil.indexOf("useEffect(() => {"),
      veil.indexOf("}, [phase, reducedMotion]);"),
    );
    expect(effect).toContain('if (phase !== "leaving") return;');
    expect(effect).toMatch(
      /setTimeout\(\n\s*\(\) => setPhase\("hidden"\),\n\s*overlayFadeMs\(reducedMotion\),\n\s*\);/,
    );
    expect(effect).toContain("return () => clearTimeout(timer);");
    expect(effect).not.toContain("SUBMIT_OVERLAY.FADE_MS");
    expect(veil).toContain("}, [phase, reducedMotion]);");
    expect(veil).toContain('if (phase === "hidden") return null;');
  });

  it("F23: the page colour at 100 %, with no fade in (reduced motion or not)", () => {
    const css = source("src/client/scan/submit-overlay.css");
    const rule = css.slice(
      css.indexOf(".submitOverlay {"),
      css.indexOf(".submitOverlay[data-phase="),
    );
    expect(rule).toContain("background: var(--bg);");
    expect(rule).not.toMatch(/color-mix|transparent/);
    expect(rule).not.toContain("animation");
    expect(css).not.toContain("@keyframes");
    // The loader centred in the viewport, no padding: the spot the results
    // page's handed-over loader matches (`.results-page-handoff`).
    expect(rule).toContain("position: fixed;");
    expect(rule).toContain("inset: 0;");
    expect(rule).toContain("align-items: center;");
    expect(rule).toContain("justify-content: center;");
    expect(css).toMatch(
      /\.submitOverlay \.submitOverlay-loader \{\s*padding: 0;/,
    );
  });

  it("F23: while it is up it notes its loader's start, and forgets it when it goes", () => {
    const veil = source("src/client/scan/SubmitOverlay.tsx");
    const effect = veil.slice(
      veil.indexOf('if (phase !== "shown") return;'),
      veil.indexOf("}, [phase, loader]);"),
    );
    expect(effect).toContain("noteSendLoaderStart(startedAt);");
    expect(effect).toContain("return () => clearSendLoaderStart(startedAt);");
  });

  it("while it fades it is see-through and catches no taps", () => {
    const css = source("src/client/scan/submit-overlay.css");
    const rule = css.slice(
      css.indexOf('.submitOverlay[data-phase="leaving"] {'),
    );
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("opacity: 0;");
    expect(body).toContain("pointer-events: none;");
  });

  it("under reduced motion it does not fade out either", () => {
    const css = source("src/client/scan/submit-overlay.css");
    const block = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce) {"),
    );
    const rule = block.slice(
      block.indexOf(".submitOverlay {"),
      block.indexOf("}"),
    );
    expect(rule).toContain("transition: none;");
  });
});

describe("the payload", () => {
  it("a skip adds no key at all: neither answer, and never a default", () => {
    const built = buildSubmission(BASE, { grip: null, thickness: null });
    expect(built).not.toHaveProperty("gripStyleStated");
    expect(built).not.toHaveProperty("palmThicknessStated");
    expect(Object.keys(built).sort()).toEqual([
      "calibration",
      "hand",
      "measurementModelVersion",
      "measurements",
    ]);
  });

  it("only the answered question is sent", () => {
    const gripOnly = buildSubmission(BASE, { grip: "palm", thickness: null });
    expect(gripOnly.gripStyleStated).toBe("palm");
    expect(gripOnly).not.toHaveProperty("palmThicknessStated");
    const thicknessOnly = buildSubmission(BASE, {
      grip: null,
      thickness: "thin",
    });
    expect(thicknessOnly.palmThicknessStated).toBe("thin");
    expect(thicknessOnly).not.toHaveProperty("gripStyleStated");
  });

  it("both answers go through to the wire; a skipped one is not in the JSON body", async () => {
    const bodies: string[] = [];
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(
        JSON.stringify({ scanId: "623e4567-e89b-12d3-a456-426614174010" }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    await submitScan(
      buildSubmission(BASE, { grip: "claw", thickness: "thick" }),
      fakeFetch,
    );
    await submitScan(
      buildSubmission(BASE, { grip: null, thickness: null }),
      fakeFetch,
    );
    const answered = JSON.parse(bodies[0]);
    expect(answered.gripStyleStated).toBe("claw");
    expect(answered.palmThicknessStated).toBe("thick");
    const skipped = JSON.parse(bodies[1]);
    expect(skipped).not.toHaveProperty("gripStyleStated");
    expect(skipped).not.toHaveProperty("palmThicknessStated");
    expect(bodies[1]).not.toContain("medium");
  });

  it("an answer the measured submission already carried is replaced, or dropped", () => {
    const carried = scanSubmissionSchema.parse({
      ...BASE,
      gripStyleStated: "palm",
      palmThicknessStated: "thick",
    });
    const dropped = buildSubmission(carried, { grip: null, thickness: null });
    expect(dropped).not.toHaveProperty("gripStyleStated");
    expect(dropped).not.toHaveProperty("palmThicknessStated");
    expect(
      buildSubmission(carried, { grip: "claw", thickness: null })
        .gripStyleStated,
    ).toBe("claw");
  });
});
