import { NextResponse, type NextRequest } from "next/server";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_S,
  LOCALE_HEADER,
} from "@/lib/contracts/locale";
import { splitLocalePath } from "@/lib/i18n/localePath";
import { pinnedLocaleFor } from "@/lib/i18n/pinnedLocale";
import { testerPageConfigured } from "@/lib/tester/enabled";

/**
 * Locale-prefixed URLs (`src/lib/contracts/locale.ts`, 2026-10-28): `/en/...`
 * is rewritten to the unprefixed route, with the locale in `LOCALE_HEADER`
 * (which `getLocale` reads before the cookie). The response also stores the
 * locale in the cookie, so the API routes the page calls (the analysis is
 * written in the cookie's language) and any unprefixed link agree with it.
 *
 * Runs only on the prefixed paths (`config.matcher`) and the one-language
 * pages: every other request skips it. Machine endpoints are never served
 * under a prefix.
 *
 * A one-language page (src/lib/i18n/pinnedLocale.ts: the hidden tester page,
 * zh-TW only) renders in its locale whatever the cookie or `Accept-Language`
 * say, and its `/en/...` URL redirects to the unprefixed one. The visitor's
 * cookie is left as it was. While the tester page is off (`TESTER_OPEN`/`TESTER_CODES`
 * unset in production) it is treated like any other path, so a probe cannot
 * tell it from a page that does not exist (review #243 round 4).
 */
export function middleware(request: NextRequest): NextResponse {
  const { locale, path } = splitLocalePath(request.nextUrl.pathname);
  const pinned = pinnedPagesOn() ? pinnedLocaleFor(path) : null;
  if (pinned) {
    if (locale !== null) {
      const url = request.nextUrl.clone();
      url.pathname = path;
      return NextResponse.redirect(url, 307);
    }
    const headers = new Headers(request.headers);
    headers.set(LOCALE_HEADER, pinned);
    return NextResponse.next({ request: { headers } });
  }
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
  matcher: ["/en", "/en/:path*", "/scan/tester", "/scan/tester/:path*"],
};

/**
 * One-language pages are pinned only while they are on: always in
 * development (dev-only demo routes, e2e), and in production only when
 * `TESTER_OPEN=1` or `TESTER_CODES` names a valid code (read at request time).
 */
function pinnedPagesOn(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    // Named one by one: the Edge build inlines only named env reads.
    testerPageConfigured({
      TESTER_OPEN: process.env.TESTER_OPEN,
      TESTER_CODES: process.env.TESTER_CODES,
    })
  );
}
