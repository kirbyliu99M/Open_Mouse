import { describe, expect, it } from "vitest";
import { languageAlternates, pageMetadata } from "../../src/lib/seo";
import { SITE_URL } from "../../src/lib/site";

describe("languageAlternates", () => {
  it("names both locales and an unprefixed x-default", () => {
    expect(languageAlternates("/")).toEqual({
      "zh-TW": SITE_URL,
      en: `${SITE_URL}/en`,
      "x-default": SITE_URL,
    });
  });
});

describe("pageMetadata", () => {
  const base = {
    path: "/learn",
    title: "Guide",
    description: "A description.",
  } as const;

  it("makes the /en URL canonical only when the URL names English", () => {
    const en = pageMetadata({ ...base, locale: "en", urlLocale: "en" });
    expect(en.alternates?.canonical).toBe(`${SITE_URL}/en/learn`);
    // An unprefixed URL shown in English (the visitor's cookie) is still the
    // zh-TW address: a crawler never sees it in English.
    const cookie = pageMetadata({ ...base, locale: "en", urlLocale: null });
    expect(cookie.alternates?.canonical).toBe(`${SITE_URL}/learn`);
  });

  it("gives the share cards the page's own title, description and URL", () => {
    const m = pageMetadata({ ...base, locale: "zh-TW", urlLocale: null });
    expect(m.title).toBe("Guide");
    expect(m.description).toBe("A description.");
    expect(m.openGraph).toMatchObject({
      title: "Guide · Palmate",
      description: "A description.",
      url: `${SITE_URL}/learn`,
      locale: "zh_TW",
      alternateLocale: ["en_US"],
    });
    expect(m.twitter).toMatchObject({ title: "Guide · Palmate" });
  });

  it("uses an absolute title as is", () => {
    const m = pageMetadata({
      path: "/",
      absoluteTitle: "Palmate · Find the mouse that fits",
      description: "d",
      locale: "en",
      urlLocale: "en",
    });
    expect(m.title).toEqual({ absolute: "Palmate · Find the mouse that fits" });
    expect(m.openGraph?.title).toBe("Palmate · Find the mouse that fits");
    expect(m.alternates?.canonical).toBe(`${SITE_URL}/en`);
  });
});
