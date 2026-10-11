/**
 * Words of the easy-scan screen (`/scan/easy`, `EasyScanCamera.tsx`) and its
 * desktop / in-app entry screen (`DeviceEntry.tsx`), zh-TW and English, same
 * keys. English is moved verbatim from the code; e2e specs and unit tests pin
 * it. What the camera says live is in `camera-cues.ts`, what both scan
 * screens share is in `scan-common.ts`, the photo problems are in
 * `scan-issues.ts`.
 *
 * Every zh-TW string is a CANDIDATE (未拍板), Claude's Taiwan wording, until
 * Kirby has read it. The screen is a 320 px wide overlay on a live picture,
 * so the zh-TW lines are short. Numbers are formatted in TypeScript and
 * handed in; no copy here computes one (hard rule 2).
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

const NBSP = " ";

export interface EasyScanCopy {
  /** Page `<title>` and description. */
  metaTitle: string;
  metaDescription: string;
  /** The (visually hidden) `<h1>`. */
  heading: string;
  loadingScanner: string;
  /** Live-region announcements when the no-paper mode is switched. */
  noPaperAnnounce: (mm: string) => string;
  paperAnnounce: string;
  /** Labels on the measurement lines drawn on the photo. */
  dimEntered: (mm: string) => string;
  dimHand: (mm: string) => string;
  dimPalm: (mm: string) => string;
  /** The frozen photo's accessible name. */
  photoLabelNoPaper: string;
  photoLabelPaper: string;
  closeCamera: string;
  showTip: string;
  backToCamera: string;
  backToUpload: string;
  handDrawingLabel: string;
  lengthHeading: string;
  lengthSub: string;
  lengthFieldLabel: string;
  lengthPlaceholder: string;
  lengthHint: (min: number, max: number) => string;
  lengthContinue: string;
  /** The no-camera screen's line above the upload button. */
  uploadLineNoPaper: string;
  uploadLinePaper: string;
  usePaperInstead: string;
  /** The entry to typing the hand length, and its edit form. */
  noPaperEntry: string;
  editHandLength: string;
  /** The chip beside the shutter while a typed length is used. */
  lengthChip: (mm: string) => string;
  measuring: string;
  disclosureBased: (mm: string) => string;
  disclosureNoPaper: string;
  gripQuestion: string;
  gripGroupLabel: string;
  tipTitleNoPaper: string;
  tipTitlePaper: string;
  tipSurface: string;
  tipHandFlat: string;
  tipPhoneNoPaper: string;
  tipPaperOnTable: (size: string) => string;
  tipPhonePaper: string;
  tipGotIt: string;
  tipFinePrint: (privacy: string) => string;
  /** The desktop and in-app entry screen. */
  device: {
    desktopTitle: string;
    inAppTitle: string;
    inAppBody: string;
    desktopBody: string;
    qrLabel: string;
    openInBrowser: string;
    linkCopied: string;
    copyLink: string;
    selectLinkLabel: string;
    uploadPhoto: string;
    copyFailed: string;
  };
}

export const zhTW: EasyScanCopy = {
  metaTitle: "掃描你的手",
  metaDescription:
    "把手放在任何一張空白的 A4 紙上拍照，所有測量都在你的裝置上完成。",
  heading: "掃描你的手",
  loadingScanner: "正在載入掃描器…",
  noPaperAnnounce: (mm) => `無紙模式：使用你輸入的手長 ${mm} mm，不需要紙張。`,
  paperAnnounce: "紙張模式：請把手放在空白紙上。",
  dimEntered: (mm) => `輸入 ${mm} mm`,
  dimHand: (mm) => `手長 ${mm} mm`,
  dimPalm: (mm) => `掌寬 ${mm} mm`,
  photoLabelNoPaper: "你的照片，測量完成後會標出手長與掌寬的線",
  photoLabelPaper: "你的照片，會標出紙張四角，測量完成後再標出手長與掌寬的線",
  closeCamera: "關閉相機，回到首頁",
  showTip: "顯示首次使用提示",
  backToCamera: "回到相機",
  backToUpload: "回到上傳",
  handDrawingLabel: "線條圖：從手腕橫紋到中指指尖",
  lengthHeading: "手長",
  lengthSub: "從手腕橫紋到中指指尖",
  lengthFieldLabel: "手長（mm）",
  lengthPlaceholder: "例如 186 mm",
  lengthHint: (min, max) =>
    `18.6${NBSP}cm = 186${NBSP}mm。請以毫米輸入，範圍 ${min} 到 ${max}。`,
  lengthContinue: "繼續",
  uploadLineNoPaper:
    "請上傳一張俯拍的手部照片：手平放在素色平面上，整隻手都要入鏡。",
  uploadLinePaper: "請上傳一張俯拍的手部照片，手放在空白紙上。",
  usePaperInstead: "改用紙張",
  noPaperEntry: "沒有紙？改用尺量",
  editHandLength: "修改手長",
  lengthChip: (mm) => `已輸入 ${mm}${NBSP}mm`,
  measuring: "正在測量你的手…",
  disclosureBased: (mm) => `依你輸入的手長（${mm}${NBSP}mm）`,
  disclosureNoPaper: "未使用紙張測量。",
  gripQuestion: "你怎麼握滑鼠？（選填）",
  gripGroupLabel: "握法，選填",
  tipTitleNoPaper: "你的手長就是尺",
  tipTitlePaper: "只要一張空白紙",
  tipSurface: "素色、較深的平面",
  tipHandFlat: "手掌攤平、手指併攏",
  tipPhoneNoPaper: "手機平放在正上方，整隻手入鏡",
  tipPaperOnTable: (size) => `${size} 紙放在較深色的桌面上`,
  tipPhonePaper: "手機平放在正上方，整張紙入鏡",
  tipGotIt: "知道了",
  tipFinePrint: (privacy) => `只會顯示一次。${privacy}`,
  device: {
    desktopTitle: "用手機掃描",
    inAppTitle: "請用 Safari 或 Chrome 開啟，才能使用相機",
    inAppBody:
      "這個 App 內建的瀏覽器會封鎖相機。請複製連結，改用 Safari 或 Chrome 開啟。",
    desktopBody: "請用手機相機對準這個 QR code。",
    qrLabel: "這個掃描頁面的 QR code",
    openInBrowser: "用瀏覽器開啟",
    linkCopied: "已複製連結",
    copyLink: "複製連結",
    selectLinkLabel: "選取要複製的連結",
    uploadPhoto: "或上傳照片",
    copyFailed: "無法自動複製，請選取下方的連結再自行複製。",
  },
};

