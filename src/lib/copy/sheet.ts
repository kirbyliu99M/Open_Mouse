/**
 * Words of the printable calibration sheet page and of the printed sheet
 * itself. Every zh-TW string is a CANDIDATE (未拍板), Claude's Taiwan wording,
 * until Kirby has read it. Only words change between languages: the markers,
 * lines and every position on the printed page are the same (the scanner
 * measures them). Numbers (the ruler length, the card size) are passed in by
 * the page, never written here.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface SheetCopy {
  metaTitle: string;
  metaDescription: string;
  home: string;
  stepLabel: string;
  heading: string;
  calloutTitle: string;
  calloutBody: string;
  after: string;
  printTheSheet: string;
  continueLabel: string;
  privacy: string;

  // On the printed sheet (SVG text).
  svgStrip: string;
  svgFoldUp: string;
  svgLayFlat: string;
  svgRuler: (lengthMm: number) => string;
  svgCard: (widthMm: number, heightMm: number) => string;
  svgWarning: string;
}

export const zhTW: SheetCopy = {
  metaTitle: "校正紙張",
  metaDescription: "可列印的 ArUco 校正紙張，用來從照片測量你的手。",
  home: "首頁",
  stepLabel: "第 1 步，共 2 步 · 列印",
  heading: "列印紙張",
  calloutTitle: "請以實際大小列印：100%",
  calloutBody:
    "請在列印視窗中關閉「縮放至符合頁面」。縮放後的列印結果會讓測量不準確。",
  after: "A4 和 Letter 都適用。這裡顯示的是整張紙。",
  printTheSheet: "列印紙張",
  continueLabel: "我印好了，繼續",
  privacy: "你的照片在這台裝置上處理，只會傳送測量數值。",

  svgStrip: "側拍紙條（把這個折片向上折，靠在牆邊）",
  svgFoldUp: "▲ 向上折",
  svgLayFlat: "▼ 攤平",
  svgRuler: (n) => `請確認這條線正好是 ${n} mm`,
  svgCard: (w, h) => `請把任何一張銀行卡放在這裡（${w} × ${h} mm）`,
  svgWarning: "請以 100%／實際大小列印，不要「縮放至符合頁面」",
};

export const en: SheetCopy = {
  metaTitle: "Calibration sheet",
  metaDescription:
    "Printable ArUco calibration sheet for measuring your hand from a photo.",
  home: "Home",
  stepLabel: "Step 1 of 2 · Print",
  heading: "Print the sheet",
  calloutTitle: "Print at actual size — 100%",
  calloutBody:
    'Turn off "Fit to page" in the print dialog. A scaled print gives wrong measurements.',
  after: "Fits both A4 and Letter. The whole sheet is shown here.",
  printTheSheet: "Print the sheet",
  continueLabel: "I've printed it — continue",
  privacy:
    "Your photo is processed on this device. Only the measurements are sent.",

  svgStrip: "Side-shot strip (fold this flap up against a wall)",
  svgFoldUp: "▲ fold up",
  svgLayFlat: "▼ lay flat",
  svgRuler: (n) => `Check this is exactly ${n} mm`,
  svgCard: (w, h) => `Place any bank card here (${w} × ${h} mm)`,
  svgWarning: 'Print at 100% / Actual size — do not "fit to page"',
};

export function sheetCopy(locale: Locale): SheetCopy {
  return pickCopy(locale, { zhTW, en });
}
