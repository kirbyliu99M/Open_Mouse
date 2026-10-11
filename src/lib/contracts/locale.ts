/**
 * Locale contract — which languages the site is shown in, and how the server
 * and the browser agree on one (Kirby, 2026-10-11).
 *
 * - The URL never carries the language: every route, the printed QR links
 *   (`/l/v1/...`) and the e2e paths stay as they are. The site is `noindex`,
 *   so there are no per-language URLs to index.
 * - A visitor's own choice is kept in the `LOCALE_COOKIE` cookie, written by
 *   the language switcher. Without a valid cookie the server follows the
 *   request's `Accept-Language`, and falls back to `DEFAULT_LOCALE`
 *   (`resolveLocale` in `src/lib/i18n/resolveLocale.ts`).
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
