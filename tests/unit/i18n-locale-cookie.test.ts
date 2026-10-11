import { describe, expect, it } from "vitest";
import { LOCALE_COOKIE_MAX_AGE_S } from "../../src/lib/contracts/locale";
import { localeCookieString } from "../../src/lib/i18n/localeCookie";
import { pickCopy } from "../../src/lib/i18n/copy";
import { backLinkName } from "../../src/components/nav/labels";

describe("localeCookieString", () => {
  it("keeps the choice for one year", () => {
    expect(LOCALE_COOKIE_MAX_AGE_S).toBe(31536000);
  });
  it("writes the site-wide, year-long, SameSite=Lax cookie", () => {
    expect(localeCookieString("en", false)).toBe(
      `om_locale=en; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_S}; SameSite=Lax`,
    );
  });
  it("adds Secure on https only", () => {
    expect(localeCookieString("zh-TW", true)).toBe(
      `om_locale=zh-TW; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_S}; SameSite=Lax; Secure`,
    );
    expect(localeCookieString("zh-TW", false)).not.toContain("Secure");
  });
});

describe("pickCopy", () => {
  it("picks the table for the locale", () => {
    const tables = { zhTW: "中", en: "en" };
    expect(pickCopy("zh-TW", tables)).toBe("中");
    expect(pickCopy("en", tables)).toBe("en");
  });
});

describe("backLinkName", () => {
  it("follows the locale", () => {
    expect(backLinkName("首頁", "zh-TW")).toBe("返回首頁");
    expect(backLinkName("Home", "en")).toBe("Back to Home");
  });
});
