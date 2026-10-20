/**
 * Words of the questionnaire form 「我的滑鼠」, the mouse picker, the sheet for
 * a mouse that is not in the catalogue, the edit sheet and the confirmation
 * before a mouse's answers are removed (Pencil frames QrV23, c9cki, TiEvE,
 * CFbGl, LHhIs, gDxD7 of design-exports/profile-page-2026-10-12, candidate).
 *
 * Every zh-TW string is a CANDIDATE (未拍板) until Kirby has read it. The
 * consent paragraphs started as the frame's text (a shortened form of
 * candidate E in copy-review-2026-10-06.md) and were CHANGED after review
 * (2026-10-12, candidate, for Kirby to read): the "kept" list now names every
 * item the form sends (use time, what does not fit, which mouse is the current
 * one, the brand and size feel of other mice), and "不會保存：照片、姓名、Email"
 * became "不會保存：照片" plus a line telling people not to write a name or
 * contact details in the comment, because the contract forbids a consent text
 * that says no personal detail is stored (a name typed into the comment is
 * kept). The consent text goes with
 * `SURVEY_CONSENT_VERSION` in the contract: when either changes, the other
 * must be looked at. It does not say that the model of a mouse that is not in
 * the catalogue is kept, because the model field is not sent yet.
 *
 * Words that the frames did not decide, and that are therefore Claude's
 * (Builder Q's) candidates: `choosePlaceholder`, `satisfactionNeeded`, every
 * line of the error and "already answered" states, the confirmation after a
 * signed-out submit, the sheet titles of the main-use and comment edits, the
 * over-the-cap line, and the "remove" buttons of the form's extra mice.
 *
 * Numbers (limits, counts) are passed in by the component, never written here
 * (hard rule 2). A use-time label is NOT here: the form reads
 * `accountCopy(locale).durations`, so the form and the profile page can never
 * say two things.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface QuestionnaireCopy {
  // The form.
  title: string;
  subtitle: string;
  qCurrent: string;
  qCurrentHint: string;
  choosePlaceholder: string;
  qSatisfaction: string;
  satisfactionLow: string;
  satisfactionHigh: string;
  /** The accessible name of one option of the 1 to 5 control. */
  satisfactionOption: (score: number) => string;
  /** Shown while a catalogue mouse is chosen and no score is given: the score is what a rating needs. */
  satisfactionNeeded: string;
  qDuration: string;
  qPain: string;
  pain: {
    length: string;
    width: string;
    height: string;
    weight: string;
    thumb: string;
    buttons: string;
    other: string;
  };
  qMainUse: string;
  mainUses: { office: string; gaming: string; mixed: string };
  qOthers: string;
  othersHint: (remaining: number) => string;
  addMouse: string;
  /** A row of an extra mouse in the form: the button that takes it out again. */
  removeExtra: (name: string) => string;
  qComment: string;
  commentPlaceholder: string;
  commentCount: (used: number, max: number) => string;
  consentLabel: string;
  consentKept: string;
  consentNotKept: string;
  consentWithdraw: string;
  submit: string;
  submitting: string;
  /** The add button is off and this line says why: the form holds as many mice as one answer can. */
  othersFull: (max: number) => string;
  /** Closes the form when there is nothing to edit instead. */
  close: string;
  /** Marks a brand in the brand list that the person has already answered. */
  brandAnswered: (brand: string) => string;

  // What the server said.
  alreadyAnswered: string;
  editInstead: string;
  scanGone: string;
  rateLimited: string;
  sendInvalid: string;
  sendFeedbackInvalid: string;
  sendNetwork: string;
  sessionExpired: string;

  // After a signed-out submit.
  doneTitle: string;
  doneBody: string;
  doneClose: string;

  // The picker.
  pickerTitle: string;
  searchLabel: string;
  searchPlaceholder: string;
  brandFilterLabel: string;
  brandAll: string;
  noResults: string;
  notFoundOther: string;
  /** Read out for the mouse that is chosen. */
  chosen: string;

  // The sheet for a mouse that is not in the catalogue.
  otherTitle: string;
  brandLabel: string;
  modelLabel: string;
  modelPlaceholder: string;
  sizeFeelLabel: string;
  sizeFeels: { small: string; just_right: string; large: string };
  otherDone: string;
  backToList: string;

  // The edit sheet.
  editNote: string;
  satisfactionLegend: string;
  isCurrent: string;
  removeMouse: string;
  overCap: (max: number) => string;
  /** The title of the sheet for a mouse that is not in the catalogue and is being edited. */
  otherEditTitle: (brand: string) => string;

  // The confirmation before removing one mouse.
  removeTitle: string;
  removeBody: (name: string) => string;
  removeConfirm: string;
  removing: string;

  // The sheets for the main use and the comment.
  mainUseTitle: string;
  feedbackTitle: string;
  feedbackNote: string;
}

