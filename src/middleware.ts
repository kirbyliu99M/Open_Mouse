import { NextResponse, type NextRequest } from "next/server";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_S,
  LOCALE_HEADER,
} from "@/lib/contracts/locale";
import { splitLocalePath } from "@/lib/i18n/localePath";
import { pinnedLocaleFor } from "@/lib/i18n/pinnedLocale";

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
 * cookie is left as it was.
 */
export function middleware(request: NextRequest): NextResponse {
  const { locale, path } = splitLocalePath(request.nextUrl.pathname);
  const pinned = pinnedLocaleFor(path);
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
