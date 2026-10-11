/**
 * Which locale a request is shown in (`src/lib/contracts/locale.ts`). Pure:
 * the server passes the cookie value and the `Accept-Language` header, the
 * browser can pass `navigator.languages` through `localeFromLanguageTag`.
 */
import { DEFAULT_LOCALE, isLocale, type Locale } from "../contracts/locale";

/**
 * The locale a single language tag stands for: any Chinese tag (`zh`,
 * `zh-TW`, `zh-Hant`, `zh-CN`) is zh-TW, the only Chinese the site has; any
 * English tag is en; anything else is null. Same Chinese rule as
 * `pickUiLanguage` (#144).
 */
export function localeFromLanguageTag(tag: string): Locale | null {
  const t = tag.trim();
  if (/^zh(?![a-z])/i.test(t)) return "zh-TW";
  if (/^en(?![a-z])/i.test(t)) return "en";
  return null;
}

/**
 * The best supported locale in an `Accept-Language` header, or null. Entries
 * are tried in descending `q` (ties keep header order); `q=0` and `*` never
 * match; a malformed `q` counts as 1. So `ja, en;q=0.8` is en, and
 * `en;q=0.5, zh-TW` is zh-TW.
 */
export function localeFromAcceptLanguage(
  header: string | null | undefined,
): Locale | null {
  if (!header) return null;
  const entries = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.split(";");
      let q = 1;
      for (const param of params) {
        const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param);
        if (m) {
          const parsed = Number(m[1]);
          if (Number.isFinite(parsed)) q = parsed;
        }
      }
      return { tag: tag.trim(), q, index };
    })
    .filter((e) => e.tag !== "" && e.tag !== "*" && e.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const entry of entries) {
    const locale = localeFromLanguageTag(entry.tag);
    if (locale) return locale;
  }
  return null;
}

/** The cookie if it names a locale, else `Accept-Language`, else the default. */
export function resolveLocale(
  cookieValue: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  return localeFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
