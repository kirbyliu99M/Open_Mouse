/**
 * Words of the feedback sheet on the results page (Kirby, 2026-10-14): one to
 * five stars and an optional comment about whether the ranking feels right.
 * Every zh-TW string is a CANDIDATE (未拍板) until Kirby has read it.
 *
 * The notice (`notice`) goes with `RESULT_FEEDBACK_NOTICE_VERSION` in
 * `src/lib/contracts/result-feedback.ts`: when either changes, bump the
 * version and change the text together, as `questionnaire.ts` does for its
 * consent text. The failure lines (rate limited, network, invalid, contact
 * details in the comment) are the questionnaire's own, read from there so the
 * two never say different things.
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
  /** The accessible name of one star. */
  starName: (n: number) => string;
  /** The accessible name of the group of stars. */
  starsGroup: string;
  more: string;
  placeholder: string;
  /** The accessible name of the comment box. */
  commentLabel: string;
  notice: string;
  send: string;
  sending: string;
  dismiss: string;
  done: string;
  close: string;
  already: string;
}

export const zhTW: ResultFeedbackCopy = {
  title: "這次的推薦符合你的感覺嗎？",
  lowLabel: "完全不符合",
  highLabel: "非常符合",
  starName: (n) => `${n} 星，共 5 星`,
  starsGroup: "給這次推薦的星等",
  more: "想多說一點（選填）",
  placeholder: "例如哪一支排得太前面或太後面。請不要填寫聯絡方式。",
  commentLabel: "你的意見",
  notice:
    "會保存：星等、你選填的意見，以及這次結果的概略資訊：手型大小分類、握法、量測方式和推薦的前三名。不會保存：照片與確切的手部尺寸。意見只有站方看得到，不會公開。沒有登入時送出的回饋，之後無法找回，也就無法撤回；登入後送出的回饋，可以在刪除帳號資料時一併撤回。",
  send: "送出",
  sending: "送出中…",
  dismiss: "稍後再說",
  done: "謝謝你的回饋",
  close: "完成",
  already: "這次的結果已經送出過回饋。",
};

export const en: ResultFeedbackCopy = {
  title: "Does this match how mice feel in your hand?",
  lowLabel: "Not at all",
  highLabel: "Spot on",
  starName: (n) => `${n} of 5 stars`,
  starsGroup: "Stars for this recommendation",
  more: "Tell us more (optional)",
  placeholder:
    "For example, a mouse ranked too high or too low. Please don't write contact details.",
  commentLabel: "Your comment",
  notice:
    "Kept: your stars, the comment if you write one, and a rough outline of this result: your hand's size class, grip, how it was measured and the top three picks. Not kept: photos or exact hand measurements. Only the maintainers can see the comment, and it is never public. Feedback sent without signing in can't be found again, so it can't be taken back. Feedback sent while signed in can be taken back when you delete your account data.",
  send: "Send",
  sending: "Sending…",
  dismiss: "Not now",
  done: "Thanks for the feedback",
  close: "Done",
  already: "You've already sent feedback on this result.",
};

/** The table for a locale. */
export const resultFeedbackCopy = (locale: Locale): ResultFeedbackCopy =>
  pickCopy(locale, { zhTW, en });
