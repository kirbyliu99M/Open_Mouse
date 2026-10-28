import { NextResponse, type NextRequest } from "next/server";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_S,
  LOCALE_HEADER,
} from "@/lib/contracts/locale";
import { splitLocalePath } from "@/lib/i18n/localePath";

/**
 * Locale-prefixed URLs (`src/lib/contracts/locale.ts`, 2026-10-28): `/en/...`
 * is rewritten to the unprefixed route, with the locale in `LOCALE_HEADER`
 * (which `getLocale` reads before the cookie). The response also stores the
 * locale in the cookie, so the API routes the page calls (the analysis is
 * written in the cookie's language) and any unprefixed link agree with it.
 *
 * Runs only on the prefixed paths (`config.matcher`): every other request
 * skips it. Machine endpoints are never served under a prefix.
 */
export function middleware(request: NextRequest): NextResponse {
  const { locale, path } = splitLocalePath(request.nextUrl.pathname);
  if (locale === null || /^\/(api|ingest|monitoring|_next)(\/|$)/.test(path)) {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  url.pathname = path;
  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, locale);
  const response = NextResponse.rewrite(url, { request: { headers } });
  if (request.cookies.get(LOCALE_COOKIE)?.value !== locale) {
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE_S,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }
  return response;
}

export const config = {
  matcher: ["/en", "/en/:path*"],
};
