/**
 * M1 (v3.1 consumers, 未拍板 candidate): while `coverage.lengthOutOfRange` is
 * true the results page draws no numeric score and no band chip anywhere (big
 * card, other picks, other mice, the mirror score of an excluded mouse), and
 * the order is untouched. The asserts are on structure (the elements that carry
 * a score), not on numbers, so a coincidental 91 elsewhere cannot fool them.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultsView } from "../../src/components/results/ResultsView";
import { FIXTURES } from "../../src/components/results/fixtures";
import type { Locale } from "../../src/lib/contracts/locale";
import type { FitResponse } from "../../src/lib/contracts/fit";
import { inRange, outOfRange } from "./fit-out-of-range-fixture";

function render(
  response: FitResponse,
  props: { rank?: number; language?: Locale; scanId?: string } = {},
) {
  return renderToStaticMarkup(
    createElement(ResultsView, { response, language: "zh-TW", ...props }),
  );
}

/** Every element class and phrase that carries a score or a band on this page. */
const SCORE_MARKERS = [
  "results-score-total",
  "results-score-value",
  "results-band-dot",
  'class="results-band"',
  "results-card-score",
  "results-otherMice-score",
  "results-excluded-mirror",
  "results-excluded-score",
  "results-fitNotice",
];

describe("results page, hand outside the catalogue's length range", () => {
  it.each(["zh-TW", "en"] as const)(
    "shows no score and no band anywhere (%s)",
    (language) => {
      const html = render(outOfRange(), { language });
      for (const marker of SCORE_MARKERS) {
        expect(html, marker).not.toContain(marker);
      }
      expect(html).not.toContain("/ 100");
    },
  );

  it("shows the same page's numbers and bands when the hand is in range", () => {
    const html = render(inRange());
    for (const marker of [
      "results-score-total",
      "results-score-value",
      "results-card-score",
      "results-otherMice-score",
      "results-excluded-mirror",
    ]) {
      expect(html, marker).toContain(marker);
    }
    expect(html).toContain('class="results-band"');
  });

  it("also covers a v2/v3 response with no coverage key at all (v1 shape): numbers stay", () => {
    expect(render(FIXTURES["many-results"])).toContain("results-score-value");
  });

  it("keeps the order, the names and the reasons", () => {
    const base = FIXTURES["many-results"];
    const html = render(outOfRange());
    const names = [
      base.results[0],
      base.results[1],
      base.results[2],
      base.results[7],
    ].map((e) => e!.mouse.model);
    for (const name of names) expect(html).toContain(name);
    const first = html.indexOf(base.results[1]!.mouse.model);
    const third = html.indexOf(base.results[2]!.mouse.model);
    expect(first).toBeLessThan(third);
    // The excluded mice are still listed, each with its reason.
    for (const item of base.excluded) expect(html).toContain(item.model);
    expect(html).toContain("results-excluded-reason");
  });

  it("a detail page (any rank) draws no score either", () => {
    for (const rank of [1, 2, 4]) {
      const html = render(outOfRange(), { rank, scanId: "scan-1" });
      for (const marker of SCORE_MARKERS) {
        expect(html, `rank ${rank}: ${marker}`).not.toContain(marker);
      }
    }
  });

  it("no total triggers the poor-fit notice: a response whose top total is low draws nothing here", () => {
    const base = outOfRange();
    const low: FitResponse = {
      ...base,
      results: base.results.map((e) => ({ ...e, total: 12 })),
    };
    expect(render(low)).not.toContain("results-fitNotice");
  });
});
