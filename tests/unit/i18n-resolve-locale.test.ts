import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
} from "../../src/lib/contracts/locale";
import {
  localeFromAcceptLanguage,
  localeFromLanguageTag,
  resolveLocale,
} from "../../src/lib/i18n/resolveLocale";

describe("locale contract", () => {
  it("defaults to zh-TW", () => {
    expect(DEFAULT_LOCALE).toBe("zh-TW");
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });
  it.each(["zh-TW", "en"])("accepts %s", (v) => {
    expect(isLocale(v)).toBe(true);
  });
  it.each(["zh", "zh-tw", "EN", "en-US", "", null, undefined, 1])(
    "rejects %s",
    (v) => {
      expect(isLocale(v)).toBe(false);
    },
  );
});

describe("localeFromLanguageTag", () => {
  it.each([
    ["zh", "zh-TW"],
    ["zh-TW", "zh-TW"],
    ["zh-Hant-TW", "zh-TW"],
    ["zh-CN", "zh-TW"],
    [" ZH-hk ", "zh-TW"],
    ["en", "en"],
    ["en-US", "en"],
    ["EN-gb", "en"],
    ["en_US", "en"],
  ])("%s → %s", (tag, want) => {
    expect(localeFromLanguageTag(tag)).toBe(want);
  });
  it.each(["ja", "zhx", "eng", "en1", "zh2", "iw", "fr-FR", "", "*"])(
    "%s → null",
    (tag) => {
      expect(localeFromLanguageTag(tag)).toBeNull();
    },
  );
});

describe("localeFromAcceptLanguage", () => {
  it.each([
    ["zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7", "zh-TW"],
    ["en-US,en;q=0.9", "en"],
    ["ja, en;q=0.8", "en"],
    ["en;q=0.5, zh-TW", "zh-TW"],
    ["en;q=0.5, zh-TW;q=0.5", "en"],
    ["zh;q=0, en", "en"],
    ["*, en;q=0.1", "en"],
    ["en;q=abc, zh", "zh-TW"],
    ["en;q=-1, zh-TW;q=0.5", "zh-TW"],
    ["en;q=1e-1, zh;q=0.5", "zh-TW"],
    ["en;q=1.0.0, zh", "zh-TW"],
    ["en;q=, zh", "zh-TW"],
    ["en;q=1.5, zh;q=0.5", "zh-TW"],
    ["en;q=1.0, zh;q=0.999", "en"],
    ["zh-TW;q =0.9, en;Q=0.8", "zh-TW"],
    ["zh;q=0.000, en;q=0.001", "en"],
    ["ja, fr;q=0.9, en;q=0.9, zh;q=0.9", "en"],
    // Real browsers: Chrome, Safari, Firefox.
    ["en-US,en;q=0.9", "en"],
    ["zh-tw", "zh-TW"],
    ["zh-TW,zh;q=0.8,en-US;q=0.5,en;q=0.3", "zh-TW"],
    ["fr-FR, de;q=0.9, zh-CN;q=0.2", "zh-TW"],
  ])("%s → %s", (header, want) => {
    expect(localeFromAcceptLanguage(header)).toBe(want);
  });
  it.each([null, undefined, "", "ja", "*", "fr, de;q=0.5", "en;q=0", ",,;"])(
    "%s → null",
    (header) => {
      expect(localeFromAcceptLanguage(header)).toBeNull();
    },
  );
});

describe("resolveLocale", () => {
  it("a valid cookie wins over the header", () => {
    expect(resolveLocale("en", "zh-TW")).toBe("en");
    expect(resolveLocale("zh-TW", "en-US")).toBe("zh-TW");
  });
  it("an invalid cookie is ignored", () => {
    expect(resolveLocale("fr", "en-US")).toBe("en");
    expect(resolveLocale("", "en-US")).toBe("en");
  });
  it("falls back to the default without a usable cookie or header", () => {
    expect(resolveLocale(undefined, undefined)).toBe("zh-TW");
    expect(resolveLocale(null, "ja")).toBe("zh-TW");
    expect(resolveLocale("de", "fr")).toBe("zh-TW");
  });
});
