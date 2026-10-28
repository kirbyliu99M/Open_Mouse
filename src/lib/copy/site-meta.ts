/**
 * The site description used by the page metadata and both share cards, per
 * locale. Kirby approved both descriptions on 2026-10-26 (Claude's wording,
 * shaped on a product-page description). The home title is still a CANDIDATE
 * (未拍板).
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface SiteMetaCopy {
  description: string;
  /** The home page's whole `<title>`; other pages use "page · Palmate". */
  homeTitle: string;
}

export const zhTW: SiteMetaCopy = {
  description:
    "Palmate 是依手型挑選電競滑鼠的線上工具，專為想找到合手滑鼠的玩家而設計。用手機和一張 A4 紙就能量出手的尺寸，直接與滑鼠規格對照，作為選購參考。",
  homeTitle: "Palmate・找到合手的滑鼠",
};

export const en: SiteMetaCopy = {
  description:
    "Palmate is an online tool for choosing a gaming mouse by hand size, designed for players who want one that fits. Measure your hand with a phone and a sheet of A4 and compare it with mouse dimensions.",
  homeTitle: "Palmate · Find the mouse that fits",
};

export function siteMetaCopy(locale: Locale): SiteMetaCopy {
  return pickCopy(locale, { zhTW, en });
}
