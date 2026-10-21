/**
 * V3.2 F13 (candidate): after a 412 the new ranking replaces the old one in
 * place and a short line at the top says 「結果已更新。」; it fades by itself
 * or can be closed. The feedback sheet keeps what was typed: it is keyed by
 * the scan, not the ranking (result-fingerprint.test.ts pins that), and the
 * line floats over the page, so nothing under it is re-mounted.
 */
import { readFileSync } from "node:fs";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import type { FitResponse } from "../../src/lib/contracts/fit";
import { FIXTURES } from "../../src/components/results/fixtures";
import {
  RANKING_UPDATED_NOTICE,
  noticeFadeMs,
  noticePhaseAt,
  rankingUpdatedNoticeDue,
} from "../../src/components/results/rankingUpdatedNotice";
import { ResultsUpdatedNotice } from "../../src/components/results/ResultsUpdatedNotice";
import {
  refreshShownFit,
  type ShownRankingRefs,
} from "../../src/components/results/shownRanking";
import { en, zhTW } from "../../src/lib/copy/results-screens";

const BASE = FIXTURES["high-confidence"];
const FIT_A: FitResponse = { ...BASE, resultFingerprint: "aaaaaaaaaaaaaaaa" };
const FIT_B: FitResponse = { ...BASE, resultFingerprint: "bbbbbbbbbbbbbbbb" };
const NO_FP: FitResponse = { ...BASE, resultFingerprint: undefined };

describe("when the line is due (rankingUpdatedNoticeDue)", () => {
  it("a new fingerprint: yes; the same one: no; no fit before: no", () => {
    expect(rankingUpdatedNoticeDue(FIT_A, FIT_B)).toBe(true);
    expect(rankingUpdatedNoticeDue(FIT_A, { ...FIT_A })).toBe(false);
    expect(rankingUpdatedNoticeDue(null, FIT_B)).toBe(false);
  });

  it("without a fingerprint on either side it cannot tell, so the 412 is believed", () => {
    expect(rankingUpdatedNoticeDue(NO_FP, FIT_B)).toBe(true);
    expect(rankingUpdatedNoticeDue(FIT_A, NO_FP)).toBe(true);
  });
});

describe("its timing (noticePhaseAt, candidate values)", () => {
  const fade = RANKING_UPDATED_NOTICE.FADE_MS;
  const visible = RANKING_UPDATED_NOTICE.VISIBLE_MS;

  it("stays, fades by itself, then is gone", () => {
    expect(noticePhaseAt(0, null, fade)).toBe("shown");
    expect(noticePhaseAt(visible - 1, null, fade)).toBe("shown");
    expect(noticePhaseAt(visible, null, fade)).toBe("leaving");
    expect(noticePhaseAt(visible + fade, null, fade)).toBe("gone");
  });

  it("closing starts the fade at once; under reduced motion it just goes", () => {
    expect(noticePhaseAt(1000, 1000, fade)).toBe("leaving");
    expect(noticePhaseAt(1000 + fade, 1000, fade)).toBe("gone");
    expect(noticeFadeMs(true)).toBe(0);
    expect(noticeFadeMs(false)).toBe(220);
    expect(noticePhaseAt(1000, 1000, noticeFadeMs(true))).toBe("gone");
  });
});

describe("the line", () => {
  const Notice = ResultsUpdatedNotice as unknown as FunctionComponent<{
    language: "zh-TW" | "en";
    onGone: () => void;
  }>;
  const render = (language: "zh-TW" | "en") =>
    renderToStaticMarkup(createElement(Notice, { language, onGone: () => {} }));

  it("says the results were updated, as a status, with a named close button", () => {
    const zh = render("zh-TW");
    expect(zh).toContain('data-testid="results-updated-notice"');
    expect(zh).toContain('data-phase="shown"');
    expect(zh).toContain('<p role="status">結果已更新。</p>');
    expect(zh).toMatch(/<button type="button"[^>]*aria-label="關閉提示"/);
    const english = render("en");
    expect(english).toContain("Your results were updated.");
    expect(english).toContain('aria-label="Close this message"');
    expect(zhTW.rankingUpdated.text).toBe("結果已更新。");
    expect(en.rankingUpdated.text).toBe("Your results were updated.");
  });
});

describe("after a 412 (the provider's in-place refresh)", () => {
  it("show is told the fit it replaces, so the line can tell a change from none", async () => {
    const refs: ShownRankingRefs = {
      shown: { current: FIT_A },
      generation: { current: 0 },
      inflight: { current: null },
    };
    const shows: [FitResponse, FitResponse | null][] = [];
    await refreshShownFit(
      refs,
      async () => ({ status: "ready", response: FIT_B }),
      (fit, previous) => shows.push([fit, previous]),
    );
    expect(shows).toEqual([[FIT_B, FIT_A]]);
    const [fit, previous] = shows[0]!;
    expect(rankingUpdatedNoticeDue(previous, fit)).toBe(true);
  });

  // No DOM test library: the provider's wiring is pinned by its source, as
  // result-fingerprint.test.ts does for the same file.
  it("the provider puts the new fit on screen, bumps the line when it is due, and draws it over the page", () => {
    const provider = readFileSync(
      "src/app/results/[scanId]/ResultsScanProvider.tsx",
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(provider).toMatch(
      /const show = \(response: FitResponse, previous: FitResponse \| null\) => \{\n\s*setPageState\(\{ kind: "ready", response \}\);\n\s*if \(rankingUpdatedNoticeDue\(previous, response\)\)\n\s*setUpdatedNotice\(\(n\) => n \+ 1\);/,
    );
    expect(provider).toMatch(
      /\{updatedNotice > 0 && \(\n\s*<ResultsUpdatedNotice\n\s*key=\{updatedNotice\}/,
    );
    // The line comes before the page, inside the same <main>: the page itself
    // (and the feedback sheet in it) is not re-mounted.
    const ready = provider.slice(
      provider.indexOf('<main className="resultsMain results-entered">'),
    );
    expect(ready.indexOf("<ResultsUpdatedNotice")).toBeLessThan(
      ready.indexOf("{children}"),
    );
  });
});
