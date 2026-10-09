/**
 * Words in the site footer, zh-TW and English, same keys. Every string is a
 * CANDIDATE (未拍板) until Kirby has read it.
 *
 * The non-affiliation statement is NOT in this table: Kirby is writing it and
 * has not yet. Until he does the footer keeps the home page's wording as it
 * was, in English, word for word (`NON_AFFILIATION_STATEMENT`). It is
 * one constant so replacing it is one edit.
 */
import type { UiLanguage } from "../../client/uiLanguage";

export interface SiteFooterCopy {
  preview: string;
  howItWorks: string;
  privacy: string;
  account: string;
  github: string;
  /** The `aria-label` of the link row. */
  linksLabel: string;
}

export const zhTW: SiteFooterCopy = {
  preview: "Early preview · 量測仍在驗證中",
  howItWorks: "運作方式",
  privacy: "隱私",
  account: "帳號",
  github: "GitHub",
  linksLabel: "網站連結",
};

export const en: SiteFooterCopy = {
  preview: "Early preview · measurements are still being validated",
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
 * The current statement, moved here from the home page with its words
 * unchanged. English in both languages until Kirby writes the real one.
 */
export const NON_AFFILIATION_STATEMENT =
  "Not affiliated with Logitech. Sizes from Logitech's published specs.";
