import "server-only";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "@/lib/contracts/locale";
import { resolveLocale } from "@/lib/i18n/resolveLocale";

/**
 * The locale of the current request: the visitor's cookie, else
 * `Accept-Language`, else zh-TW. Reading either makes the route dynamic.
 */
export async function getLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerStore.get("accept-language"),
  );
}
