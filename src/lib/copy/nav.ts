/**
 * Words of the navigation chrome: the home page's side menu, the journey top
 * bar and the account entry. Every zh-TW string is a CANDIDATE (未拍板),
 * Claude's Taiwan wording (滑鼠, 我的檔案, 掃描), until Kirby has read it.
 * 「我的檔案」 replaces 「帳號」 on the menu item (Kirby, 2026-10-12; the page is
 * the profile page).
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface NavCopy {
  /** The home nav's `aria-label`. */
  primaryNavLabel: string;
  menuOpen: string;
  menuClose: string;
  /** The `aria-label` of the menu dialog. */
  menuDialogLabel: string;
  menuTitle: string;
  /** The `aria-label` of the list of links inside the menu. */
  menuMainLabel: string;
  home: string;
  scanMyHand: string;
  howItWorks: string;
  /** Menu entries to the public content pages (SEO task 2026-10-30, candidate). */
  allMice: string;
  guides: string;
  faq: string;
  /** The menu item and the avatar link: the profile page. */
  account: string;
  /** The marker on that item when the person has not answered the questionnaire. */
  unanswered: string;
  signIn: string;
  /** The `aria-label` of the journey top bar. */
  journeyNavLabel: string;
  /** "Back to Home": names the destination for screen readers. */
  backTo: (destination: string) => string;
}

export const zhTW: NavCopy = {
  primaryNavLabel: "主要導覽",
  menuOpen: "開啟選單",
  menuClose: "關閉選單",
  menuDialogLabel: "導覽",
  menuTitle: "選單",
  menuMainLabel: "主要連結",
  home: "首頁",
  scanMyHand: "掃描我的手",
  howItWorks: "運作方式",
  allMice: "所有滑鼠",
  guides: "選購指南",
  faq: "常見問題",
  account: "我的檔案",
  unanswered: "尚未填答",
  signIn: "登入",
  journeyNavLabel: "流程導覽",
  backTo: (destination) => `返回${destination}`,
};

export const en: NavCopy = {
  primaryNavLabel: "Primary",
  menuOpen: "Open menu",
  menuClose: "Close menu",
  menuDialogLabel: "Navigation",
  menuTitle: "Menu",
  menuMainLabel: "Main",
  home: "Home",
  scanMyHand: "Scan my hand",
  howItWorks: "How it works",
  allMice: "All mice",
  guides: "Guides",
  faq: "FAQ",
  account: "My profile",
  unanswered: "Not answered yet",
  signIn: "Sign in",
  journeyNavLabel: "Journey navigation",
  backTo: (destination) => `Back to ${destination}`,
};

export function navCopy(locale: Locale): NavCopy {
  return pickCopy(locale, { zhTW, en });
}
