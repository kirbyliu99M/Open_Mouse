/**
 * The copy convention (Kirby, 2026-10-11): no i18n library, typed tables.
 *
 * - One module per feature in `src/lib/copy/`, e.g. `site-footer.ts`.
 * - Each module defines an interface, and exports `zhTW` and `en`, two tables
 *   of that interface (so a missing key is a type error), plus a picker
 *   `xxxCopy(locale)` built with `pickCopy`.
 * - Values are strings, or functions returning strings when a sentence needs
 *   a number or a name. Never an empty string.
 * - Every zh-TW string that Kirby has not read is a CANDIDATE (未拍板); the
 *   module's header comment says so.
 * - `tests/unit/i18n-copy-tables.test.ts` finds every module in
 *   `src/lib/copy/` and checks `zhTW` and `en` have the same keys.
 * - Server components get the locale from `getLocale()`
 *   (`src/server/i18n/getLocale.ts`); client components from `useLocale()`
 *   (`src/client/i18n/LocaleProvider.tsx`).
 * - Numbers a user sees are computed in TypeScript, never in copy tables or by
 *   the model (hard rule 2).
 */
import type { Locale } from "../contracts/locale";

/** The table for a locale. */
export function pickCopy<T>(
  locale: Locale,
  tables: { readonly zhTW: T; readonly en: T },
): T {
  return locale === "zh-TW" ? tables.zhTW : tables.en;
}
