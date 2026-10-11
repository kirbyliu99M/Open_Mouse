import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultsView } from "../../src/components/results/ResultsView";
import { FIXTURES } from "../../src/components/results/fixtures";
import { resultHandKey } from "../../src/components/results/handDisclosure";
import {
  clearScanDisclosures,
  parseStoredManualEntry,
  resultLengthKey,
  resultManualEntryKey,
  serializeManualEntry,
} from "../../src/components/results/userLengthDisclosure";
import { MANUAL_ENTRY } from "../../src/lib/contracts/measurement";

const NBSP = String.fromCharCode(0xa0);

describe("the stored manual-entry numbers", () => {
  it("round-trips a typed pair", () => {
    const raw = serializeManualEntry({ handLengthMm: 185, handWidthMm: 82 });
    expect(parseStoredManualEntry(raw)).toEqual({
      handLengthMm: 185,
      handWidthMm: 82,
    });
  });

  it("is a different key from the typed length and the legacy hand key, per scan", () => {
    expect(resultManualEntryKey("a")).not.toBe(resultLengthKey("a"));
    expect(resultManualEntryKey("a")).not.toBe(resultHandKey("a"));
    expect(resultManualEntryKey("a")).not.toBe(resultManualEntryKey("b"));
  });

  it("reads nothing, or anything that is not a pair the contract accepts, as null", () => {
    for (const raw of [
      null,
      "",
      "  ",
      "abc",
      "185",
      "null",
      "[185,82]",
      "{}",
      '{"handLengthMm":185}',
      '{"handLengthMm":"185","handWidthMm":"82"}',
      '{"handLengthMm":134.9,"handWidthMm":82}',
      '{"handLengthMm":265.1,"handWidthMm":82}',
      '{"handLengthMm":185,"handWidthMm":49.9}',
      '{"handLengthMm":185,"handWidthMm":150.1}',
    ]) {
      expect(parseStoredManualEntry(raw), String(raw)).toBeNull();
    }
  });

  it("accepts the ends of the contract ranges", () => {
    const { handLengthRangeMm: l, handWidthRangeMm: w } = MANUAL_ENTRY;
    expect(
      parseStoredManualEntry(
        serializeManualEntry({ handLengthMm: l.min, handWidthMm: w.min }),
      ),
    ).not.toBeNull();
    expect(
      parseStoredManualEntry(
        serializeManualEntry({ handLengthMm: l.max, handWidthMm: w.max }),
      ),
    ).not.toBeNull();
  });
});

describe("clearScanDisclosures with manual entry", () => {
  it("removes the manual-entry numbers of every listed scan and keeps the others", () => {
    const values = new Map([
      [resultManualEntryKey("listed"), "x"],
      [resultLengthKey("listed"), "180"],
      [resultManualEntryKey("unlisted"), "y"],
    ]);
    clearScanDisclosures({ removeItem: (key: string) => values.delete(key) }, [
      "listed",
    ]);
    expect([...values.keys()]).toEqual([resultManualEntryKey("unlisted")]);
  });
});

describe("the results page disclosure line", () => {
  const response = FIXTURES["high-confidence"];
  const render = (props: Record<string, unknown>, language = "zh-TW") =>
    renderToStaticMarkup(
      createElement(ResultsView, {
        response,
        language: language as "zh-TW" | "en",
        ...props,
      }),
    );

  it("shows the typed numbers, one decimal, and says the palm length is an estimate", () => {
    const html = render({
      enteredManual: { handLengthMm: 185, handWidthMm: 82 },
    });
    expect(html).toContain(
      `依你輸入的手長 18.5${NBSP}公分、手寬 8.2${NBSP}公分估算；掌長為估計值`,
    );
    expect(html).toContain("results-handNotice");
  });

  it("says it in English too", () => {
    const html = render(
      { enteredManual: { handLengthMm: 185, handWidthMm: 82 } },
      "en",
    );
    expect(html).toContain(`18.5${NBSP}cm`);
    expect(html).toContain(`8.2${NBSP}cm`);
    expect(html).toContain("palm length is an estimate");
  });

  it("shows nothing for any scan made another way", () => {
    for (const props of [{}, { enteredManual: null }]) {
      const html = render(props);
      expect(html).not.toContain("掌長為估計值");
      expect(html).not.toContain("results-handNotice");
    }
  });

  it("shows the typed-length note alone when both are somehow set, never two stacked notes", () => {
    const html = render({
      enteredLengthMm: 186,
      enteredManual: { handLengthMm: 185, handWidthMm: 82 },
    });
    expect(html).not.toContain("掌長為估計值");
    expect([...html.matchAll(/results-handNotice/g)]).toHaveLength(1);
  });

  it("sits below the hero (after the reasons), before the collapsed details", () => {
    const html = render({
      enteredManual: { handLengthMm: 185, handWidthMm: 82 },
    });
    const notice = html.indexOf("掌長為估計值");
    expect(html.indexOf("results-hero")).toBeLessThan(notice);
    expect(html.indexOf("results-why-list")).toBeLessThan(notice);
    expect(notice).toBeLessThan(html.indexOf("results-details"));
  });
});
