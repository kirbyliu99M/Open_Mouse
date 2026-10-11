/**
 * Words of the profile page 「我的檔案」 (the URL stays `/account`): the
 * signed-out view, the signed-in sections (person block, 基本資料, 我的手,
 * 我的滑鼠, 其他回答, 資料), the nickname and avatar sheets, the delete dialog
 * and the sign-in button.
 *
 * Every zh-TW string is a CANDIDATE (未拍板), Claude's Taiwan wording (我的檔案,
 * 登入, 量測, 滑鼠, 刪除), until Kirby has read it. The delete dialog's words
 * (`deleteTitle`, `deleteBody`, `deleteError`, `deleteEverything`) are the
 * earlier ones and do not change (Kirby, 2026-10-06). Still open and asked of
 * Claude, not decided here: the words of `answerWithoutAccount` (the signed-out
 * link) and of the results page's reminder.
 *
 * Numbers (scan counts, lengths, ratings) are passed in by the page; a slash in
 * a rating is always half-width (`4/5`).
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface AccountCopy {
  metaTitle: string;
  home: string;
  /** The page's name: the `<h1>` and the top bar's step label. */
  title: string;
  /** The line under the signed-in `<h1>`. */
  signedInSubtitle: string;
  signedIn: string;

  // Signed out.
  signedOutSubtitle: string;
  /** Shown instead of `signedOutSubtitle` when sign-in is not set up. */
  signedOutSubtitleUnavailable: string;
  /** The link under the sign-in button (candidate; Claude decides the words). */
  answerWithoutAccount: string;
  /** The line under that link: answers sent without signing in cannot be taken back. */
  answerWithoutAccountNote: string;
  /** Under the sign-in button: what is kept when you sign in (the earlier words, unchanged). */
  finePrint: string;
  unavailable: string;
  scanMyHand: string;
  whenOpens: string;

  // Sign-in / sign-out button.
  continueWithGoogle: string;
  signOut: string;
  signingIn: string;
  signingOut: string;

  // The person block and 基本資料.
  basicsHeading: string;
  avatarRow: string;
  nicknameRow: string;
  emailRow: string;
  /** The `aria-label` of the avatar image block. */
  avatarLabel: string;

  // 我的手.
  handHeading: string;
  /** `date` is already formatted ("10/12"). */
  handLatest: (date: string) => string;
  handLength: string;
  palmWidth: string;
  gripRow: string;
  thicknessRow: string;
  grip: { palm: string; claw: string; fingertip: string };
  thickness: { thin: string; medium: string; thick: string };
  earlierScans: (count: number) => string;
  earlierScansLabel: string;
  leftHand: string;
  rightHand: string;
  noScanTitle: string;
  noScanBody: string;

  // 我的滑鼠.
  miceHeading: string;
  miceCount: (count: number) => string;
  currentMouse: string;
  satisfaction: (rating: number) => string;
  used: (duration: string) => string;
  durations: {
    under_1_month: string;
    "1_to_6_months": string;
    "6_to_12_months": string;
    "1_to_3_years": string;
    over_3_years: string;
  };
  sizeFeel: (feel: string) => string;
  sizeFeels: { small: string; just_right: string; large: string };
  /** A brand answered without a model; `brand` is the brand's own name. */
  otherModel: (brand: string) => string;
  /** The brand answer `other`. */
  otherBrand: string;
  addMouse: string;
  miceLoading: string;
  miceError: string;
  retry: string;
  noAnswersTitle: string;
  noAnswersBody: string;
  /** The empty-state button; it opens the questionnaire form (Kirby, 2026-10-12). */
  answerQuestionnaire: string;
  noAnswersNoScan: string;

  // 其他回答.
  otherHeading: string;
  mainUseRow: string;
  mainUses: { office: string; gaming: string; mixed: string };
  feedbackRow: string;
  feedbackNote: string;
  /** The value of a 其他回答 row that has no answer yet (candidate). */
  notFilled: string;

  // 資料.
  dataHeading: string;
  preparingExport: string;
  exportMyData: string;
  deleteEverything: string;
  exportError: string;

  // The nickname and avatar sheets (not wired yet: no route saves them).
  cancel: string;
  save: string;
  saving: string;
  nicknameTitle: string;
  nicknameLabel: string;
  nicknameClear: string;
  nicknameCount: (used: number, max: number) => string;
  avatarTitle: string;
  choosePhoto: string;
  useGoogleAvatar: string;
  avatarNote: string;
  avatarReadError: string;
  /** Shown in a sheet while no route saves its change. */
  notWired: string;
  saveError: string;

  // The delete dialog.
  deleteTitle: string;
  /** `scanCount` is 0 when there is none to name. */
  deleteBody: (scanCount: number) => string;
  deleteError: string;
  deleting: string;
}

