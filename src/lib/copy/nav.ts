/**
 * Words of the navigation chrome: the home page's side menu, the journey top
 * bar and the account entry. Every zh-TW string is a CANDIDATE (未拍板),
 * Claude's Taiwan wording (滑鼠, 帳號, 掃描), until Kirby has read it.
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
  account: string;
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
  account: "帳號",
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
  account: "Account",
  signIn: "Sign in",
  journeyNavLabel: "Journey navigation",
  backTo: (destination) => `Back to ${destination}`,
};

export function navCopy(locale: Locale): NavCopy {
  return pickCopy(locale, { zhTW, en });
}
