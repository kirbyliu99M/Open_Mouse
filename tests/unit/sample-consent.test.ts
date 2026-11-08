/**
 * The "keep these numbers anonymously" switch (hand-sample.ts, candidate):
 * the stored preference (default ON, only OFF remembered, storage failures
 * read as ON), the one rule that adds `sampleNotice` to a submission, and the
 * switch as rendered on the screens that send a scan.
 */
import { readFileSync } from "node:fs";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import { LocaleProvider as Provider } from "../../src/client/i18n/LocaleProvider";
import { ThicknessPage } from "../../src/client/scan/AnswerPages";
import { SampleConsentToggle } from "../../src/client/scan/SampleConsentToggle";
import {
  readSampleConsent,
  resetSampleConsentMemory,
  SAMPLE_OPT_OUT_KEY,
  sampleConsentOn,
  setSampleConsent,
  withSampleNotice,
  writeSampleConsent,
  type SampleConsentStorage,
} from "../../src/client/scan/sampleConsent";
import { HAND_SAMPLE_NOTICE_VERSION } from "../../src/lib/contracts/hand-sample";
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
  type ScanSubmission,
} from "../../src/lib/contracts/measurement";
import { en, zhTW } from "../../src/lib/copy/hand-sample";
import ScanSubmitPanel from "../../src/app/scan/ScanSubmitPanel";

const LocaleProvider = Provider as unknown as FunctionComponent<{
  initialLocale: "en" | "zh-TW";
}>;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: SampleConsentStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
  return { storage, data };
}

const throwing: SampleConsentStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

