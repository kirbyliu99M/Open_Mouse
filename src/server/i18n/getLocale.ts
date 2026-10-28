import "server-only";
import { cookies, headers } from "next/headers";
import {
  LOCALE_COOKIE,
  LOCALE_HEADER,
  isLocale,
  type Locale,
} from "@/lib/contracts/locale";
import { resolveLocale } from "@/lib/i18n/resolveLocale";

/**
 * The locale of the current request: the URL's prefix (passed on by the
 * middleware in `LOCALE_HEADER`), else the visitor's cookie, else
 * `Accept-Language`, else zh-TW. Reading either makes the route dynamic.
 */
export async function getLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const fromUrl = headerStore.get(LOCALE_HEADER);
  if (isLocale(fromUrl)) return fromUrl;
  return resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerStore.get("accept-language"),
  );
}

/**
 * The locale the URL itself names (`/en/...`), or null for an unprefixed URL.
 * The canonical address of a page follows this, not the cookie: an unprefixed
 * URL is the zh-TW address even when a visitor's cookie shows it in English.
 */
export async function getUrlLocale(): Promise<Locale | null> {
  const value = (await headers()).get(LOCALE_HEADER);
  return isLocale(value) ? value : null;
}
