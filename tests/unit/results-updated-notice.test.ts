/**
 * V3.2 F13 (candidate): after a 412 the new ranking replaces the old one in
 * place and a short line at the top says 「結果已更新。」; it fades by itself
 * or can be closed. The feedback sheet keeps what was typed: it is keyed by
 * the scan and the page above it by the card, neither by the ranking ("the
 * feedback sheet keeps what was typed" below pins both keys), and the line
 * floats over the page, so nothing under it is re-mounted.
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
  noticeStep,
  rankingUpdatedNoticeDue,
  type NoticePhase,
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

/**
 * Drives `noticeStep` the way the component's effect does, on a fake clock
 * whose timers fire `early` ms before the delay asked for (a truncated
 * fraction, or a browser that fires a little early). Returns when onGone ran
 * and the phases it went through, or null if the line never went.
 */
function runNotice(opts: {
  fadeMs: number;
  early: number;
  closeAt?: number;
}): { goneAt: number; phases: NoticePhase[] } | null {
  // A fractional start, as performance.now() gives.
  let clock = 1234.37;
  const shownAt = clock;
  let phase: NoticePhase = "shown";
  let closedAt: number | null = null;
  const phases: NoticePhase[] = [phase];
  for (let steps = 0; steps < 50; steps++) {
    const step = noticeStep(phase, clock - shownAt, closedAt, opts.fadeMs);
    if (step.kind === "gone") return { goneAt: clock - shownAt, phases };
    if (step.kind === "set") {
      phase = step.phase;
      phases.push(phase);
      continue;
    }
    const fireAt = clock + Math.max(0, Math.trunc(step.ms) - opts.early);
    if (
      opts.closeAt !== undefined &&
      closedAt === null &&
      shownAt + opts.closeAt <= fireAt
    ) {
      // The × was pressed before the timer fired: the timer is cleared and
      // the effect reruns with closedAt.
      clock = shownAt + opts.closeAt;
      closedAt = opts.closeAt;
      continue;
    }
    clock = fireAt;
    phase = step.then;
    phases.push(phase);
  }
  return null;
}

describe("the line always goes (noticeStep on an early timer)", () => {
  const fade = RANKING_UPDATED_NOTICE.FADE_MS;
  const visible = RANKING_UPDATED_NOTICE.VISIBLE_MS;

  it("fades by itself and goes even when every timer fires early", () => {
    for (const early of [0, 1, 3]) {
      const run = runNotice({ fadeMs: fade, early });
      expect(run).not.toBeNull();
      expect(run!.phases).toEqual(["shown", "leaving", "gone"]);
      expect(run!.goneAt).toBeGreaterThanOrEqual(visible + fade - 2 * early);
      expect(run!.goneAt).toBeLessThanOrEqual(visible + fade + 1);
    }
  });

  it("never steps back to an earlier phase when the clock is behind", () => {
    // The timer moved it to leaving 0.6 ms before the clock reached 4000.
    expect(noticeStep("leaving", visible - 0.6, null, fade)).toEqual({
      kind: "wait",
      ms: fade + 1,
      then: "gone",
    });
    expect(noticeStep("gone", visible - 0.6, null, fade)).toEqual({
      kind: "gone",
    });
  });

  it("waits whole milliseconds, rounded up; a late wake moves on at once", () => {
    expect(noticeStep("shown", 0.04, null, fade)).toEqual({
      kind: "wait",
      ms: visible,
      then: "leaving",
    });
    expect(noticeStep("shown", visible + 5, null, fade)).toEqual({
      kind: "set",
      phase: "leaving",
    });
    expect(noticeStep("leaving", visible + fade + 5, null, fade)).toEqual({
      kind: "set",
      phase: "gone",
    });
  });

  it("closing fades it at once; under reduced motion it goes at once", () => {
    const closed = runNotice({ fadeMs: fade, early: 1, closeAt: 1200 });
    expect(closed!.phases).toEqual(["shown", "leaving", "gone"]);
    expect(closed!.goneAt).toBeLessThanOrEqual(1200 + fade + 1);
    expect(noticeStep("shown", 1200, 1200, 0)).toEqual({
      kind: "set",
      phase: "gone",
    });
    const reduced = runNotice({ fadeMs: 0, early: 1 });
    expect(reduced!.phases).toEqual(["shown", "gone"]);
    const reducedClosed = runNotice({ fadeMs: 0, early: 1, closeAt: 900 });
    expect(reducedClosed!.phases).toEqual(["shown", "gone"]);
    expect(reducedClosed!.goneAt).toBeCloseTo(900, 6);
  });
});