export const en: EasyScanCopy = {
  metaTitle: "Scan your hand",
  metaDescription:
    "Lay your hand on any blank sheet of A4 and photograph it — measured entirely on this device.",
  heading: "Scan your hand",
  loadingScanner: "Loading the scanner…",
  noPaperAnnounce: (mm) =>
    `No-paper mode: using your hand length of ${mm} mm. No sheet needed.`,
  paperAnnounce: "Paper mode: place your hand on a blank sheet of paper.",
  dimEntered: (mm) => `Entered ${mm} mm`,
  dimHand: (mm) => `Hand ${mm} mm`,
  dimPalm: (mm) => `Palm ${mm} mm`,
  photoLabelNoPaper:
    "Your photo with, once measured, the hand-length and palm-width lines",
  photoLabelPaper:
    "Your photo with the paper corners and, once measured, the hand-length and palm-width lines",
  closeCamera: "Close camera, back to Home",
  showTip: "Show the first-run tip",
  backToCamera: "Back to camera",
  backToUpload: "Back to upload",
  handDrawingLabel: "Line drawing showing wrist crease to middle fingertip",
  lengthHeading: "Hand length",
  lengthSub: "Wrist crease to the tip of your middle finger",
  lengthFieldLabel: "Hand length (mm)",
  lengthPlaceholder: "e.g. 186 mm",
  lengthHint: (min, max) =>
    `18.6${NBSP}cm = 186${NBSP}mm. Enter millimetres, from ${min} to ${max}.`,
  lengthContinue: "Continue",
  uploadLineNoPaper:
    "Upload a top-down photo of your hand, flat on a plain surface, with your whole hand in view.",
  uploadLinePaper:
    "Upload a top-down photo of your hand on a blank sheet of paper.",
  usePaperInstead: "Use paper instead",
  noPaperEntry: "No paper? Use a ruler instead",
  editHandLength: "Edit hand length",
  lengthChip: (mm) => `${mm}${NBSP}mm entered`,
  measuring: "Measuring your hand…",
  disclosureBased: (mm) =>
    `Based on the hand length you entered (${mm}${NBSP}mm)`,
  disclosureNoPaper: "Measured without paper.",
  gripQuestion: "How do you hold a mouse? (optional)",
  gripGroupLabel: "Grip style, optional",
  tipTitleNoPaper: "Your hand length is the ruler",
  tipTitlePaper: "One blank sheet is all you need",
  tipSurface: "A plain, darker surface",
  tipHandFlat: "Hand flat, fingers together",
  tipPhoneNoPaper: "Phone flat above — your whole hand in view",
  tipPaperOnTable: (size) => `${size} paper on a darker table`,
  tipPhonePaper: "Phone flat above — the whole sheet in view",
  tipGotIt: "Got it",
  tipFinePrint: (privacy) => `Shown once. ${privacy}`,
  device: {
    desktopTitle: "Scan with your phone",
    inAppTitle: "Open in Safari or Chrome to use the camera",
    inAppBody:
      "This app’s built-in browser blocks the camera. Copy the link and open it in Safari or Chrome.",
    desktopBody: "Point your phone camera at this code.",
    qrLabel: "QR code for this scan page",
    openInBrowser: "Open in browser",
    linkCopied: "Link copied",
    copyLink: "Copy link",
    selectLinkLabel: "Select link to copy",
    uploadPhoto: "Or upload a photo",
    copyFailed:
      "Couldn't copy automatically. Select the link below and copy it.",
  },
};

export function easyScanCopy(locale: Locale): EasyScanCopy {
  return pickCopy(locale, { zhTW, en });
}
