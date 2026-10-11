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
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

const NBSP = " ";

export interface ManualEntryCopy {
  /** The entry handle on the scan screen. */
  handleLabel: string;
  /** Its accessible name: what it does, and that a drag up works too. */
  handleAriaLabel: string;
  title: string;
  intro: string;
  handLegend: string;
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
  /** Shown while both numbers are fine but no hand is chosen yet. */
  handMissing: string;
  cancel: string;
  use: string;
  /** The close button of the open sheet (a screen reader reads it). */
  closeSheet: string;
  errors: {
    lengthEmpty: string;
    widthEmpty: string;
    notNumber: string;
    tooManyDecimals: string;
    /** "手長請輸入 13.5 到 26.5 公分。" */
    lengthRange: (minCm: string, maxCm: string) => string;
    widthRange: (minCm: string, maxCm: string) => string;
    /** In range, but narrower than a hand of this length is. */
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
}

export const zhTW: ManualEntryCopy = {
  handleLabel: "改用輸入數字",
  handleAriaLabel: "改用輸入數字：輸入手長與手寬，取代掃描",
  title: "輸入手的尺寸",
  intro: "輸入後會取代掃描結果。",
  handLegend: "你用哪隻手握滑鼠？",
  left: "左手",
  right: "右手",
  lengthLabel: "手長",
  lengthHelp: "手腕橫紋到中指指尖",
  lengthPlaceholder: "例：18.5",
  widthLabel: "手寬",
  widthHelp: "四指根部關節處，手掌最寬的地方",
  widthPlaceholder: "例：8.2",
  unit: "公分",
  estimateNote: "掌長會用平均比例估算，下一步請選擇你的握法。",
  handMissing: "請先選擇你用哪隻手握滑鼠。",
  cancel: "取消",
  use: "使用這組數字",
  closeSheet: "關閉輸入數字",
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
      `手長 ${length}${NBSP}公分的手，手寬通常在 ${min}${NBSP}到${NBSP}${max}${NBSP}公分之間；這個數字偏小，請再量一次。`,
    widthWideForLength: (length, min, max) =>
      `手長 ${length}${NBSP}公分的手，手寬通常在 ${min}${NBSP}到${NBSP}${max}${NBSP}公分之間；這個數字偏大，請再量一次。`,
  },
  resultsNotice: (length, width) =>
    `依你輸入的手長 ${length}${NBSP}公分、手寬 ${width}${NBSP}公分估算；掌長為估計值`,
};

export const en: ManualEntryCopy = {
  handleLabel: "Type your measurements",
  handleAriaLabel:
    "Type your measurements instead: enter hand length and width, replacing the scan",
  title: "Enter your hand size",
  intro: "What you enter replaces the scan result.",
  handLegend: "Which hand do you use on the mouse?",
  left: "Left hand",
  right: "Right hand",
  lengthLabel: "Hand length",
  lengthHelp: "Wrist crease to the tip of your middle finger",
  lengthPlaceholder: "e.g. 18.5",
  widthLabel: "Hand width",
  widthHelp:
    "Across the knuckles at the base of the four fingers, the widest part of the palm",
  widthPlaceholder: "e.g. 8.2",
  unit: "cm",
  estimateNote:
    "Palm length is estimated from an average proportion. You pick your grip next.",
  handMissing: "Choose the hand you use on the mouse first.",
  cancel: "Cancel",
  use: "Use these numbers",
  closeSheet: "Close typing your measurements",
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
      `A hand ${length}${NBSP}cm long is usually ${min}${NBSP}to${NBSP}${max}${NBSP}cm wide; this number is too small. Measure again.`,
    widthWideForLength: (length, min, max) =>
      `A hand ${length}${NBSP}cm long is usually ${min}${NBSP}to${NBSP}${max}${NBSP}cm wide; this number is too large. Measure again.`,
  },
  resultsNotice: (length, width) =>
    `Estimated from the hand length of ${length}${NBSP}cm and hand width of ${width}${NBSP}cm you entered; palm length is an estimate.`,
};

export function manualEntryCopy(locale: Locale): ManualEntryCopy {
  return pickCopy(locale, { zhTW, en });
}
