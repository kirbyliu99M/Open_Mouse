/**
 * The cookie banner and its statement, zh-TW and English, same keys. Every
 * string is a CANDIDATE (未拍板) until Kirby has read it; the zh-TW is Claude's
 * wording. The statement is the banner's "details" block: GA4 is described
 * here and nowhere else (Kirby, 2026-10-24: it follows the cookie statement).
 *
 * Facts the wording rests on, to re-check before the site is public: the GA4
 * cookies are `_ga` and `_ga_<ID>`, kept up to 2 years (Google's default);
 * Google signals and ad personalisation are off in `src/client/analytics/ga4.ts`;
 * the events sent are the list in the same file.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface CookieConsentCopy {
  /** The `aria-label` of the banner region. */
  regionLabel: string;
  title: string;
  body: string;
  accept: string;
  decline: string;
  detailsToggle: string;
  /** The statement's rows: a short label and its text. */
  detailsWhatLabel: string;
  detailsWhat: string;
  detailsSentLabel: string;
  detailsSent: string;
  detailsNotLabel: string;
  detailsNot: string;
  detailsOtherLabel: string;
  detailsOther: string;
  detailsChangeLabel: string;
  detailsChange: string;
  /** Shown when the banner was reopened: the current choice. */
  currentGranted: string;
  currentDenied: string;
  /** The footer button that reopens the banner. */
  footerLink: string;
}

export const zhTW: CookieConsentCopy = {
  regionLabel: "Cookie 設定",
  title: "關於 Cookie",
  body: "我們想用 Google Analytics（GA4）了解網站整體的使用情形，例如哪些頁面常被看。它會在你的瀏覽器放 Cookie。不同意也不影響任何功能。",
  accept: "同意",
  decline: "不同意",
  detailsToggle: "詳細說明",
  detailsWhatLabel: "放哪些 Cookie",
  detailsWhat:
    "_ga 和以 _ga_ 開頭的各一個，用來認出同一個瀏覽器的多次造訪，最長保留約 2 年。",
  detailsSentLabel: "送出什麼",
  detailsSent:
    "頁面路徑（結果頁的編號已被取代，網址的問號後面也不送）、少數流程與按鈕事件，以及連線時 Google 一定會收到的資訊（例如 IP 位址、瀏覽器種類）。不含照片、手部量測值、握法和帳號。",
  detailsNotLabel: "不做什麼",
  detailsNot: "不用於廣告，不啟用 Google 訊號，也不做個人化。",
  detailsOtherLabel: "另有的統計",
  detailsOther:
    "網站另有一套不使用 Cookie 的自建統計（頁面與按鈕事件，不含照片與量測值），不受這個選擇影響。",
  detailsChangeLabel: "改變主意",
  detailsChange:
    "你的選擇存在這個瀏覽器裡，隨時可從頁尾的「Cookie 設定」更改。改成不同意，會一併刪除這些 Cookie。",
  currentGranted: "目前設定：同意",
  currentDenied: "目前設定：不同意",
  footerLink: "Cookie 設定",
};

export const en: CookieConsentCopy = {
  regionLabel: "Cookie settings",
  title: "About cookies",
  body: "We'd like to use Google Analytics (GA4) to see how the site is used overall, such as which pages are visited. It sets cookies in your browser. Saying no changes nothing you can do on the site.",
  accept: "Accept",
  decline: "Decline",
  detailsToggle: "Details",
  detailsWhatLabel: "Which cookies",
  detailsWhat:
    "One named _ga and one starting with _ga_, which recognise the same browser across visits. They last up to about 2 years.",
  detailsSentLabel: "What is sent",
  detailsSent:
    "The page path (a results page's ID is replaced, and anything after a question mark is not sent), a few flow and button events, and what Google always receives on a connection (for example the IP address and browser type). No photos, hand measurements, grip or account.",
  detailsNotLabel: "What is not done",
  detailsNot: "No advertising, no Google signals, and no personalisation.",
  detailsOtherLabel: "Other statistics",
  detailsOther:
    "The site also has its own statistics that use no cookies (page and button events, no photos or measurements). This choice does not affect them.",
  detailsChangeLabel: "Changing your mind",
  detailsChange:
    "Your choice is kept in this browser. Change it any time from “Cookie settings” in the footer. Choosing Decline also deletes these cookies.",
  currentGranted: "Current setting: accepted",
  currentDenied: "Current setting: declined",
  footerLink: "Cookie settings",
};

export function cookieConsentCopy(locale: Locale): CookieConsentCopy {
  return pickCopy(locale, { zhTW, en });
}
