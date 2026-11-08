/**
 * Words of the opt-in error photo (src/lib/contracts/error-photo.ts): the
 * button on a scan failure, the "numbers look wrong?" link, the consent sheet,
 * and the deletion form on /privacy. zh-TW and English, same keys. Only shown
 * while `ERROR_PHOTO_ENABLED`.
 *
 * EVERY string here is a CANDIDATE (未拍板): Kirby's 2026-11-08 wording with
 * the privacy review's replacements (Claude, 2026-11-08), until Kirby has read
 * them on a phone. No medical wording. The privacy policy's own text is
 * another lane's (src/lib/copy/legal.ts); these strings must not contradict
 * it once that lane lands.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

/** Where the deletion form sits on /privacy (the success message links here). */
export const DELETE_PHOTO_ANCHOR = "delete-photo";
export const DELETE_PHOTO_HREF = `/privacy#${DELETE_PHOTO_ANCHOR}`;

export interface ErrorPhotoCopy {
  /** The button on a failure sheet, and the sheet's send for "numbers-wrong". */
  sendButton: string;
  /** The quiet link under the measured numbers. */
  numbersWrongLink: string;
  /** The consent sheet. */
  title: string;
  points: readonly [string, string, string];
  /** One more line in paper mode (the card is blacked out only in card mode). */
  paperModeNote: string;
  previewAlt: string;
  checkbox: string;
  send: string;
  cancel: string;
  sending: string;
  /** "numbers-wrong": the optional typed values. */
  expectedHeading: string;
  expectedLength: string;
  expectedWidth: string;
  expectedUnit: string;
  expectedInvalid: string;
  /** After a send. `{code}` is split around: before + code + middle + link + after. */
  successBefore: string;
  successMiddle: string;
  successLink: string;
  successAfter: string;
  done: string;
  failTooMany: string;
  failUnavailable: string;
  failGeneric: string;
  /** The deletion form on /privacy. */
  deleteTitle: string;
  deleteIntro: string;
  deleteLabel: string;
  deleteButton: string;
  deleting: string;
  deleteDone: string;
  deleteNotFound: string;
  deleteInvalid: string;
  deleteTooMany: string;
  deleteFailed: string;
}

export const zhTW: ErrorPhotoCopy = {
  sendButton: "傳送這張照片，幫我們修正",
  numbersWrongLink: "數字看起來不對？",
  title: "傳送照片之前",
  points: [
    "只會傳送手和紙張（或卡片）附近的範圍；用卡片量測時，偵測到的卡片會先在你的手機上塗黑；拍攝位置等檔案資訊也會移除。",
    "照片只有 Palmate 團隊看得到，只用來找出量錯的原因，上傳後約 6 個月（180 天）自動刪除。",
    "照片不會存進你的帳號，刪除帳號也不會刪到它；照片會附上這次量到的數字（取整到 1 公釐），方便我們找出哪裡量錯。送出後會給你一組刪除碼，隨時可以用它刪除。",
  ],
  paperModeNote: "畫面裡如果有卡片或文件，請先移開再傳送。",
  previewAlt: "將要傳送的照片",
  checkbox: "我同意依上述方式傳送並保存這張照片",
  send: "傳送",
  cancel: "不用了",
  sending: "傳送中…",
  expectedHeading: "你自己量到的數字（選填）",
  expectedLength: "手長",
  expectedWidth: "手寬",
  expectedUnit: "公分",
  expectedInvalid: "請輸入 5 到 40 之間的數字，或留空。",
  successBefore: "收到了，謝謝！你的刪除碼是 ",
  successMiddle: "。請截圖保存，之後可以在",
  successLink: "隱私權政策頁",
  successAfter: "用它刪除照片。",
  done: "完成",
  failTooMany: "傳送次數太多了，請過一小時再試。",
  failUnavailable: "現在暫時無法接收照片，請稍後再試。",
  failGeneric: "傳送失敗，請稍後再試。",
  deleteTitle: "刪除我傳送的照片",
  deleteIntro: "輸入傳送照片後拿到的 12 碼刪除碼，照片會立刻刪除。",
  deleteLabel: "刪除碼",
  deleteButton: "刪除照片",
  deleting: "刪除中…",
  deleteDone: "照片已刪除。",
  deleteNotFound:
    "找不到這組刪除碼的照片。請確認是否輸入正確；照片也可能已經自動刪除。",
  deleteInvalid: "刪除碼是 12 個英文字母和數字。",
  deleteTooMany: "嘗試次數太多了，請稍後再試。",
  deleteFailed: "現在無法刪除，請稍後再試。",
};

export const en: ErrorPhotoCopy = {
  sendButton: "Send this photo to help us fix it",
  numbersWrongLink: "Numbers look wrong?",
  title: "Before you send this photo",
  points: [
    "Only the area around your hand and the paper (or card) is sent; when you measure with a card, the detected card is blacked out on your phone first, and location and camera details are removed.",
    "Only the Palmate team can see it, only to find out why the measurement went wrong, and it is deleted automatically about 6 months (180 days) after upload.",
    "It isn't saved to your account, and deleting your account won't delete it; it carries the numbers measured this time (rounded to 1 mm) so we can find what went wrong. After sending you'll get a deletion code you can use any time.",
  ],
  paperModeNote:
    "If a card or document is in the picture, move it away before sending.",
  previewAlt: "The photo that will be sent",
  checkbox: "I agree to send and keep this photo as described",
  send: "Send",
  cancel: "No thanks",
  sending: "Sending…",
  expectedHeading: "What you measured yourself (optional)",
  expectedLength: "Hand length",
  expectedWidth: "Hand width",
  expectedUnit: "cm",
  expectedInvalid: "Enter a number from 5 to 40, or leave it empty.",
  successBefore: "Got it, thank you! Your deletion code is ",
  successMiddle: ". Take a screenshot; you can use it on the ",
  successLink: "Privacy page",
  successAfter: " to delete the photo.",
  done: "Done",
  failTooMany: "Too many photos sent. Try again in an hour.",
  failUnavailable: "Photos can't be received right now. Try again later.",
  failGeneric: "Sending failed. Try again later.",
  deleteTitle: "Delete a photo I sent",
  deleteIntro:
    "Enter the 12-character deletion code you got after sending a photo, and the photo is deleted at once.",
  deleteLabel: "Deletion code",
  deleteButton: "Delete photo",
  deleting: "Deleting…",
  deleteDone: "The photo has been deleted.",
  deleteNotFound:
    "No photo has this code. Check it was typed correctly; the photo may also have been deleted automatically already.",
  deleteInvalid: "The code is 12 letters and digits.",
  deleteTooMany: "Too many tries. Try again later.",
  deleteFailed: "Couldn't delete it right now. Try again later.",
};

export function errorPhotoCopy(locale: Locale): ErrorPhotoCopy {
  return pickCopy(locale, { zhTW, en });
}
