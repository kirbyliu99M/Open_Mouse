/**
 * The hidden tester page is zh-TW only (contract src/lib/contracts/tester.ts):
 * the middleware renders it in zh-TW whatever the cookie or Accept-Language
 * say, and sends `/en/scan/tester` to `/scan/tester`. Every other page keeps
 * the locale rules it had.
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  testerCodesConfigured,
  testerOpenConfigured,
  testerPageConfigured,
} from "../../src/lib/tester/enabled";
import { parseTesterCodes } from "../../src/server/tester/codes";
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

describe("while the tester page is off in production", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("TESTER_CODES needs at least one valid code", () => {
    expect(testerCodesConfigured(undefined)).toBe(false);
    expect(testerCodesConfigured("")).toBe(false);
    expect(testerCodesConfigured("nope,P1-AAAAAA")).toBe(false);
    expect(testerCodesConfigured("nope, p07-k7q2m9")).toBe(true);
  });

  it("agrees with parseTesterCodes on every input", () => {
    const parts = [
      "",
      " ",
      "P07-K7Q2M9",
      " p07-k7q2m9 ",
      "P1-AAAAAA",
      "P123-ABCDEF",
      "P07-K7Q2M0",
      "x",
      "P07-K7Q2M9\n",
    ];
    const inputs: (string | undefined)[] = [undefined];
    for (const a of parts)
      for (const b of parts) inputs.push(a, `${a},${b}`, `${a};${b}`);
    for (const raw of inputs)
      expect(testerCodesConfigured(raw), JSON.stringify(raw)).toBe(
        parseTesterCodes(raw) !== null,
      );
  });

  it("/en/scan/tester is rewritten like any missing page, not redirected", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TESTER_CODES", "");
    const response = middleware(request("/en/scan/tester"));
    expect(response.status).not.toBe(307);
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/scan/tester",
    );
  });

  it("/scan/tester gets no pinned locale header", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TESTER_CODES", "");
    const response = middleware(
      request("/scan/tester", { "accept-language": "en-US" }),
    );
    expect(
      response.headers.get(`x-middleware-request-${LOCALE_HEADER}`),
    ).toBeNull();
  });

  it("TESTER_OPEN=1 alone turns the page on (Kirby 2026-11-10)", () => {
    expect(testerOpenConfigured("1")).toBe(true);
    for (const raw of [undefined, "", "0", "true", "yes"])
      expect(testerOpenConfigured(raw), String(raw)).toBe(false);
    expect(testerPageConfigured({ TESTER_OPEN: "1" })).toBe(true);
    expect(testerPageConfigured({ TESTER_CODES: "P07-K7Q2M9" })).toBe(true);
    expect(testerPageConfigured({})).toBe(false);
  });

  it("with TESTER_OPEN=1 in production the page is pinned", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TESTER_CODES", "");
    vi.stubEnv("TESTER_OPEN", "1");
    expect(middleware(request("/en/scan/tester")).status).toBe(307);
  });

  it("with codes set in production the page is pinned again", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TESTER_CODES", "P07-K7Q2M9");
    expect(middleware(request("/en/scan/tester")).status).toBe(307);
  });
});
