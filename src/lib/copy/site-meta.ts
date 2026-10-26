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
    "只要一張空白 A4 紙和手機，量出你的手型，再比對電競滑鼠的尺寸與形狀，找到合手的滑鼠。",
  homeTitle: "Palmate・找到合手的滑鼠",
};

export const en: SiteMetaCopy = {
  description:
    "Measure your hand with a blank sheet of A4 and your phone, then compare gaming mice by size and shape to find one that fits.",
  homeTitle: "Palmate · Find the mouse that fits",
};

export function siteMetaCopy(locale: Locale): SiteMetaCopy {
  return pickCopy(locale, { zhTW, en });
}
