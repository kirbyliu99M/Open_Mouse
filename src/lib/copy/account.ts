/**
 * Words of the account page (signed out, signed in, the scan list, the delete
 * dialog) and its sign-in button. Every zh-TW string is a CANDIDATE (未拍板),
 * Claude's Taiwan wording (帳號, 登入, 掃描, 刪除), until Kirby has read it.
 * Numbers (the scan count) are passed in by the page.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface AccountCopy {
  metaTitle: string;
  home: string;
  /** The top bar's step label and the signed-in eyebrow. */
  account: string;

  // Signed out.
  keepYourScans: string;
  subtitle: string;
  benefitKeep: string;
  benefitDevices: string;
  benefitDelete: string;
  scanWithoutAccount: string;
  finePrint: string;
  unavailable: string;
  scanMyHand: string;
  whenOpens: string;

  // Signed in.
  signedIn: string;
  yourScans: string;
  keptUntil: string;

  // Sign-in / sign-out button.
  continueWithGoogle: string;
  signOut: string;
  signingIn: string;
  signingOut: string;

  // The scan list.
  preparingExport: string;
  exportJson: string;
  deleteEverything: string;
  exportError: string;
  noScans: string;
  startMeasuring: string;
  scansLabel: string;
  leftHand: string;
  rightHand: string;
  handLength: string;
  palmLength: string;
  palmWidth: string;

  // The delete dialog.
  deleteTitle: string;
  /** `scanCount` is 0 when there is none to name. */
  deleteBody: (scanCount: number) => string;
  deleteError: string;
  cancel: string;
  deleting: string;
}

export const zhTW: AccountCopy = {
  metaTitle: "帳號",
  home: "首頁",
  account: "帳號",

  keepYourScans: "保存你的掃描紀錄",
  subtitle: "登入是選擇性的。沒有帳號的話，掃描紀錄會在一段時間後自動刪除。",
  benefitKeep: "你的掃描紀錄會保留到你自己刪除為止",
  benefitDevices: "在任何裝置上開啟你的結果",
  benefitDelete: "隨時一鍵刪除所有資料",
  scanWithoutAccount: "不登入直接掃描",
  finePrint:
    "我們會保存你的電子郵件地址和掃描紀錄，絕不會保存你的照片。登入時，你目前的掃描會併入你的帳號。",
  unavailable:
    "目前無法登入。你仍然可以掃描，結果會保留一段時間，之後自動刪除。",
  scanMyHand: "掃描我的手",
  whenOpens: "開放登入後，你的掃描紀錄就能存進你的帳號。",

  signedIn: "已登入",
  yourScans: "你的掃描紀錄",
  keptUntil: "保留到你刪除為止。",

  continueWithGoogle: "使用 Google 繼續",
  signOut: "登出",
  signingIn: "登入中…",
  signingOut: "登出中…",

  preparingExport: "正在準備匯出…",
  exportJson: "匯出為 JSON",
  deleteEverything: "刪除所有資料",
  exportError: "無法匯出，請檢查網路連線後再試一次。",
  noScans: "還沒有掃描紀錄。",
  startMeasuring: "開始測量",
  scansLabel: "你的掃描紀錄",
  leftHand: "左手",
  rightHand: "右手",
  handLength: "手長",
  palmLength: "掌長",
  palmWidth: "掌寬",

  deleteTitle: "要刪除所有資料嗎？",
  deleteBody: (n) =>
    `這會永久刪除${n > 0 ? `你全部 ${n} 筆掃描紀錄，以及` : ""}你的帳號（包含來自 Google 的電子郵件地址和姓名），並將你登出。這個動作無法復原。`,
  deleteError: "無法刪除，請檢查網路連線後再試一次。",
  cancel: "取消",
  deleting: "刪除中…",
};

export const en: AccountCopy = {
  metaTitle: "Account",
  home: "Home",
  account: "Account",

  keepYourScans: "Keep your scans",
  subtitle:
    "Signing in is optional. Without an account, a scan expires automatically after a while.",
  benefitKeep: "Your scans stay until you delete them",
  benefitDevices: "Open your results on any device",
  benefitDelete: "Delete everything in one tap, any time",
  scanWithoutAccount: "Scan without an account",
  finePrint:
    "We keep your email address and your scans — never your photo. Your current scan joins your account when you sign in.",
  unavailable:
    "Sign-in is unavailable right now. You can still scan — your result is kept for a while, then expires automatically.",
  scanMyHand: "Scan my hand",
  whenOpens: "When sign-in opens, your scans can be saved to your account.",

  signedIn: "Signed in",
  yourScans: "Your scans",
  keptUntil: "Kept until you delete it.",

  continueWithGoogle: "Continue with Google",
  signOut: "Sign out",
  signingIn: "Signing in…",
  signingOut: "Signing out…",

  preparingExport: "Preparing export…",
  exportJson: "Export as JSON",
  deleteEverything: "Delete everything",
  exportError: "Couldn't export — check your connection and try again.",
  noScans: "No scans yet.",
  startMeasuring: "Start measuring",
  scansLabel: "Your scans",
  leftHand: "Left hand",
  rightHand: "Right hand",
  handLength: "Hand length",
  palmLength: "Palm length",
  palmWidth: "Palm width",

  deleteTitle: "Delete everything?",
  deleteBody: (n) =>
    `This permanently deletes ${n > 0 ? `all ${n} of your scans and ` : ""}your account, including the email address and name from Google, and signs you out. This can't be undone.`,
  deleteError: "Couldn't delete — check your connection and try again.",
  cancel: "Cancel",
  deleting: "Deleting…",
};

export function accountCopy(locale: Locale): AccountCopy {
  return pickCopy(locale, { zhTW, en });
}