const SUBMISSION: ScanSubmission = scanSubmissionSchema.parse({
  hand: "right",
  measurements: { handLengthMm: 186, palmLengthMm: 106, palmWidthMm: 82 },
  calibration: {
    method: "user-length",
    referenceMeasurement: "handLengthMm",
    referenceMm: 186,
    parallaxCorrected: false,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
});

describe("the stored preference", () => {
  it("is ON by default, and with no storage at all", () => {
    expect(readSampleConsent(memoryStorage().storage)).toBe(true);
    expect(readSampleConsent(null)).toBe(true);
  });

  it("remembers only OFF, and ON forgets it", () => {
    const { storage, data } = memoryStorage();
    writeSampleConsent(storage, false);
    expect(data.get(SAMPLE_OPT_OUT_KEY)).toBe("1");
    expect(readSampleConsent(storage)).toBe(false);
    writeSampleConsent(storage, true);
    expect(data.has(SAMPLE_OPT_OUT_KEY)).toBe(false);
    expect(readSampleConsent(storage)).toBe(true);
  });

  it("reads anything but '1' as ON", () => {
    expect(
      readSampleConsent(memoryStorage({ [SAMPLE_OPT_OUT_KEY]: "0" }).storage),
    ).toBe(true);
  });

  it("never throws on blocked storage: it reads ON and drops the write", () => {
    expect(readSampleConsent(throwing)).toBe(true);
    expect(() => writeSampleConsent(throwing, false)).not.toThrow();
  });

  it("this page's choice wins over storage it could not write (no window here)", () => {
    resetSampleConsentMemory();
    expect(sampleConsentOn()).toBe(true);
    setSampleConsent(false);
    expect(sampleConsentOn()).toBe(false);
    setSampleConsent(true);
    expect(sampleConsentOn()).toBe(true);
    resetSampleConsentMemory();
  });
});

describe("withSampleNotice: the only way a submission asks for a copy", () => {
  it("adds the current notice only when the notice was shown AND the switch is on", () => {
    expect(
      withSampleNotice(SUBMISSION, { noticeShown: true, on: true })
        .sampleNotice,
    ).toBe(HAND_SAMPLE_NOTICE_VERSION);
    for (const state of [
      { noticeShown: true, on: false },
      { noticeShown: false, on: true },
      { noticeShown: false, on: false },
    ]) {
      const sent = withSampleNotice(SUBMISSION, state);
      expect("sampleNotice" in sent, JSON.stringify(state)).toBe(false);
    }
  });

  it("strips a notice the submission already carried when it must not ask", () => {
    const carried: ScanSubmission = {
      ...SUBMISSION,
      sampleNotice: HAND_SAMPLE_NOTICE_VERSION,
    };
    const sent = withSampleNotice(carried, { noticeShown: false, on: true });
    expect("sampleNotice" in sent).toBe(false);
    // The input is not changed.
    expect(carried.sampleNotice).toBe(HAND_SAMPLE_NOTICE_VERSION);
  });

  it("what it sends passes the contract's schema either way", () => {
    for (const on of [true, false]) {
      expect(
        scanSubmissionSchema.safeParse(
          withSampleNotice(SUBMISSION, { noticeShown: true, on }),
        ).success,
      ).toBe(true);
    }
  });
});

describe("the switch as rendered", () => {
  const render = (node: ReturnType<typeof createElement>, locale = "zh-TW") =>
    renderToStaticMarkup(
      createElement(
        LocaleProvider,
        { initialLocale: locale as "en" | "zh-TW" },
        node,
      ),
    );
  const notice = () => () => {};

  beforeEach(() => resetSampleConsentMemory());

  it("is an accessible switch, ON at first render, named by its label and described by the short sentence", () => {
    const html = render(createElement(SampleConsentToggle, { notice }));
    expect(html).toMatch(/<button[^>]*role="switch"[^>]*aria-checked="true"/);
    const labelId = /<label id="([^"]+)"/.exec(html)![1]!;
    const shortId = new RegExp(`<span id="([^"]+)">${zhTW.short}</span>`).exec(
      html,
    )![1]!;
    expect(html).toContain(`aria-labelledby="${labelId}"`);
    expect(html).toContain(`aria-describedby="${shortId}"`);
    expect(html).toContain(zhTW.label);
  });

  it("shows two layers: the short sentence and 詳細說明 open, the details closed until asked", () => {
    const html = render(createElement(SampleConsentToggle, { notice }));
    const detailsId = /<p id="([^"]+)" class="sampleConsentDetails"/.exec(
      html,
    )![1]!;
    expect(html).toMatch(
      new RegExp(
        `<button type="button" class="sampleConsentMore" aria-expanded="false" aria-controls="${detailsId}"[^>]*>詳細說明</button>`,
      ),
    );
    expect(html).toMatch(
      /<p id="[^"]+" class="sampleConsentDetails" hidden=""/,
    );
    // The details are in the page (reachable from the button), with the
    // privacy link that says it opens a new tab.
    expect(html).toContain(zhTW.details);
    expect(html).toMatch(
      /<a href="\/privacy" target="_blank" rel="noopener">隱私權政策<span class="sampleConsentSr">（另開新分頁）<\/span><\/a>/,
    );
  });

  it("speaks English with the English table, and links the English privacy page", () => {
    const html = render(createElement(SampleConsentToggle, { notice }), "en");
    expect(html).toContain(en.label);
    expect(html).toContain(en.short);
    expect(html).toContain(">Details</button>");
    expect(html).toContain(en.details.replace(/'/g, "&#x27;"));
    expect(html).toMatch(
      /<a href="\/en\/privacy" target="_blank" rel="noopener">Privacy policy<span class="sampleConsentSr">\(opens in a new tab\)<\/span><\/a>/,
    );
  });

  it("keeps state visible under forced colours", () => {
    const css = readFileSync("src/client/scan/sample-consent.css", "utf8");
    const forced = /@media \(forced-colors: active\) \{([\s\S]*?)\n\}/.exec(
      css,
    )![1]!;
    expect(forced).toContain('[aria-checked="true"] .sampleConsentTrack');
    expect(forced).toContain("Highlight");
    expect(forced).toContain("ButtonText");
  });

  it("keeps Details' hit area inside its own box, under the switch row (review J1)", () => {
    const css = readFileSync(
      "src/client/scan/sample-consent.css",
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (selector: string) =>
      new RegExp(
        `(?:^|\\n)${selector.replace(/\./g, "\\.")} \\{([^}]*)\\}`,
      ).exec(css)?.[1] ?? "";
    // No stretched pseudo-element: the button's own 44 px box is the target.
    expect(css).not.toMatch(/\.sampleConsentMore::(after|before)/);
    const more = rule(".sampleConsentMore");
    expect(more).toContain("min-height: 2.75rem");
    expect(more).toContain("display: inline-flex");
    // ...without making its line taller (review M1): the margin box is one
    // line tall, and the sentence's bottom padding holds the overflow.
    expect(more).toContain("margin-block: calc((1lh - 2.75rem) / 2)");
    expect(rule(".sampleConsentShort")).toContain("padding-bottom: 0.625rem");
    // A transparent border, shown under prefers-contrast: more (J3).
    expect(more).toContain("border: 1px solid transparent");
    expect(css).toMatch(
      /@media \(prefers-contrast: more\) \{\s*\.sampleConsentMore \{\s*border-color: currentColor;/,
    );
    // The switch row stacks above the sentence.
    const row = rule(".sampleConsentRow");
    expect(row).toContain("position: relative");
    expect(row).toContain("z-index: 1");
  });

  it("is disabled while the scan is being sent", () => {
    const html = render(
      createElement(SampleConsentToggle, { notice, disabled: true }),
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-testid="sample-consent-switch"/,
    );
  });

  it("sits right above 看結果 on the thickness page, the easy scan's send page", () => {
    const html = render(
      createElement(ThicknessPage, {
        value: "thin",
        onChange: () => {},
        onSubmit: () => {},
        onSkip: () => {},
        onBack: () => {},
        busy: false,
        errorKind: null,
        onRetake: () => {},
        sampleNotice: notice,
      }),
    );
    const at = html.indexOf('data-testid="sample-consent"');
    const submit = html.indexOf('data-testid="thickness-submit"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(submit);
    // Nothing else of the page sits between the switch's block and the button.
    expect(html.slice(at, submit)).not.toContain("thickness-retake");
  });

  it("sits right above the send button of the printed-sheet panel", () => {
    const html = render(
      createElement(ScanSubmitPanel, { submission: SUBMISSION }),
    );
    const at = html.indexOf('data-testid="sample-consent"');
    const submit = html.indexOf('data-testid="submit-scan-button"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(submit);
  });

  it("uses only token colours in its stylesheet", () => {
    const css = readFileSync(
      "src/client/scan/sample-consent.css",
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/i);
  });

  it("is wired on every screen that sends: ScanSubmitPanel and the easy scan's thickness page", () => {
    const panel = readFileSync("src/app/scan/ScanSubmitPanel.tsx", "utf8");
    expect(panel).toContain("<SampleConsentToggle notice={sampleNotice}");
    const camera = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");
    expect(camera).toContain("sampleNotice={sampleNotice}");
    // The easy scan sends only from the thickness page (paper, card and typed
    // numbers alike), so one ThicknessPage covers all three.
    expect(camera.match(/<ThicknessPage\b/g)).toHaveLength(1);
    expect(camera.match(/submitScanNow\(/g)?.length).toBe(2);
  });
});
