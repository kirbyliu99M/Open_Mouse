import { describe, expect, it } from "vitest";
import { en, micePageCopy, zhTW } from "../../src/lib/copy/mice-page";
import { RESULTS_PAGE_COPY } from "../../src/lib/copy/results-page";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";

function strings(table: Record<string, unknown>): string[] {
  return Object.values(table).flatMap((v) =>
    typeof v === "string" ? [v] : strings(v as Record<string, unknown>),
  );
}

describe("the all-mice page's copy", () => {
  it("is the approved draft, word for word, in both languages", () => {
    expect(en.title).toBe("All mice");
    expect(zhTW.title).toBe("所有滑鼠");
    expect(en.subtitle).toBe("Browse every mouse we compare.");
    expect(zhTW.subtitle).toBe("瀏覽我們比對的每一支滑鼠。");
    expect(en.searchPlaceholder).toBe("Search brand or model");
    expect(zhTW.searchPlaceholder).toBe("搜尋品牌或型號");
    expect(en.showMore).toBe("Show more");
    expect(zhTW.showMore).toBe("顯示更多");
    // Candidates, not in the approved draft (Kirby 2026-10-12): the hybrid shape's word (zh is the builder's proposal) and the two empty states.
    expect(en.shapeHybrid).toBe("Hybrid");
    expect(zhTW.shapeHybrid).toBe("混合型");
    expect(en.unavailable).toBe(
      "The mouse list could not be loaded. Please try again later.",
    );
    expect(zhTW.unavailable).toBe("目前無法載入滑鼠清單，請稍後再試。");
    expect(en.noSearchMatch).toBe("No mouse matches this search");
    expect(zhTW.noSearchMatch).toBe("沒有符合搜尋的滑鼠");
    expect(en.columns).toEqual({
      mouse: "Mouse",
      shape: "Shape",
      connection: "Connection",
      length: "Length (mm)",
      width: "Width (mm)",
      height: "Height (mm)",
      weight: "Weight (g)",
    });
    expect(zhTW.columns).toEqual({
      mouse: "滑鼠",
      shape: "形狀",
      connection: "連線",
      length: "長 (mm)",
      width: "寬 (mm)",
      height: "高 (mm)",
      weight: "重量 (g)",
    });
  });

  it("agrees with the results filter on the words they share", () => {
    for (const [lang, copy] of [
      ["en", en],
      ["zh-TW", zhTW],
    ] as const) {
      const f = RESULTS_PAGE_COPY[lang].filter;
      // The Shape and Connection column titles name the same filter groups,
      // in the same language (the draft's 形狀 / 連線 are shorter than the
      // results page's 滑鼠握感 / 連線方式, so only English is pinned).
      if (lang === "en") {
        expect(copy.columns.shape).toBe(f.group.shape);
        expect(copy.columns.connection).toBe(f.group.connectivity);
      }
    }
    expect(RESULTS_PAGE_COPY.en.filter.group.size).toBe("Size");
    expect(RESULTS_PAGE_COPY.en.filter.found(406)).toBe("406 mice found");
  });

  it("states no number and makes no medical claim", () => {
    for (const table of [zhTW, en])
      for (const s of strings(table as unknown as Record<string, unknown>)) {
        expect(findMedicalClaimTerm(s), s).toBeNull();
        expect(s, s).not.toMatch(/\d/);
        expect(s, s).not.toMatch(/ergonomic|更準|more accurate/i);
      }
  });

  it("picks by locale", () => {
    expect(micePageCopy("en")).toBe(en);
    expect(micePageCopy("zh-TW")).toBe(zhTW);
  });
});