const source = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");

// No DOM test library: the component's wiring is pinned by its source.
describe("the line's wiring (source pins)", () => {
  it("the effect steps with noticeStep; the timer moves to the next phase without re-reading the clock", () => {
    const notice = source("src/components/results/ResultsUpdatedNotice.tsx");
    const effect = notice.slice(
      notice.indexOf("useEffect(() => {"),
      notice.indexOf("}, [closedAt, fadeMs, phase]);"),
    );
    expect(effect).toMatch(/const step = noticeStep\(\n\s*phase,/);
    expect(effect).toMatch(
      /if \(step\.kind === "set"\) \{\n\s*setPhase\(step\.phase\);/,
    );
    expect(effect).toMatch(
      /if \(step\.kind === "gone"\) \{\n\s*onGoneRef\.current\(\);/,
    );
    expect(effect).toContain(
      "const timer = setTimeout(() => setPhase(step.then), step.ms);",
    );
    expect(effect).toContain("return () => clearTimeout(timer);");
    expect(effect).not.toContain("noticePhaseAt");
    expect(notice).toContain("}, [closedAt, fadeMs, phase]);");
  });

  it("× records when it was closed", () => {
    const notice = source("src/components/results/ResultsUpdatedNotice.tsx");
    const button = notice.slice(
      notice.indexOf('className="results-updatedNotice-close"'),
    );
    expect(button.slice(0, button.indexOf("<svg"))).toMatch(
      /onClick=\{\(\) =>\n\s*setClosedAt\(/,
    );
  });

  it("the provider drops the line once it is gone", () => {
    const provider = source("src/app/results/[scanId]/ResultsScanProvider.tsx");
    const tag = provider.slice(provider.indexOf("<ResultsUpdatedNotice"));
    expect(tag.slice(0, tag.indexOf("/>"))).toContain(
      "onGone={() => setUpdatedNotice(0)}",
    );
  });

  it("while it fades it catches no taps", () => {
    const css = source("src/components/results/results.css");
    const rule = css.slice(
      css.indexOf('.results-updatedNotice[data-phase="leaving"] {'),
    );
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("opacity: 0;");
    expect(body).toContain("pointer-events: none;");
  });
});

describe("the feedback sheet keeps what was typed (keys after a 412)", () => {
  it("the sheet is keyed by the scan only", () => {
    const view = source("src/components/results/ResultsView.tsx");
    expect(view.match(/<ResultFeedbackSheet\b/g)).toHaveLength(1);
    const sheet = view.slice(view.indexOf("<ResultFeedbackSheet"));
    const tag = sheet.slice(0, sheet.indexOf("/>"));
    expect(tag).toMatch(/^\s*key=\{scanId\}$/m);
    expect(tag.match(/\bkey=/g)).toHaveLength(1);
  });

  it("the results page above it is keyed by the card, never the ranking", () => {
    const client = source("src/app/results/[scanId]/ResultsRankClient.tsx");
    expect(client.match(/<ResultsView\b/g)).toHaveLength(1);
    const view = client.slice(client.indexOf("<ResultsView"));
    const key = view.match(/\bkey=\{([^\n]*)\}\n/);
    expect(key).not.toBeNull();
    expect(key![1]).toBe(
      'target?.kind === "detail" ? target.card.entry.mouse.slug : "main"',
    );
    expect(key![1]).not.toMatch(/resultFingerprint|response/);
  });
});
