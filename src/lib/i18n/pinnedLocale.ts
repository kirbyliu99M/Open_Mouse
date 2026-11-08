/**
 * Pages that exist in one language only, whatever the visitor's cookie,
 * `Accept-Language` or URL prefix says (candidate 未拍板): the hidden
 * data-tester page is zh-TW only (src/lib/contracts/tester.ts;
 * `TESTER_PAGE_PATH` is pinned to this list by
 * tests/unit/tester-locale.test.ts and spelled out here, so this list stays
 * free of page code). The middleware renders them in that locale
 * (`<html lang>`, the camera's own copy) and sends `/en/...` to the
 * unprefixed URL.
 */
import type { Locale } from "../contracts/locale";

export const PINNED_LOCALE_PATHS: readonly {
  readonly path: string;
  readonly locale: Locale;
}[] = [{ path: "/scan/tester", locale: "zh-TW" }];

/** The locale `path` (unprefixed) is pinned to, or null. */
export function pinnedLocaleFor(path: string): Locale | null {
  for (const p of PINNED_LOCALE_PATHS)
    if (path === p.path || path.startsWith(`${p.path}/`)) return p.locale;
  return null;
}
