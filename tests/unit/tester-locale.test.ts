/**
 * The hidden tester page is zh-TW only (contract src/lib/contracts/tester.ts):
 * the middleware renders it in zh-TW whatever the cookie or Accept-Language
 * say, and sends `/en/scan/tester` to `/scan/tester`. Every other page keeps
 * the locale rules it had.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { LOCALE_COOKIE, LOCALE_HEADER } from "../../src/lib/contracts/locale";
import { TESTER_PAGE_PATH } from "../../src/lib/contracts/tester";
import {
  PINNED_LOCALE_PATHS,
  pinnedLocaleFor,
} from "../../src/lib/i18n/pinnedLocale";
import { config, middleware } from "../../src/middleware";

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, "https://palmate.example"), { headers });

describe("one-language pages", () => {
  it("pins exactly the contract's tester path to zh-TW", () => {
    expect(PINNED_LOCALE_PATHS).toEqual([
      { path: TESTER_PAGE_PATH, locale: "zh-TW" },
    ]);
    expect(pinnedLocaleFor("/scan/tester")).toBe("zh-TW");
    expect(pinnedLocaleFor("/scan/tester/demo")).toBe("zh-TW");
    for (const p of ["/", "/scan/easy", "/scan/testers", "/scan"])
      expect(pinnedLocaleFor(p), p).toBeNull();
  });

  it("the middleware runs on the tester page", () => {
    expect(config.matcher).toEqual(
      expect.arrayContaining(["/scan/tester", "/scan/tester/:path*"]),
    );
  });

  it("an English visitor gets the page in zh-TW, and their cookie is left alone", () => {
    const response = middleware(
      request("/scan/tester", {
        "accept-language": "en-US,en;q=0.9",
        cookie: `${LOCALE_COOKIE}=en`,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get(`x-middleware-request-${LOCALE_HEADER}`)).toBe(
      "zh-TW",
    );
    expect(response.cookies.get(LOCALE_COOKIE)).toBeUndefined();
  });

  it("/en/scan/tester redirects to /scan/tester, keeping the query", () => {
    const response = middleware(request("/en/scan/tester/demo?x=1"));
    expect(response.status).toBe(307);
    expect(
      new URL(response.headers.get("location")!).pathname +
        new URL(response.headers.get("location")!).search,
    ).toBe("/scan/tester/demo?x=1");
  });

  it("other /en pages are rewritten as before", () => {
    const response = middleware(request("/en/scan/easy"));
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/scan/easy",
    );
    expect(response.headers.get(`x-middleware-request-${LOCALE_HEADER}`)).toBe(
      "en",
    );
  });
});
