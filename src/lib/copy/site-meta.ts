/**
 * The site description used by the page metadata and both share cards, per
 * locale. Both sentences and the home title are CANDIDATES (未拍板), Claude's wording
 * (2026-10-26, replacing the "in development" line), until Kirby has read them.
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
    "Palmate 是依手型挑選電競滑鼠的線上輔助工具。用手機和一張 A4 紙量出手的尺寸，與滑鼠規格對照，作為選購參考。",
  homeTitle: "Palmate・找到合手的滑鼠",
};

export const en: SiteMetaCopy = {
  description:
    "Palmate is an online tool that helps gamers choose a mouse by hand size. Measure your hand with a phone and a sheet of A4, then compare it against mouse dimensions.",
  homeTitle: "Palmate · Find the mouse that fits",
};

export function siteMetaCopy(locale: Locale): SiteMetaCopy {
  return pickCopy(locale, { zhTW, en });
}
