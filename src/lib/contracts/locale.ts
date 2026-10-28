/**
 * Locale contract — which languages the site is shown in, and how the server
 * and the browser agree on one (Kirby, 2026-10-11).
 *
 * - Revised 2026-10-28 (SEO task, approved by the user that day: the site is indexable since
 *   2026-10-26, and a crawler sends neither the cookie nor `Accept-Language`,
 *   so the English pages were never indexed): English has its own URLs under
 *   `LOCALE_PATH_PREFIX.en` (`/en/mice` is `/mice` in English). The
 *   unprefixed URLs are unchanged: every route, the printed QR links
 *   (`/l/v1/...`) and the e2e paths stay as they are, and they are the zh-TW
 *   (and `x-default`) URLs in `hreflang`.
 * - A prefixed request is shown in the prefix's locale whatever the cookie
 *   says: the middleware strips the prefix, rewrites to the unprefixed route
 *   and passes the locale in the `LOCALE_HEADER` request header, which wins
 *   over the cookie. It also stores the locale in the cookie, so the API
 *   routes and any unprefixed link that follows agree with the page.
 * - On an unprefixed URL a visitor's own choice is kept in the `LOCALE_COOKIE`
 *   cookie, written by the language switcher. Without a valid cookie the
 *   server follows the request's `Accept-Language`, and falls back to
 *   `DEFAULT_LOCALE` (`resolveLocale` in `src/lib/i18n/resolveLocale.ts`).
 * - The server renders in the resolved locale and `<html lang>` carries it, so
 *   there is no English-then-Chinese switch after hydration.
 * - Reading the cookie and header in the root layout makes every page
 *   dynamically rendered (accepted, 2026-10-11). Next sends dynamic pages as
 *   `private, no-cache`, so no shared cache serves one visitor's language to
 *   another; nothing may opt a page back into static or ISR rendering without
 *   keying it by locale.
 * - Gemini's analysis prose is written in the resolved locale too; the route
 *   resolves it from the same cookie and header.
 *
 * Change this file only in a PR of its own.
 */

/** Every locale the site is shown in. zh-TW first: Taiwan launches first. */
export const LOCALES = ["zh-TW", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/** The locale when neither the cookie nor `Accept-Language` decides one. */
export const DEFAULT_LOCALE: Locale = "zh-TW";

/** Name of the cookie holding the visitor's own choice. Not `httpOnly`: the
 * switcher writes it from the browser. `SameSite=Lax`, `Path=/`. */
export const LOCALE_COOKIE = "om_locale";

/** How long a choice is kept: one year, in seconds (`Max-Age`). */
export const LOCALE_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

/**
 * The path prefix of each locale's own URLs (2026-10-28). zh-TW has none: its
 * URLs are the site's original ones. A prefix is a whole path segment: `/en`
 * and `/en/...` match, `/english` does not.
 */
export const LOCALE_PATH_PREFIX: Readonly<Record<Locale, string>> = {
  "zh-TW": "",
  en: "/en",
};

/**
 * The request header the middleware sets on a prefixed request, naming its
 * locale. The server reads it before the cookie. Never trust it for anything
 * but the language.
 */
export const LOCALE_HEADER = "x-palmate-locale";

/** The `hreflang` value of each locale, and `og:locale`'s. */
export const LOCALE_HREFLANG: Readonly<Record<Locale, string>> = {
  "zh-TW": "zh-TW",
  en: "en",
};
export const LOCALE_OG: Readonly<Record<Locale, string>> = {
  "zh-TW": "zh_TW",
  en: "en_US",
};
