// tests/unit/ui-language.test.ts
import { describe, expect, it } from "vitest";
import { pickUiLanguage, uiLangAttribute } from "../../src/client/uiLanguage";

describe("pickUiLanguage", () => {
  it("picks zh-TW for any Chinese first preference", () => {
    for (const l of ["zh", "zh-TW", "zh-Hant-TW", "ZH-cn", " zh-HK"]) {
      expect(pickUiLanguage([l, "en"])).toBe("zh-TW");
    }
  });
  it("picks English otherwise", () => {
    expect(pickUiLanguage(["en-US", "zh-TW"])).toBe("en");
    expect(pickUiLanguage(["zhx"])).toBe("en");
    expect(pickUiLanguage([], null)).toBe("en");
    expect(pickUiLanguage(undefined, undefined)).toBe("en");
  });
  it("falls back to navigator.language when the list is empty", () => {
    expect(pickUiLanguage([], "zh-TW")).toBe("zh-TW");
  });
  it("marks only zh-TW text", () => {
    expect(uiLangAttribute("zh-TW")).toBe("zh-TW");
    expect(uiLangAttribute("en")).toBeUndefined();
  });
});
