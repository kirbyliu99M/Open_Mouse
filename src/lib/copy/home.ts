/**
 * Words of the home page (hero and buttons). Every zh-TW string is a
 * CANDIDATE (未拍板), Claude's Taiwan wording, until Kirby has read it. The five
 * annotations live in `home-story.ts`. The finale headline "Find Your Best
 * Mouse" is Kirby's own wording and is shown as written in both languages, so
 * it is not in the tables below.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface HomeCopy {
  heading: string;
  subhead: string;
  scanMyHand: string;
  howItWorks: string;
}

export const zhTW: HomeCopy = {
  heading: "找到最適合你的滑鼠。",
  subhead: "只要一張空白 A4 紙和你的手機。",
  scanMyHand: "掃描我的手",
  howItWorks: "運作方式",
};

export const en: HomeCopy = {
  heading: "Find the mouse that fits.",
  subhead: "A blank sheet of A4 and your phone are all it takes.",
  scanMyHand: "Scan my hand",
  howItWorks: "How it works",
};

/** Kirby's own wording, the same in both languages. */
export const FINALE_HEADLINE = "Find Your Best Mouse";

export function homeCopy(locale: Locale): HomeCopy {
  return pickCopy(locale, { zhTW, en });
}
