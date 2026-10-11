/**
 * The site description used by the page metadata and both share cards, per
 * locale. The zh-TW sentence is a CANDIDATE (未拍板), Claude's wording.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface SiteMetaCopy {
  description: string;
}

export const zhTW: SiteMetaCopy = {
  description: "找到適合你手型的滑鼠。目前開發中。",
};

export const en: SiteMetaCopy = {
  description: "Finding a mouse that fits your hand. Currently in development.",
};

export function siteMetaCopy(locale: Locale): SiteMetaCopy {
  return pickCopy(locale, { zhTW, en });
}
