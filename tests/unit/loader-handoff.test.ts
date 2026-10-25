/**
 * V3.2 F23 (Kirby's phone test 2026-10-25, candidate / 未拍板): one loader from
 * the last question page to the results. The send veil's loader start is
 * handed to the results page through module memory (`loaderHandoff.ts`); the
 * results page draws its loader at once, from that start, centred like the
 * veil's. Without a handoff the F7 rule stays: nothing before 300 ms.
 */
import { readFileSync } from "node:fs";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ scanId: "scan-1" }),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/results/scan-1",
}));

import {
  clearSendLoaderStart,
  handedFitReveal,
  noteLoaderHandoff,
  noteSendLoaderStart,
  peekLoaderHandoff,
  takeLoaderHandoff,
} from "../../src/lib/results/loaderHandoff";
import {
  LOADING_TIMING,
  fitReveal,
  loaderStep,
  waitingProgress,
  type LoaderInput,
} from "../../src/lib/particles/loading";
import { LocaleProvider as Provider } from "../../src/client/i18n/LocaleProvider";
import { ResultsScanProvider as ScanProvider } from "../../src/app/results/[scanId]/ResultsScanProvider";
import type { Locale } from "../../src/lib/contracts/locale";

const LocaleProvider = Provider as unknown as FunctionComponent<{
  initialLocale: Locale;
}>;
const ResultsScanProvider = ScanProvider as unknown as FunctionComponent<{
  scanId: string;
  anonymous: boolean;
}>;

/** Clears whatever an earlier test left in the module memory. */
function reset() {
  noteSendLoaderStart(-1);
  clearSendLoaderStart(-1);
  noteLoaderHandoff("none");
  takeLoaderHandoff("none");
}

describe("the handoff module (loaderHandoff.ts)", () => {
  beforeEach(reset);

  it("the veil's start goes to the stored scan, and is read once: the same scan takes it, then nothing", () => {
    noteSendLoaderStart(1234);
    noteLoaderHandoff("scan-1");
    // Peeking reads without clearing (a render may peek more than once).
    expect(peekLoaderHandoff("scan-1")).toBe(1234);
    expect(peekLoaderHandoff("scan-1")).toBe(1234);
    expect(takeLoaderHandoff("scan-1")).toBe(1234);
    expect(takeLoaderHandoff("scan-1")).toBeNull();
    expect(peekLoaderHandoff("scan-1")).toBeNull();
  });

  it("another scan's page does not use it, and clears it", () => {
    noteSendLoaderStart(500);
    noteLoaderHandoff("scan-1");
    expect(peekLoaderHandoff("scan-2")).toBeNull();
    expect(takeLoaderHandoff("scan-2")).toBeNull();
    expect(takeLoaderHandoff("scan-1")).toBeNull();
  });

  it("no veil up (the printed sheet's send): nothing is handed over", () => {
    noteLoaderHandoff("scan-1");
    expect(takeLoaderHandoff("scan-1")).toBeNull();
  });

  it("a veil that went (a failed send) leaves nothing behind; only its own start is cleared", () => {
    noteSendLoaderStart(100);
    clearSendLoaderStart(100);
    noteLoaderHandoff("scan-1");
    expect(takeLoaderHandoff("scan-1")).toBeNull();
    // A newer veil's start survives an older veil's cleanup.
    noteSendLoaderStart(300);
    clearSendLoaderStart(100);
    noteLoaderHandoff("scan-1");
    expect(takeLoaderHandoff("scan-1")).toBe(300);
  });

  it("the veil unmounting after the handoff (the page switch) keeps the handed start", () => {
    noteSendLoaderStart(700);
    noteLoaderHandoff("scan-1");
    clearSendLoaderStart(700);
    expect(takeLoaderHandoff("scan-1")).toBe(700);
  });

  it("a later send without a veil drops an older handoff", () => {
    noteSendLoaderStart(700);
    noteLoaderHandoff("scan-1");
    noteLoaderHandoff("scan-2");
    expect(takeLoaderHandoff("scan-1")).toBeNull();
  });
});

describe("the fit's reveal with a handed-over loader (handedFitReveal)", () => {
  it("a quick answer still goes through the loader: it fills and fades (450 ms)", () => {
    const tail = LOADING_TIMING.FILL_MS + LOADING_TIMING.FADE_OUT_MS;
    expect(handedFitReveal(1000, 1100, true)).toEqual({
      loaderShownAt: 1000,
      revealAt: 1100 + tail,
    });
    // Without a handoff the same quick answer is shown at once (F7).
    expect(fitReveal(1000, 1100, true)).toEqual({
      loaderShownAt: null,
      revealAt: 1100,
    });
  });

  it("a failure stops it at once, with no minimum time", () => {
    expect(handedFitReveal(1000, 1600, false)).toEqual({
      loaderShownAt: 1000,
      revealAt: 1600,
    });
  });

  it("an answer stamped before the start is treated as at the start", () => {
    expect(handedFitReveal(1000, 900, false).revealAt).toBe(1000);
  });
});

