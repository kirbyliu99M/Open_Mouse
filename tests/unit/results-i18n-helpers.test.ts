import { describe, expect, it } from "vitest";
import { REASON_CODES } from "../../src/lib/contracts/fit";
import { formatScore, formatWeight } from "../../src/components/results/format";
import { reasonText } from "../../src/components/results/reasons";

const CJK = /[㐀-鿿]/;

describe("reasonText in both locales", () => {
  it.each(REASON_CODES)("%s: zh-TW is Chinese, en is not", (code) => {
    const params = { deltaMm: 3.2, deltaG: 12.6, minG: 60, maxG: 90 };
    expect(reasonText(code, params, "zh-TW")).toMatch(CJK);
    expect(reasonText(code, params, "en")).not.toMatch(CJK);
    expect(reasonText(code, {}, "zh-TW")).toMatch(CJK);
  });

  it("puts the engine's numbers in, formatted the same in both locales", () => {
    expect(reasonText("length_short", { deltaMm: -3.2 }, "zh-TW")).toContain(
      "3.2 mm",
    );
    expect(reasonText("weight_heavier", { deltaG: 12.6 }, "zh-TW")).toContain(
      "13 g",
    );
    expect(
      reasonText("weight_in_range", { minG: 60, maxG: 90 }, "zh-TW"),
    ).toContain("60–90 g");
  });

  it("says the same without a number when the engine sent none", () => {
    expect(reasonText("length_long", {}, "zh-TW")).not.toMatch(/\d/);
    expect(reasonText("length_long", {}, "en")).toBe(
      "This mouse is longer than your ideal length.",
    );
  });
});

describe("format helpers take a locale", () => {
  it("formatScore spells out a missing score, never 0", () => {
    expect(formatScore(null, "en")).toBe("Not yet assessed");
    expect(formatScore(null, "zh-TW")).toBe("尚未評估");
    expect(formatScore(88, "zh-TW")).toBe("88");
  });

  it("formatWeight spells out a missing weight", () => {
    expect(formatWeight(null, "en")).toBe("Weight not listed");
    expect(formatWeight(null, "zh-TW")).toBe("未列出重量");
    expect(formatWeight(59.6, "zh-TW")).toBe("60 g");
  });
});
