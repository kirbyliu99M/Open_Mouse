/**
 * Which language the analysis prose is written in for a request: the same
 * rule as the rest of the site (`resolveLocale`, `src/lib/i18n/resolveLocale.ts`),
 * read from the `om_locale` cookie and then `Accept-Language`. Pure.
 */
import { LOCALE_COOKIE, type Locale } from "../../lib/contracts/locale";
import { resolveLocale } from "../../lib/i18n/resolveLocale";
import { parseCookieHeader } from "../scans/cookies";

export function localeFromRequestHeaders(headers: {
  get(name: string): string | null;
}): Locale {
  const cookies = parseCookieHeader(headers.get("cookie"));
  return resolveLocale(
    cookies[LOCALE_COOKIE] ?? null,
    headers.get("accept-language"),
  );
}
