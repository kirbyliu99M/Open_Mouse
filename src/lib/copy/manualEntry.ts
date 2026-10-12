/**
 * Words for typing the hand length and width instead of scanning (the pull-up
 * sheet on the scan screen, the desktop panel, and the one-line disclosure on
 * the results page), zh-TW and English, same keys.
 *
 * Every string here is a CANDIDATE (未拍板) until Kirby has read it. The
 * Chinese is Claude's Taiwan wording; the title, labels, helper lines and the
 * disclosure sentence follow the Pencil board `c700E5` and Kirby's suggested
 * disclosure (2026-10-11). Numbers are formatted in TypeScript
 * (`formatCentimetres`) and handed in as text; a number and its unit are
 * joined by a no-break space so a wide font cannot wrap "18.5 公分".
 *
 * One verb: the handle, the title and the intro speak of ENTERING numbers (zh
 * 輸入, en "Enter"); the confirming button is just 「確認」 / "Confirm"
 * (Kirby, 2026-10-12), which accepts what was entered rather than starting
 * the entry.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

const NBSP = " ";

export interface ManualEntryCopy {
  /**
   * The entry handle on the scan screen. This visible text is also its
   * accessible name (no separate aria-label, so the two cannot disagree).
   */
  handleLabel: string;
  title: string;
  intro: string;
  handLegend: string;
  /** Visible next to the legend, and the group is `aria-required`. */
  required: string;
  /** Under the legend: the numbers are for this hand. */
  handHelp: string;
  left: string;
  right: string;
  lengthLabel: string;
  lengthHelp: string;
  lengthPlaceholder: string;
  widthLabel: string;
  widthHelp: string;
  widthPlaceholder: string;
  /** The unit shown inside each field. */
  unit: string;
  /** The line above the buttons: palm length is estimated, the grip comes next. */
  estimateNote: string;
  /** Next to the hand toggle: shown once the numbers are fine or a send was tried. */
  handMissing: string;
  cancel: string;
  use: string;
  /** The close button of the open sheet (the dialog's own name gives the context). */
  closeSheet: string;
  errors: {
    lengthEmpty: string;
    widthEmpty: string;
    notNumber: string;
    tooManyDecimals: string;
    /** "手長請輸入 13.5 到 26.5 公分。" */
    lengthRange: (minCm: string, maxCm: string) => string;
    widthRange: (minCm: string, maxCm: string) => string;
    /** In range, but narrower than a hand of this length is; ends with a way out. */
    widthNarrowForLength: (
      lengthCm: string,
      minCm: string,
      maxCm: string,
    ) => string;
    widthWideForLength: (
      lengthCm: string,
      minCm: string,
      maxCm: string,
    ) => string;
  };
  /** The results-page line, under the hero. */
  resultsNotice: (lengthCm: string, widthCm: string) => string;
  /** The desktop scan page's heading over the QR card and the form (Pencil `B8sJF`). */
  desktopHeading: string;
  /**
   * After a typed pair failed to send, in the error banner where a scanned
   * scan offers "Retake photo": there is no photo, so the button goes back to
   * the form with what was typed.
   */
  editNumbers: string;
  /**
   * The two failures whose scan sentence says "retake a photo" (scan-common
   * `submitErrors.invalid` / `.tooLarge`), reworded for a typed pair.
   */
  sendInvalid: string;
  sendTooLarge: string;
}

