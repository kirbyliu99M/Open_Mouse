import { LOCALE_COOKIE, type Locale } from "@/lib/contracts/locale";
import { localeFromLanguageTag, resolveLocale } from "@/lib/i18n/resolveLocale";

/**
 * The locale a browser can work out for itself, for the one screen that
 * renders without the root layout and its server-resolved locale
 * (`global-error.tsx`): the language cookie, else the first of the browser's
 * languages we have, else the default. Pure; the caller passes
 * `document.cookie` and `navigator.languages`.
 */
export function localeFromBrowser(
  cookie: string,
  languages: readonly string[],
): Locale {
  const match = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`));
  const fromCookie = match?.slice(LOCALE_COOKIE.length + 1);
  const accept = languages.find((tag) => localeFromLanguageTag(tag) !== null);
  return resolveLocale(fromCookie, accept);
}
