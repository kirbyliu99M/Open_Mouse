import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_S } from "../contracts/locale";
import type { Locale } from "../contracts/locale";

/**
 * The `document.cookie` string that stores a visitor's language choice
 * (`src/lib/contracts/locale.ts`): site-wide, one year, `SameSite=Lax`, and
 * `Secure` on https.
 */
export function localeCookieString(locale: Locale, secure: boolean): string {
  return [
    `${LOCALE_COOKIE}=${locale}`,
    "Path=/",
    `Max-Age=${LOCALE_COOKIE_MAX_AGE_S}`,
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
