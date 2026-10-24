/**
 * The cookie banner and its statement, zh-TW and English, same keys. Every
 * string is a CANDIDATE (未拍板) until Kirby has read it; the zh-TW is Claude's
 * wording. The statement is ONE paragraph behind the banner's "details" link
 * (Kirby, 2026-10-24): GA4 is described here and nowhere else, and the sentence
 * on the banner no longer says that declining changes nothing.
 *
 * Facts the wording rests on, to re-check before the site is public: the GA4
 * cookies are `_ga` and `_ga_<ID>`, kept up to 2 years (Google's default);
 * Google signals and ad personalisation are off in `src/client/analytics/ga4.ts`;
 * the events sent are the list in the same file; the site's own cookie-free
 * statistics are PostHog (issue #138).
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface CookieConsentCopy {
  /** The `aria-label` of the banner region. */
  regionLabel: string;
  /**
   * The one sentence on the banner (Sony-style, Kirby 2026-10-24), in two
   * parts: `text` may wrap anywhere, `textEnd` and the details link never
   * break apart, so the link is never alone on a line.
   */
  text: string;
  textEnd: string;
  accept: string;
  decline: string;
  detailsToggle: string;
  /** The statement: one paragraph. */
  details: string;
  /** Shown when the banner was reopened: the current choice. */
  currentGranted: string;
  currentDenied: string;
  /** The footer button that reopens the banner. */
  footerLink: string;
}

export const zhTW: CookieConsentCopy = {
  regionLabel: "Cookie 設定",
  text: "我們使用 Cookie 與 Google Analytics 統計瀏覽情形、",
  textEnd: "改善網站。",
  accept: "同意",
  decline: "不同意",
  detailsToggle: "詳細說明",
  details:
    "Google Analytics 4 會放兩個 Cookie（_ga 與以 _ga_ 開頭的一個），用來認出同一個瀏覽器的多次造訪，最長保留約 2 年。送出的只有頁面路徑（結果頁的編號已被取代，問號後面不送）、少數流程與按鈕事件，以及連線時 Google 一定會收到的資訊（例如 IP 位址、瀏覽器種類），不含照片、手部量測值、握法和帳號，也不用於廣告或個人化。網站另有不使用 Cookie 的自建統計，不受這個選擇影響。你的選擇存在這個瀏覽器裡，隨時可從頁尾的「Cookie 設定」更改；改成不同意，會一併刪除這些 Cookie。",
  currentGranted: "目前設定：同意",
  currentDenied: "目前設定：不同意",
  footerLink: "Cookie 設定",
};

export const en: CookieConsentCopy = {
  regionLabel: "Cookie settings",
  text: "We use cookies and Google Analytics to count visits and ",
  textEnd: "improve the site.",
  accept: "Accept",
  decline: "Decline",
  detailsToggle: "Details",
  details:
    "Google Analytics 4 sets two cookies (_ga and one starting with _ga_) that recognise the same browser across visits, kept up to about 2 years. Only the page path (a results page's ID is replaced, and anything after a question mark is not sent), a few flow and button events, and what Google always receives on a connection (for example the IP address and browser type) are sent. No photos, hand measurements, grip or account, and nothing is used for advertising or personalisation. The site also has its own statistics that use no cookies; this choice does not affect them. Your choice is kept in this browser and can be changed any time from “Cookie settings” in the footer; choosing Decline also deletes these cookies.",
  currentGranted: "Current setting: accepted",
  currentDenied: "Current setting: declined",
  footerLink: "Cookie settings",
};

export function cookieConsentCopy(locale: Locale): CookieConsentCopy {
  return pickCopy(locale, { zhTW, en });
}
