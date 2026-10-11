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
 * - New modules use `pickCopy`. Older modules (results-page, home-story,
 *   site-footer, share-card) predate it and pick with their own ternary or
 *   record; both are fine, the test only needs `zhTW` and `en`.
 * - Pure, non-React TypeScript that returns user text takes `locale` (or the
 *   picked table) as an argument. It never reads a cookie or a header.
 * - Server pages call `getLocale()` once and pass the locale (or the table)
 *   down. Client files never import `getLocale` (it is `server-only`).
 * - Importing a table in a client component ships both languages to the
 *   browser. That is fine at this size.
 * - Exception: `CAPTURE_FAILURE_HINT_COPY` (Kirby-approved wording, not to be
 *   reworded) lives in `src/client/camera/captureFailure.ts`, not here.
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
