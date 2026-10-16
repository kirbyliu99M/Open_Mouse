/**
 * Words of the feedback sheet on the results page: one to five stars and an
 * optional comment about whether the ranking feels right. This is the v2 sheet
 * (Kirby, 2026-10-15; Pencil frames A to E). Every zh-TW string is a CANDIDATE
 * (未拍板) until Kirby has read it.
 *
 * The data note (`keptBody`, `notKeptBody`, `withdrawBody`) goes with
 * `RESULT_FEEDBACK_NOTICE_VERSION` in `src/lib/contracts/result-feedback.ts`:
 * v2 of this text is `result-feedback-notice-v2-draft`. When either changes,
 * bump the version and change the text together, as `questionnaire.ts` does
 * for its consent text. v1 was one long paragraph; v2 adds "the palm thickness
 * you stated" (the contract stores it) and splits the note into three rows.
 * The failure lines for rate limited, invalid and contact details in the
 * comment are the questionnaire's own, read from there so the two never say
 * different things; `sendFailed` (network and anything else) is this sheet's.
 *
 * Numbers (the star, the counter) are passed in by the component, never
 * written here (hard rule 2).
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface ResultFeedbackCopy {
  title: string;
  /** The label under the first star, and under the last. */
  lowLabel: string;
  highLabel: string;
  /** The accessible name of one star; both numbers are passed in. */
  starName: (n: number, total: number) => string;
  /**
   * Said with the first star and with the last one, because the two end
   * labels are drawn for the eye only: what 1 and 5 stand for.
   */
  lowHint: (n: number) => string;
  highHint: (n: number) => string;
  /** The accessible name of the group of stars. */
  starsGroup: string;
  /** The link that opens the data note. */
  dataLink: string;
  /** The floating label of the comment box (also its accessible name). */
  commentLabel: string;
  /** The helper text under the comment box. */
  helper: string;
  /** `used / max`, both passed in. */
  count: (used: number, max: number) => string;
  send: string;
  sending: string;
  retry: string;
  /** Network, or anything the questionnaire has no line for. */
  sendFailed: string;
  done: string;
  /** The label of the confirm button after "already sent". */
  ok: string;
  /** The accessible name of the X: it also says what closing means. */
  closeLabel: string;
  already: string;
  /** The comment holds characters that cannot be sent (not contact details). */
  commentChars: string;
  keptTitle: string;
  keptBody: string;
  notKeptTitle: string;
  notKeptBody: string;
  withdrawTitle: string;
  withdrawBody: string;
}

const ZH_LOW = "完全不符合";
const ZH_HIGH = "非常符合";
const EN_LOW = "Not at all";
const EN_HIGH = "Spot on";

export const zhTW: ResultFeedbackCopy = {
  title: "這次的推薦符合你的感覺嗎？",
  lowLabel: ZH_LOW,
  highLabel: ZH_HIGH,
  starName: (n, total) => `${n} 星，共 ${total} 星`,
  lowHint: (n) => `${n} 星代表「${ZH_LOW}」`,
  highHint: (n) => `${n} 星代表「${ZH_HIGH}」`,
  starsGroup: "給這次推薦的星等",
  dataLink: "資料如何使用",
  commentLabel: "想多說一點（選填）",
  helper: "例如哪一支排得太前面或太後面。請勿填寫聯絡方式。",
  count: (used, max) => `${used} / ${max}`,
  send: "送出",
  sending: "送出中…",
  retry: "再試一次",
  sendFailed: "送出失敗，請確認網路後再試一次。",
  done: "謝謝你的回饋",
  ok: "完成",
  closeLabel: "關閉（這台裝置上這次結果不再詢問）",
  already: "這次的結果已經送出過回饋。",
  commentChars: "意見裡有無法送出的字元，請刪掉後再試一次。",
  keptTitle: "會保存",
  keptBody:
    "星等、你選填的意見、手型分類、握法、量測方式、你自述的手掌厚度，以及推薦的前三名與配合度等級。",
  notKeptTitle: "不保存",
  notKeptBody: "照片、確切的手部尺寸、姓名與 Email。",
  withdrawTitle: "撤回",
  withdrawBody:
    "登入後送出的回饋，可在刪除帳號資料時一併撤回；未登入送出的回饋無法找回，也無法撤回。",
};

export const en: ResultFeedbackCopy = {
  title: "Do these picks feel right for your hand?",
  lowLabel: EN_LOW,
  highLabel: EN_HIGH,
  starName: (n, total) => `${n} of ${total} stars`,
  lowHint: (n) => `${n} ${n === 1 ? "star" : "stars"} means "${EN_LOW}"`,
  highHint: (n) => `${n} ${n === 1 ? "star" : "stars"} means "${EN_HIGH}"`,
  starsGroup: "Stars for this recommendation",
  dataLink: "How your data is used",
  commentLabel: "Tell us more (optional)",
  helper:
    "For example, which mouse ranked too high or too low. Please don't add contact details.",
  count: (used, max) => `${used} / ${max}`,
  send: "Submit",
  sending: "Submitting…",
  retry: "Try again",
  sendFailed: "Couldn't send. Check your connection and try again.",
  done: "Thanks for your feedback",
  ok: "Done",
  closeLabel: "Close (we won't ask again for this result on this device)",
  already: "You've already sent feedback on this result.",
  commentChars:
    "The comment has characters that can't be sent. Please remove them and try again.",
  keptTitle: "Kept",
  keptBody:
    "Your stars, your optional comment, your hand-type class, grip, how the scan was measured, the palm thickness you stated, and the top three picks with their fit level.",
  notKeptTitle: "Not kept",
  notKeptBody: "Photos, exact hand measurements, names and email.",
  withdrawTitle: "Withdrawing",
  withdrawBody:
    "Feedback sent while signed in can be withdrawn when you delete your account data. Feedback sent while signed out can't be found again, so it can't be withdrawn.",
};

/** The table for a locale. */
export const resultFeedbackCopy = (locale: Locale): ResultFeedbackCopy =>
  pickCopy(locale, { zhTW, en });
