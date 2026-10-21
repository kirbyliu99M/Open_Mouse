/**
 * The particle loader's markup (V3.2 U1, brief B.2): no text or number on
 * screen, exactly one `role="status"` that says the working words, then the
 * done words, never a percentage; and the results page's loading screen is
 * the loader, not the old 「正在載入你的結果…」 line.
 *
 * Rendered with renderToStaticMarkup: effects never run on the server, so the
 * canvas stays blank and only the markup is checked.
 */
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ scanId: "scan-1" }),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/results/scan-1",
}));

import { ParticleLoader } from "../../src/components/loading/ParticleLoader";
import { LocaleProvider as Provider } from "../../src/client/i18n/LocaleProvider";
import { ResultsScanProvider as ScanProvider } from "../../src/app/results/[scanId]/ResultsScanProvider";
import { loadingCopy } from "../../src/lib/copy/loading";
import {
  LOADING_TIMING,
  type LoaderInput,
} from "../../src/lib/particles/loading";
import type { Locale } from "../../src/lib/contracts/locale";

const LocaleProvider = Provider as unknown as FunctionComponent<{
  initialLocale: Locale;
}>;

// createElement's typing wants `children` among the props; they are passed as
// an extra argument instead (the lint rule's way).
const ResultsScanProvider = ScanProvider as unknown as FunctionComponent<{
  scanId: string;
  anonymous: boolean;
}>;

const LOCALES: readonly Locale[] = ["zh-TW", "en"];

function input(arrival: LoaderInput["arrival"]): LoaderInput {
  return {
    startedAt: 0,
    minMs: LOADING_TIMING.MIN_DISPLAY_FIT_MS,
    steps: null,
    arrival,
  };
}

function loaderHtml(locale: Locale, arrival: LoaderInput["arrival"]): string {
  return renderToStaticMarkup(
    createElement(ParticleLoader, {
      input: input(arrival),
      status: loadingCopy(locale).fit,
    }),
  );
}

/** The text of every `role="status"` element (they hold no markup). */
function statusTexts(html: string): string[] {
  return [...html.matchAll(/<p[^>]*role="status"[^>]*>([^<]*)<\/p>/g)].map(
    (m) => m[1]!,
  );
}

/** All text outside the loader's status paragraph. */
function textOutsideStatus(html: string): string {
  const withoutStatus = html.replace(
    /<p class="particleLoader-status"[^>]*>[^<]*<\/p>/,
    "",
  );
  return withoutStatus.replace(/<[^>]*>/g, "");
}

describe.each(LOCALES)("ParticleLoader markup (%s)", (locale) => {
  const words = loadingCopy(locale).fit;

  it("has exactly one role=status, and it says the working words while waiting", () => {
    const html = loaderHtml(locale, null);
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(statusTexts(html)).toEqual([words.working]);
    expect(html).toContain('class="particleLoader-status"');
  });

  it("says the done words once the answer is a result", () => {
    expect(statusTexts(loaderHtml(locale, { at: 100, ok: true }))).toEqual([
      words.done,
    ]);
  });

  it("says nothing after a failure (the error speaks)", () => {
    expect(statusTexts(loaderHtml(locale, { at: 100, ok: false }))).toEqual([
      "",
    ]);
  });

  it("puts no text and no number anywhere outside the status region, and never a percentage", () => {
    for (const arrival of [
      null,
      { at: 100, ok: true },
      { at: 100, ok: false },
    ] as const) {
      const html = loaderHtml(locale, arrival);
      expect(textOutsideStatus(html).trim()).toBe("");
      // The status words themselves carry no digit and no %.
      for (const said of statusTexts(html)) expect(said).not.toMatch(/[\d%]/);
      expect(html).not.toContain("%");
      // The canvas is hidden from screen readers.
      expect(html).toMatch(/<canvas[^>]*aria-hidden="true"/);
    }
  });
});

describe.each(LOCALES)(
  "the results page while the fit loads (%s)",
  (locale) => {
    const html = renderToStaticMarkup(
      createElement(
        LocaleProvider,
        { initialLocale: locale },
        createElement(
          ResultsScanProvider,
          { scanId: "scan-1", anonymous: true },
          null,
        ),
      ),
    );

    // F7 (Kirby's phone test 2026-10-21): the loader appears only once the
    // fit has taken 300 ms (`fitReveal`, tested in particles-loading.test.ts),
    // so the first frame has none: a quick answer is shown without a loader
    // flashing up first.
    it("draws no loader in its first frame, and not the old loading line", () => {
      expect(html).not.toContain("particleLoader");
      expect(html).toContain('class="results-page-pending" aria-busy="true"');
      // The old line's words (removed from results-screens.ts in V3.2 F6).
      expect(html).not.toContain(
        locale === "zh-TW" ? "正在載入你的結果…" : "Loading your results…",
      );
    });

    it("has no status region of its own before the loader appears", () => {
      expect(html.match(/role="status"/g)).toBeNull();
    });
  },
);