export const zhTW: AccountCopy = {
  metaTitle: "我的檔案",
  home: "首頁",
  title: "我的檔案",
  signedInSubtitle: "你的量測紀錄與問卷回答。",
  signedIn: "已登入",

  signedOutSubtitle:
    "登入後，可以回頭查看與修改你的問卷回答，也能在不同裝置打開你的量測。",
  signedOutSubtitleUnavailable:
    "你可以選擇是否登入。沒有帳號的話，掃描紀錄會在一段時間後自動刪除。",
  answerWithoutAccount: "不登入，直接回答問卷",
  answerWithoutAccountNote:
    "不登入也可以送出問卷。沒有登入時送出的回答，之後無法找回，也就無法撤回。",
  finePrint:
    "我們會保存你的電子郵件地址和掃描紀錄，絕不會保存你的照片。登入時，你目前的掃描會併入你的帳號。",
  unavailable:
    "目前無法登入。你仍然可以掃描，結果會保留一段時間，之後自動刪除。",
  scanMyHand: "掃描我的手",
  whenOpens: "開放登入後，你的掃描紀錄就能存進你的帳號。",

  continueWithGoogle: "使用 Google 繼續",
  signOut: "登出",
  signingIn: "登入中…",
  signingOut: "登出中…",

  basicsHeading: "基本資料",
  avatarRow: "頭像",
  nicknameRow: "暱稱",
  emailRow: "電子郵件",
  avatarLabel: "你的頭像",

  handHeading: "我的手",
  handLatest: (date) => `${date} 最近一次`,
  handLength: "手長",
  palmWidth: "掌寬",
  gripRow: "握法",
  thicknessRow: "掌厚",
  grip: { palm: "趴握", claw: "抓握", fingertip: "指握" },
  thickness: { thin: "薄", medium: "中", thick: "厚" },
  earlierScans: (n) => `較早的 ${n} 次量測`,
  earlierScansLabel: "較早的量測",
  leftHand: "左手",
  rightHand: "右手",
  noScanTitle: "還沒有量測",
  noScanBody: "量測你的手，才能看到合手度，也才能回答問卷。",

  miceHeading: "我的滑鼠",
  miceCount: (n) => `${n} 支`,
  currentMouse: "目前使用",
  satisfaction: (n) => `滿意 ${n}/5`,
  used: (d) => `使用 ${d}`,
  durations: {
    under_1_month: "不到 1 個月",
    "1_to_6_months": "1 個月至小於 6 個月",
    "6_to_12_months": "6–12 個月",
    "1_to_3_years": "1–3 年",
    over_3_years: "超過 3 年",
  },
  sizeFeel: (f) => `大小 ${f}`,
  sizeFeels: { small: "偏小", just_right: "剛好", large: "偏大" },
  otherModel: (brand) => `${brand}（其他型號）`,
  otherBrand: "其他品牌",
  addMouse: "加入另一支滑鼠",
  miceLoading: "正在載入你的回答…",
  miceError: "無法載入你的回答，請稍後再試一次。",
  retry: "重試",
  noAnswersTitle: "還沒有回答問卷",
  noAnswersBody: "回答幾個問題，幫手掌大小相近的人找到合適的滑鼠。",
  answerQuestionnaire: "我的滑鼠",
  noAnswersNoScan: "量測之後，才能回答問卷。",

  otherHeading: "其他回答",
  mainUseRow: "主要用途",
  mainUses: { office: "辦公", gaming: "遊戲", mixed: "辦公與遊戲" },
  feedbackRow: "意見",
  feedbackNote: "文字意見僅供維護者查看，不會公開。",
  notFilled: "未填",

  dataHeading: "資料",
  preparingExport: "正在準備匯出…",
  exportMyData: "匯出我的資料",
  deleteEverything: "刪除所有資料",
  exportError: "無法匯出，請檢查網路連線後再試一次。",

  cancel: "取消",
  save: "儲存",
  saving: "儲存中…",
  nicknameTitle: "暱稱",
  nicknameLabel: "暱稱",
  nicknameClear: "清除暱稱",
  nicknameCount: (used, max) => `${used}/${max}`,
  avatarTitle: "頭像",
  choosePhoto: "選擇照片",
  useGoogleAvatar: "改回 Google 頭像",
  avatarNote: "會裁成正方形，並以圓形顯示。",
  avatarReadError: "無法讀取這張照片，請換一張再試。",
  notWired: "這項修改還不能儲存。",
  saveError: "無法儲存，請檢查網路連線後再試一次。",

  deleteTitle: "要刪除所有資料嗎？",
  deleteBody: (n) =>
    `這會永久刪除${n > 0 ? `你全部 ${n} 筆掃描紀錄，以及` : ""}你的帳號（包含來自 Google 的電子郵件地址和姓名），並將你登出。這個動作無法復原。`,
  deleteError: "無法刪除，請檢查網路連線後再試一次。",
  deleting: "刪除中…",
};

