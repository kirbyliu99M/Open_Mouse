/**
 * Words of the all-mice page (`/mice`, PAGE-1), zh-TW and English, same keys.
 * Every string is a CANDIDATE (未拍板) until Kirby has read it.
 *
 * Source: the three-page copy draft (codex-briefs/pages-copy-draft-2026-10-11.md,
 * section 1). Everything the filter shows (its group titles,
 * options, the size note, 「N mice found」, the chips, 「Clear all」, 「Filter」)
 * is not written again here: the page takes it from the results page's filter
 * copy (`RESULTS_PAGE_COPY[...].filter`), so the two pages cannot drift apart.
 * The shape, connection and size words in the table come from there too.
 *
 * Two strings below are NOT in the approved draft and are proposals for Kirby
 * to approve or reword before this page ships (they are the page's two empty
 * states, which the draft did not cover): `unavailable` and `noSearchMatch`.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface MicePageCopy {
  /** The page's h1 and its browser title. */
  title: string;
  subtitle: string;
  /** The search box's placeholder, and its accessible name. */
  searchPlaceholder: string;
  columns: {
    mouse: string;
    shape: string;
    connection: string;
    length: string;
    width: string;
    height: string;
    weight: string;
  };
  showMore: string;
  /** PROPOSED (not in the draft): shown when the catalogue could not be read. */
  unavailable: string;
  /** PROPOSED (not in the draft): shown when a search (with no filter) matches nothing. */
  noSearchMatch: string;
}

export const zhTW: MicePageCopy = {
  title: "所有滑鼠",
  subtitle: "瀏覽我們比對的每一支滑鼠。",
  searchPlaceholder: "搜尋品牌或型號",
  columns: {
    mouse: "滑鼠",
    shape: "形狀",
    connection: "連線",
    length: "長 (mm)",
    width: "寬 (mm)",
    height: "高 (mm)",
    weight: "重量 (g)",
  },
  showMore: "顯示更多",
  unavailable: "目前無法載入滑鼠清單，請稍後再試。",
  noSearchMatch: "沒有符合搜尋的滑鼠",
};

export const en: MicePageCopy = {
  title: "All mice",
  subtitle: "Browse every mouse we compare.",
  searchPlaceholder: "Search brand or model",
  columns: {
    mouse: "Mouse",
    shape: "Shape",
    connection: "Connection",
    length: "Length (mm)",
    width: "Width (mm)",
    height: "Height (mm)",
    weight: "Weight (g)",
  },
  showMore: "Show more",
  unavailable: "The mouse list could not be loaded. Please try again later.",
  noSearchMatch: "No mouse matches this search",
};

export function micePageCopy(locale: Locale): MicePageCopy {
  return pickCopy(locale, { zhTW, en });
}