export const zhTW: QuestionnaireCopy = {
  title: "我的滑鼠",
  subtitle: "全部選填，答幾題都可以。",
  qCurrent: "你現在最常用的是哪一支滑鼠？",
  qCurrentHint: "從清單選；沒有就選「其他」，再選品牌。",
  choosePlaceholder: "選擇滑鼠",
  qSatisfaction: "整體滿意度",
  satisfactionLow: "1 非常不滿意",
  satisfactionHigh: "5 非常滿意",
  satisfactionOption: (score) => `滿意度 ${score} 分`,
  satisfactionNeeded: "從清單選了滑鼠時，要給一個分數才能送出。",
  qDuration: "使用時間",
  qPain: "滑鼠哪些地方不合適？（可複選）",
  pain: {
    length: "長度",
    width: "寬度",
    height: "高度",
    weight: "重量",
    thumb: "拇指位置",
    buttons: "按鍵",
    other: "其他",
  },
  qMainUse: "你主要用滑鼠做什麼？",
  mainUses: { office: "辦公", gaming: "遊戲", mixed: "兩者都有" },
  qOthers: "還用過其他滑鼠嗎？",
  othersHint: (n) => `可以各評一次，最多再 ${n} 支。`,
  addMouse: "加入另一支滑鼠",
  removeExtra: (name) => `移除 ${name}`,
  qComment: "還有什麼想告訴我們的？",
  commentPlaceholder: "請不要填寫聯絡方式。",
  commentCount: (used, max) => `${used}/${max}`,
  consentLabel: "我同意，送出我的回答",
  consentKept:
    "會保存：手長與掌寬（只存 5 mm 一格的範圍，不存確切數字）、握法、你評的滑鼠與滿意度、使用時間、哪裡不合適、哪一支是你現在用的、你選的其他品牌與大小感覺、主要用途，以及你選填的意見。登入後，你評過的滑鼠也會用來微調你自己的推薦結果。",
  consentNotKept:
    "不會保存：照片。意見欄請不要填姓名或聯絡方式；意見欄只有站方看得到，不會公開。",
  consentWithdraw:
    "沒有登入時送出的回答，之後無法找回，也就無法撤回；登入後送出的回答，可以在刪除帳號資料時一併撤回。",
  submit: "送出",
  submitting: "送出中…",
  othersFull: (max) => `一次最多回答 ${max} 支滑鼠，已經滿了。`,
  close: "關閉",
  brandAnswered: (brand) => `${brand}（已回答）`,

  alreadyAnswered: "這次量測已經送出過回答。",
  editInstead: "修改我的回答",
  scanGone: "找不到這次的量測，可能已經過期。請重新量測後再回答。",
  rateLimited: "目前送出的人較多，請稍後再試一次。",
  sendInvalid: "無法送出，請檢查內容後再試一次。",
  sendFeedbackInvalid: "意見裡似乎有電子郵件或電話，請刪掉後再送出。",
  sendNetwork: "無法送出，請檢查網路連線後再試一次。",
  sessionExpired: "登入已失效，請重新登入後再試一次。",

  doneTitle: "已收到你的回答",
  doneBody: "謝謝你。沒有登入時送出的回答，之後無法找回，也就無法撤回。",
  doneClose: "完成",

  pickerTitle: "選擇滑鼠",
  searchLabel: "搜尋滑鼠",
  searchPlaceholder: "搜尋品牌或型號",
  brandFilterLabel: "品牌",
  brandAll: "全部",
  noResults: "沒有符合的滑鼠。",
  notFoundOther: "找不到？選「其他」",
  chosen: "已選",

  otherTitle: "其他滑鼠",
  brandLabel: "品牌",
  modelLabel: "型號（選填）",
  modelPlaceholder: "輸入型號，例如 DeathAdder V3",
  sizeFeelLabel: "這支滑鼠對你的手來說",
  sizeFeels: { small: "偏小", just_right: "剛剛好", large: "偏大" },
  otherDone: "完成",
  backToList: "改從清單選",

  editNote:
    "評分與選項會彙整成統計，供手掌大小相近的人參考；文字意見僅供維護者查看。",
  satisfactionLegend: "滿意度",
  isCurrent: "這是我現在用的滑鼠",
  removeMouse: "移除這支滑鼠",
  overCap: (max) => `你的滑鼠超過 ${max} 支的上限，請先移除一支再儲存。`,
  otherEditTitle: (brand) => `${brand}（其他型號）`,

  removeTitle: "移除這支滑鼠的回答？",
  removeBody: (name) => `${name}。移除後無法復原。`,
  removeConfirm: "移除",
  removing: "移除中…",

  mainUseTitle: "主要用途",
  feedbackTitle: "意見",
  feedbackNote: "文字意見僅供維護者查看，不會公開。請不要填寫聯絡方式。",
};

