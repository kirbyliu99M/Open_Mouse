/**
 * Words of the How it works page. Every zh-TW string is a CANDIDATE (未拍板),
 * Claude's Taiwan wording, until Kirby has read it. The privacy sentence is in
 * `privacy.ts`. The number of mice is passed in by the page, never written here.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface HowItWorksCopy {
  title: string;
  back: string;
  subhead: string;
  heroAlt: string;
  cornersFound: string;
  stepsHeading: string;
  step1Title: string;
  step1Body: string;
  step2Title: string;
  step2Body: string;
  step3Title: string;
  step3Body: (mouseCount: number) => string;
  scanMyHand: string;
  ctaCaption: string;
  expiry: string;
  /** Kirby confirmed the English on 2026-10-07 (issue #138). */
  analytics: string;
  questions: string;
  privacyLink: string;
}

export const zhTW: HowItWorksCopy = {
  title: "運作方式",
  back: "‹ 首頁",
  subhead: "只需要你的手機和一張空白 A4 紙，從頭到尾大約一分鐘。",
  heroAlt: "手平放在 A4 紙上，從手機相機正上方拍攝的示意圖",
  cornersFound: "已找到四個角",
  stepsHeading: "三個步驟",
  step1Title: "任何一張空白 A4 紙",
  step1Body: "放在顏色較深的桌面上，它就是你的尺。",
  step2Title: "手掌攤平，手機在上方",
  step2Body: "四個角鎖定後，照片會自動拍下。",
  step3Title: "最適合你的滑鼠",
  step3Body: (n) => `依照與你手型的貼合程度，為 ${n} 款羅技滑鼠排序。`,
  scanMyHand: "掃描我的手",
  ctaCaption: "不用列印，不用註冊，大約一分鐘。",
  expiry: "未登入帳號的掃描紀錄會在一段時間後自動刪除。",
  analytics:
    "我們會匿名統計頁面造訪和掃描步驟來改進應用程式，絕不會記錄你的照片或測量數值。",
  questions: "對你的資料有疑問嗎？",
  privacyLink: "閱讀隱私與資料說明。",
};

export const en: HowItWorksCopy = {
  title: "How it works",
  back: "‹ Home",
  subhead:
    "All you need is your phone and one blank sheet of A4. About a minute, start to finish.",
  heroAlt:
    "Illustration of a hand laid flat on a sheet of A4 paper, seen from directly above a phone's camera",
  cornersFound: "All four corners found",
  stepsHeading: "Three steps",
  step1Title: "Any blank A4 sheet",
  step1Body: "Put it on a darker table. That's your ruler.",
  step2Title: "Hand flat, phone above",
  step2Body: "The corners lock on and the photo takes itself.",
  step3Title: "Your best matches",
  step3Body: (n) => `${n} Logitech mice ranked by how they fit your hand.`,
  scanMyHand: "Scan my hand",
  ctaCaption: "No printing, no sign-up. About a minute.",
  expiry: "Scans without an account expire automatically after a while.",
  analytics:
    "We count anonymous page visits and scan steps to improve the app, never your photo or your measurements.",
  questions: "Questions about your data?",
  privacyLink: "Read Privacy & data.",
};

export function howItWorksCopy(locale: Locale): HowItWorksCopy {
  return pickCopy(locale, { zhTW, en });
}