export const en: AccountCopy = {
  metaTitle: "My profile",
  home: "Home",
  title: "My profile",
  signedInSubtitle: "Your measurements and questionnaire answers.",
  signedIn: "Signed in",

  signedOutSubtitle:
    "Sign in to come back to your questionnaire answers and change them, and to open your measurements on any device.",
  signedOutSubtitleUnavailable:
    "Signing in is optional. Without an account, a scan expires automatically after a while.",
  answerWithoutAccount: "Answer the questionnaire without signing in",
  answerWithoutAccountNote:
    "You can send the questionnaire without signing in. Answers sent while signed out can't be found again, so they can't be taken back.",
  finePrint:
    "We keep your email address and your scans — never your photo. Your current scan joins your account when you sign in.",
  unavailable:
    "Sign-in is unavailable right now. You can still scan — your result is kept for a while, then expires automatically.",
  scanMyHand: "Scan my hand",
  whenOpens: "When sign-in opens, your scans can be saved to your account.",

  continueWithGoogle: "Continue with Google",
  signOut: "Sign out",
  signingIn: "Signing in…",
  signingOut: "Signing out…",

  basicsHeading: "Basics",
  avatarRow: "Avatar",
  nicknameRow: "Nickname",
  emailRow: "Email",
  avatarLabel: "Your avatar",

  handHeading: "My hand",
  handLatest: (date) => `Latest, ${date}`,
  handLength: "Hand length",
  palmWidth: "Palm width",
  gripRow: "Grip",
  thicknessRow: "Palm thickness",
  grip: { palm: "Palm", claw: "Claw", fingertip: "Fingertip" },
  thickness: { thin: "Thin", medium: "Medium", thick: "Thick" },
  earlierScans: (n) =>
    n === 1 ? "1 earlier measurement" : `${n} earlier measurements`,
  earlierScansLabel: "Earlier measurements",
  leftHand: "Left hand",
  rightHand: "Right hand",
  noScanTitle: "No measurement yet",
  noScanBody:
    "Measure your hand to see which mice fit, and to answer the questionnaire.",

  miceHeading: "My mice",
  miceCount: (n) => (n === 1 ? "1 mouse" : `${n} mice`),
  currentMouse: "In use now",
  satisfaction: (n) => `Satisfaction ${n}/5`,
  used: (d) => `Used ${d}`,
  durations: {
    under_1_month: "under 1 month",
    "1_to_6_months": "1 to under 6 months",
    "6_to_12_months": "6–12 months",
    "1_to_3_years": "1–3 years",
    over_3_years: "over 3 years",
  },
  sizeFeel: (f) => `Size ${f}`,
  sizeFeels: { small: "small", just_right: "just right", large: "large" },
  otherModel: (brand) => `${brand} (another model)`,
  otherBrand: "Other brand",
  addMouse: "Add another mouse",
  miceLoading: "Loading your answers…",
  miceError: "Couldn't load your answers. Try again in a moment.",
  retry: "Try again",
  noAnswersTitle: "You haven't answered the questionnaire",
  noAnswersBody:
    "Answer a few questions to help people with a similar hand size find a mouse.",
  answerQuestionnaire: "My mice",
  noAnswersNoScan: "Measure your hand first, then you can answer.",

  otherHeading: "Other answers",
  mainUseRow: "Main use",
  mainUses: { office: "Office", gaming: "Gaming", mixed: "Office and gaming" },
  feedbackRow: "Comment",
  feedbackNote:
    "Your comment is read by the maintainers only and is never public.",
  notFilled: "Not filled in",

  dataHeading: "Data",
  preparingExport: "Preparing export…",
  exportMyData: "Export my data",
  deleteEverything: "Delete everything",
  exportError: "Couldn't export — check your connection and try again.",

  cancel: "Cancel",
  save: "Save",
  saving: "Saving…",
  nicknameTitle: "Nickname",
  nicknameLabel: "Nickname",
  nicknameClear: "Clear nickname",
  nicknameCount: (used, max) => `${used}/${max}`,
  avatarTitle: "Avatar",
  choosePhoto: "Choose a photo",
  useGoogleAvatar: "Use my Google avatar again",
  avatarNote: "It is cropped to a square and shown as a circle.",
  avatarReadError: "Couldn't read that photo. Try another one.",
  notWired: "This change can't be saved yet.",
  saveError: "Couldn't save — check your connection and try again.",

  deleteTitle: "Delete everything?",
  deleteBody: (n) =>
    `This permanently deletes ${n > 0 ? `all ${n} of your scans and ` : ""}your account, including the email address and name from Google, and signs you out. This can't be undone.`,
  deleteError: "Couldn't delete — check your connection and try again.",
  deleting: "Deleting…",
};

export function accountCopy(locale: Locale): AccountCopy {
  return pickCopy(locale, { zhTW, en });
}
