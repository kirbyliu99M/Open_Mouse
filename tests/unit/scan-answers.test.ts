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
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-testid="grip-confirm"/,
    );
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
      }),
      "en",
    );
    expect(html).toContain(en.thicknessTitle);
    expect(html).toContain(en.thicknessSubmit);
    expect(html).toContain('role="alert"');
    expect(html).toContain("No connection");
    expect(html).toContain(en.stepThickness);
  });

  it("while sending, the button says so and every control is off", () => {
    const html = render(
      createElement(ThicknessPage, {
        value: "thin",
        onChange: noop,
        onSubmit: noop,
        onSkip: noop,
        onBack: noop,
        busy: true,
        errorKind: null,
      }),
    );
    expect(html).toContain("傳送中…");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-testid="thickness-submit"/,
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-testid="thickness-skip"/,
    );
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
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
