import { describe, expect, it } from "vitest";
import {
  localizedPath,
  splitLocalePath,
  stripLocalePrefix,
} from "../../src/lib/i18n/localePath";

describe("splitLocalePath", () => {
  it("reads the /en prefix as a whole segment", () => {
    expect(splitLocalePath("/en")).toEqual({ locale: "en", path: "/" });
    expect(splitLocalePath("/en/mice")).toEqual({
      locale: "en",
      path: "/mice",
    });
    expect(splitLocalePath("/en/mice/a-b")).toEqual({
      locale: "en",
      path: "/mice/a-b",
    });
  });

  it("leaves unprefixed and look-alike paths alone", () => {
    expect(splitLocalePath("/")).toEqual({ locale: null, path: "/" });
    expect(splitLocalePath("/mice")).toEqual({ locale: null, path: "/mice" });
    expect(splitLocalePath("/english")).toEqual({
      locale: null,
      path: "/english",
    });
    expect(stripLocalePrefix("/enx/y")).toBe("/enx/y");
  });
});

describe("localizedPath", () => {
  it("prefixes English and leaves zh-TW unprefixed", () => {
    expect(localizedPath("/mice", "en")).toBe("/en/mice");
    expect(localizedPath("/", "en")).toBe("/en");
    expect(localizedPath("/mice", "zh-TW")).toBe("/mice");
    expect(localizedPath("/", "zh-TW")).toBe("/");
  });

  it("is safe to apply twice and switches an already prefixed path", () => {
    expect(localizedPath("/en/mice", "en")).toBe("/en/mice");
    expect(localizedPath("/en/mice", "zh-TW")).toBe("/mice");
    expect(localizedPath("/en", "zh-TW")).toBe("/");
  });

  it("keeps the query and hash", () => {
    expect(localizedPath("/mice?brand=Razer#top", "en")).toBe(
      "/en/mice?brand=Razer#top",
    );
    expect(localizedPath("/en?x=1", "zh-TW")).toBe("/?x=1");
  });

  it("returns anything that is not a site path untouched", () => {
    for (const href of [
      "https://example.com/a",
      "//cdn/x",
      "#top",
      "mailto:a@b",
    ]) {
      expect(localizedPath(href, "en")).toBe(href);
    }
  });
});
