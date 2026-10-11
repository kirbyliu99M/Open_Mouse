/**
 * Words in the site footer, zh-TW and English, same keys. Every string is a
 * CANDIDATE (未拍板) until Kirby has read it. In particular the three group
 * titles and "Learn" / "Scan" are new in the merged footer (2026-10-10): their
 * zh-TW wording below is Claude's candidate, not Kirby's.
 *
 * History, not a feature: until 2026-10-10 this table also held an "Early
 * preview" note and a non-affiliation statement. Kirby decided that the footer
 * carries no explanatory text for now, so both were deleted (not hidden), and
 * this table has no key for either. If he brings them back, they are new
 * strings to add here.
 */
import type { UiLanguage } from "../../client/uiLanguage";

export interface SiteFooterCopy {
  /** Group titles (candidate). */
  groupProduct: string;
  groupTrust: string;
  groupProject: string;
  /** Product group. */
  scan: string;
  learn: string;
  /** Trust group. */
  howItWorks: string;
  privacy: string;
  /** Project group. */
  account: string;
  github: string;
  /** The `aria-label` of the link area. */
  linksLabel: string;
}

export const zhTW: SiteFooterCopy = {
  groupProduct: "產品",
  groupTrust: "信任",
  groupProject: "專案",
  scan: "掃描",
  learn: "學習",
  howItWorks: "運作方式",
  privacy: "隱私",
  account: "帳號",
  github: "GitHub",
  linksLabel: "網站連結",
};

export const en: SiteFooterCopy = {
  groupProduct: "Product",
  groupTrust: "Trust",
  groupProject: "Project",
  scan: "Scan",
  learn: "Learn",
  howItWorks: "How it works",
  privacy: "Privacy",
  account: "Account",
  github: "GitHub",
  linksLabel: "Site links",
};

export function siteFooterCopy(lang: UiLanguage): SiteFooterCopy {
  return lang === "zh-TW" ? zhTW : en;
}

/**
 * The line under the name. Kirby's own wording, in his own spelling (Title
 * Case): it is shown as written in both languages, so it is not in the
 * tables above. A statement, not a button and not a link.
 */
export const FOOTER_HEADLINE = "Ready to Find Yours?";