export const zhTW: ManualEntryCopy = {
  handleLabel: "改用輸入數字",
  title: "輸入手的尺寸",
  intro: "不用掃描，直接輸入手長與手寬。",
  handLegend: "你用哪隻手握滑鼠？",
  required: "必填",
  handHelp: "請量你握滑鼠的那隻手。",
  left: "左手",
  right: "右手",
  lengthLabel: "手長（公分）",
  lengthHelp: "用尺量：手腕橫紋到中指指尖",
  lengthPlaceholder: "例：18.5",
  widthLabel: "手寬（公分）",
  widthHelp: "用尺量：四指根部關節處，手掌最寬的地方",
  widthPlaceholder: "例：8.2",
  unit: "公分",
  estimateNote: "掌長會用平均比例估算，下一步請選擇你的握法。",
  handMissing: "請先選擇你用哪隻手握滑鼠。",
  cancel: "取消",
  use: "確認",
  closeSheet: "關閉",
  errors: {
    lengthEmpty: "請輸入手長，例如 18.5。",
    widthEmpty: "請輸入手寬，例如 8.2。",
    notNumber: "請只輸入數字，例如 18.5。",
    tooManyDecimals: "最多輸入一位小數，例如 18.5。",
    lengthRange: (min, max) =>
      `手長請輸入 ${min}${NBSP}到${NBSP}${max}${NBSP}公分。`,
    widthRange: (min, max) =>
      `手寬請輸入 ${min}${NBSP}到${NBSP}${max}${NBSP}公分。`,
    widthNarrowForLength: (length, min, max) =>
      `手長 ${length}${NBSP}公分時，手寬需在 ${min}${NBSP}到${NBSP}${max}${NBSP}公分之間；這個數字偏小。請再量一次，或改用掃描。`,
    widthWideForLength: (length, min, max) =>
      `手長 ${length}${NBSP}公分時，手寬需在 ${min}${NBSP}到${NBSP}${max}${NBSP}公分之間；這個數字偏大。請再量一次，或改用掃描。`,
  },
  resultsNotice: (length, width) =>
    `依你輸入的手長 ${length}${NBSP}公分、手寬 ${width}${NBSP}公分估算；掌長為估計值。`,
  desktopHeading: "掃描你的手，或直接輸入尺寸",
  editNumbers: "修改數字",
  sendInvalid: "這組數字無法儲存，請修改數字後再試。",
  sendTooLarge: "這組數字沒有正確送出，請重新載入頁面後再試。",
};

export const en: ManualEntryCopy = {
  handleLabel: "Enter your measurements",
  title: "Enter your hand size",
  intro: "No scan needed: enter your hand length and width.",
  handLegend: "Which hand do you use on the mouse?",
  required: "Required",
  handHelp: "Measure the hand you hold the mouse with.",
  left: "Left hand",
  right: "Right hand",
  lengthLabel: "Hand length (cm)",
  lengthHelp: "With a ruler: wrist crease to the tip of your middle finger",
  lengthPlaceholder: "e.g. 18.5",
  widthLabel: "Hand width (cm)",
  widthHelp:
    "With a ruler: across the knuckles at the base of the four fingers, the widest part of the palm",
  widthPlaceholder: "e.g. 8.2",
  unit: "cm",
  estimateNote:
    "Palm length is estimated from an average proportion. You pick your grip next.",
  handMissing: "Choose the hand you use on the mouse first.",
  cancel: "Cancel",
  use: "Confirm",
  closeSheet: "Close",
  errors: {
    lengthEmpty: "Enter your hand length, for example 18.5.",
    widthEmpty: "Enter your hand width, for example 8.2.",
    notNumber: "Enter numbers only, for example 18.5.",
    tooManyDecimals: "Use at most one decimal, for example 18.5.",
    lengthRange: (min, max) =>
      `Hand length must be between ${min}${NBSP}and${NBSP}${max}${NBSP}cm.`,
    widthRange: (min, max) =>
      `Hand width must be between ${min}${NBSP}and${NBSP}${max}${NBSP}cm.`,
    widthNarrowForLength: (length, min, max) =>
      `Hand width must be between ${min}${NBSP}and${NBSP}${max}${NBSP}cm for a hand length of ${length}${NBSP}cm; this number is too small. Measure again, or scan your hand instead.`,
    widthWideForLength: (length, min, max) =>
      `Hand width must be between ${min}${NBSP}and${NBSP}${max}${NBSP}cm for a hand length of ${length}${NBSP}cm; this number is too large. Measure again, or scan your hand instead.`,
  },
  resultsNotice: (length, width) =>
    `Estimated from the hand length of ${length}${NBSP}cm and hand width of ${width}${NBSP}cm you entered; palm length is an estimate.`,
  desktopHeading: "Scan your hand, or enter your size",
  editNumbers: "Change the numbers",
  sendInvalid: "These numbers could not be saved. Change them and try again.",
  sendTooLarge:
    "These numbers did not send correctly. Reload the page and try again.",
};

export function manualEntryCopy(locale: Locale): ManualEntryCopy {
  return pickCopy(locale, { zhTW, en });
}