describe("the loader goes on where it was (loaderStep's first frame, F23)", () => {
  const handed: LoaderInput = {
    startedAt: 1000,
    minMs: LOADING_TIMING.MIN_DISPLAY_FIT_MS,
    steps: null,
    arrival: null,
  };

  it("a loader drawn first 900 ms after its start shows the ring where the wait is, not from 0", () => {
    const now = 1900;
    const first = loaderStep({ shown: 0, lastAt: 0 }, handed, now, false);
    expect(first.state.shown).toBeCloseTo(waitingProgress(handed, now), 10);
    expect(first.state.shown).toBeGreaterThan(0.4);
  });

  it("a loader drawn first at its own start is at 0, as before", () => {
    const first = loaderStep({ shown: 0, lastAt: 0 }, handed, 1000, false);
    expect(first.state.shown).toBe(0);
  });
});

describe.each(["zh-TW", "en"] as const)(
  "the results page's first frame (%s)",
  (locale) => {
    beforeEach(reset);
    const render = (scanId: string) =>
      renderToStaticMarkup(
        createElement(
          LocaleProvider,
          { initialLocale: locale },
          createElement(ResultsScanProvider, { scanId, anonymous: true }, null),
        ),
      );

    it("straight after the send: the loader is there at once, centred like the veil's", () => {
      noteSendLoaderStart(0);
      noteLoaderHandoff("scan-1");
      const html = render("scan-1");
      expect(html).toContain('<div class="results-page-handoff">');
      expect(html).toContain(
        'class="particleLoader results-page-handoffLoader"',
      );
      expect(html).not.toContain("results-page-pending");
      expect(html.match(/role="status"/g)).toHaveLength(1);
      // The render only peeks: the fit effect is what takes it.
      expect(peekLoaderHandoff("scan-1")).toBe(0);
    });

    it("another scan's handoff, or none: the 300 ms rule, nothing drawn yet", () => {
      noteSendLoaderStart(0);
      noteLoaderHandoff("scan-2");
      for (const html of [render("scan-1"), (reset(), render("scan-1"))]) {
        expect(html).not.toContain("particleLoader");
        expect(html).toContain('class="results-page-pending" aria-busy="true"');
      }
    });
  },
);

const source = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("the wiring (source pins, F23)", () => {
  it("the fit effect takes the handoff once per mount, and only its first request uses it", () => {
    const provider = source("src/app/results/[scanId]/ResultsScanProvider.tsx");
    const effect = provider.slice(
      provider.indexOf("const requestedAt = performance.now();"),
      provider.indexOf("refreshInflightRef.current = null;"),
    );
    expect(effect).toContain("if (handoffRef.current === undefined) {");
    expect(effect).toContain("takeLoaderHandoff(scanId)");
    expect(effect).toMatch(
      /attempt === 0 && handoffRef\.current\?\.scanId === scanId/,
    );
    expect(effect).toContain(
      "const shownAt = handed ?? requestedAt + LOADING_TIMING.FIT_SHOW_AFTER_MS;",
    );
    expect(effect).toContain("setLoaderVisible(handed !== null);");
    expect(effect).toContain("handedFitReveal(handed, arrivedAt, ok)");
  });

  it("the results page's handed loader sits where the veil's does: fixed, the viewport's centre, no padding", () => {
    const css = source("src/components/results/results.css");
    const rule = css.slice(
      css.indexOf(".results-page-handoff {"),
      css.indexOf(".results-page-handoff .results-page-handoffLoader {"),
    );
    for (const line of [
      "position: fixed;",
      "inset: 0;",
      "display: flex;",
      "align-items: center;",
      "justify-content: center;",
    ])
      expect(rule).toContain(line);
    expect(css).toMatch(
      /\.results-page-handoff \.results-page-handoffLoader \{\s*padding: 0;/,
    );
  });

  it("useScanSubmit hands the veil's start over before it pushes, next to F11's handoff", () => {
    const hook = source("src/client/scan/useScanSubmit.ts");
    const handoff = hook.indexOf("noteLoaderHandoff(outcome.scanId);");
    expect(handoff).toBeGreaterThan(
      hook.indexOf("noteScanHandoff(outcome.scanId);"),
    );
    expect(handoff).toBeLessThan(hook.indexOf("router.push(resultsPagePath("));
  });
});