export const en: QuestionnaireCopy = {
  title: "My mice",
  subtitle: "Everything is optional. Answer as many as you like.",
  qCurrent: "Which mouse do you use most now?",
  qCurrentHint: "Pick from the list; if it isn't there, choose “Other”.",
  choosePlaceholder: "Choose a mouse",
  qSatisfaction: "Overall satisfaction",
  satisfactionLow: "1 Very unhappy",
  satisfactionHigh: "5 Very happy",
  satisfactionOption: (score) => `Satisfaction ${score} out of 5`,
  satisfactionNeeded: "When you pick a mouse from the list, give it a score.",
  qDuration: "How long have you used it?",
  qPain: "What doesn't suit you about it? (pick any)",
  pain: {
    length: "Length",
    width: "Width",
    height: "Height",
    weight: "Weight",
    thumb: "Thumb position",
    buttons: "Buttons",
    other: "Other",
  },
  qMainUse: "What do you mainly use a mouse for?",
  mainUses: { office: "Office", gaming: "Gaming", mixed: "Both" },
  qOthers: "Have you used other mice?",
  othersHint: (n) =>
    n === 1
      ? "You can rate each once, up to 1 more."
      : `You can rate each once, up to ${n} more.`,
  addMouse: "Add another mouse",
  removeExtra: (name) => `Remove ${name}`,
  qComment: "Anything else you'd like to tell us?",
  commentPlaceholder: "Please don't write contact details.",
  commentCount: (used, max) => `${used}/${max}`,
  consentLabel: "I agree. Send my answers.",
  consentKept:
    "Kept: hand length and palm width (only as a 5 mm range, never the exact numbers), grip, the mice you rate and how satisfied you are, how long you've used them, what doesn't suit you, which one you use now, the brand and size feel of other mice you pick, main use, and the comment if you write one. If you are signed in, the mice you rate are also used to fine-tune your own results.",
  consentNotKept:
    "Not kept: photos. Please don't write your name or contact details in the comment; only the maintainers can see the comment, and it is never public.",
  consentWithdraw:
    "Answers sent without signing in can't be found again, so they can't be taken back. Answers sent while signed in can be taken back when you delete your account data.",
  submit: "Send",
  submitting: "Sending…",
  othersFull: (max) =>
    `One answer holds at most ${max} mice, and that many are in.`,
  close: "Close",
  brandAnswered: (brand) => `${brand} (answered)`,

  alreadyAnswered: "This measurement has already sent its answers.",
  editInstead: "Change my answers",
  scanGone:
    "That measurement can't be found; it may have expired. Measure again, then answer.",
  rateLimited: "Many people are sending right now. Try again in a moment.",
  sendInvalid: "Couldn't send. Check your answers and try again.",
  sendFeedbackInvalid:
    "The comment seems to hold an email address or a phone number. Remove it, then send.",
  sendNetwork: "Couldn't send. Check your connection and try again.",
  sessionExpired: "You've been signed out. Sign in again and retry.",

  doneTitle: "We've got your answers",
  doneBody:
    "Thank you. Answers sent without signing in can't be found again, so they can't be taken back.",
  doneClose: "Done",

  pickerTitle: "Choose a mouse",
  searchLabel: "Search mice",
  searchPlaceholder: "Search brand or model",
  brandFilterLabel: "Brand",
  brandAll: "All",
  noResults: "No mouse matches.",
  notFoundOther: "Can't find it? Choose “Other”",
  chosen: "Chosen",

  otherTitle: "Another mouse",
  brandLabel: "Brand",
  modelLabel: "Model (optional)",
  modelPlaceholder: "Type the model, e.g. DeathAdder V3",
  sizeFeelLabel: "For your hand, this mouse is",
  sizeFeels: { small: "Small", just_right: "Just right", large: "Large" },
  otherDone: "Done",
  backToList: "Choose from the list instead",

  editNote:
    "Ratings and choices are combined into statistics for people with a similar hand size; the comment is read by the maintainers only.",
  satisfactionLegend: "Satisfaction",
  isCurrent: "This is the mouse I use now",
  removeMouse: "Remove this mouse",
  overCap: (max) =>
    `You have more than the ${max} mice allowed. Remove one before saving.`,
  otherEditTitle: (brand) => `${brand} (another model)`,

  removeTitle: "Remove the answers about this mouse?",
  removeBody: (name) => `${name}. This can't be undone.`,
  removeConfirm: "Remove",
  removing: "Removing…",

  mainUseTitle: "Main use",
  feedbackTitle: "Comment",
  feedbackNote:
    "Your comment is read by the maintainers only and is never public. Please don't write contact details.",
};

export function questionnaireCopy(locale: Locale): QuestionnaireCopy {
  return pickCopy(locale, { zhTW, en });
}
