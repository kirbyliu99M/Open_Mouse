/**
 * Words shared by both scan screens (the easy scan at `/scan/easy` and the
 * printed-sheet scan at `/scan`): the privacy promise, hand and grip names,
 * the measured numbers, the submit button, the detector's progress pill and
 * the camera-permission screens. zh-TW and English, same keys. English is
 * moved verbatim from the code; unit tests and e2e specs pin it.
 *
 * Every zh-TW string is a CANDIDATE (未拍板), Claude's Taiwan wording, until
 * Kirby has read it. Grip names are the ones `results-page.ts` uses
 * (趴握, 抓握, 指握). Numbers are formatted in TypeScript and handed in as
 * text: no copy table computes a number (hard rule 2).
 *
 * The photo-privacy sentences are the single source for `privacy.ts` too.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

const NBSP = " ";

export type SubmitErrorKind =
  "invalid" | "tooLarge" | "rateLimited" | "network" | "server";

export interface ScanCommonCopy {
  /** On a phone. */
  privacyPhone: string;
  /** On a screen a computer can reach, where "phone" would be wrong. */
  privacyDevice: string;
  /** The first-run tip's and the camera primer's fine print. */
  privacyAndCameraStays: string;
  handLeft: string;
  handRight: string;
  /** The hand chip's text; "auto" only while the hand is still inferred. */
  handChip: (hand: "left" | "right", locked: boolean) => string;
  /** The hand chip's accessible name. */
  handChipName: (hand: "left" | "right", locked: boolean) => string;
  gripPalm: string;
  gripClaw: string;
  gripFingertip: string;
  /** The two numbers as one line a screen reader reads. */
  measuredNumbers: (input: {
    handLength: string;
    palmWidth: string;
    entered: boolean;
  }) => string;
  unverifiedNote: string;
  /** "Enter a hand length between 135 and 265 mm." */
  lengthRange: (min: number, max: number) => string;
  submitSending: string;
  submitSuccessStatus: string;
  submitButtonSubmitting: string;
  submitButtonOpening: string;
  submitButton: string;
  submitErrors: Record<SubmitErrorKind, string>;
  detectorLoadFailed: string;
  detectorTryAgain: string;
  detectorLoading: string;
  detectorStarting: string;
  /** `aria-valuetext` of the progress bar. */
  detectorPercent: (n: number) => string;
  /** "3.3 of 7.8 MB"; `loaded` and `total` are already formatted. */
  detectorSizeOf: (loaded: string, total: string) => string;
  /** "3.3 MB" when the total is unknown. */
  detectorSize: (loaded: string) => string;
  cameraBlocked: string;
  cameraCantOpen: string;
  cameraTurnedOff: string;
  cameraTapToResume: string;
  cameraToUse: string;
  cameraStepSettings: string;
  cameraStepAllow: string;
  cameraStepReloadEasy: string;
  cameraStepReloadSheet: string;
  cameraOrUpload: string;
  uploadInstead: string;
  uploadPhoto: string;
  takePhoto: string;
  photoTaken: string;
  retakeNeeded: string;
  tryAgain: string;
  handMeasured: string;
  retakePhoto: string;
}

export const zhTW: ScanCommonCopy = {
  privacyPhone: "你的照片不會離開手機，只會傳送測量數值。",
  privacyDevice: "你的照片不會離開這台裝置，只會傳送測量數值。",
  privacyAndCameraStays:
    "你的照片不會離開手機，只會傳送測量數值。相機畫面只會留在你的手機上。",
  handLeft: "左手",
  handRight: "右手",
  handChip: (hand, locked) =>
    `${hand === "left" ? "左手" : "右手"}${locked ? "" : " · 自動"}`,
  // The visible text stays inside the name (label in name); the repeated
  // 自動 is dropped.
  handChipName: (hand, locked) =>
    `${hand === "left" ? "左手" : "右手"}${locked ? "，由你設定" : " · 自動"}。切換左右手`,
  gripPalm: "趴握",
  gripClaw: "抓握",
  gripFingertip: "指握",
  measuredNumbers: ({ handLength, palmWidth, entered }) =>
    `${entered ? `手長 ${handLength}${NBSP}mm（自行輸入）` : `手長 ${handLength}${NBSP}mm`} · 掌寬 ${palmWidth}${NBSP}mm`,
  unverifiedNote: "測量數值仍在驗證中。",
  lengthRange: (min, max) => `請輸入 ${min} 到 ${max}${NBSP}mm 之間的手長。`,
  submitSending: "正在傳送你的測量數值…",
  submitSuccessStatus: "測量完成，正在開啟你的結果…",
  submitButtonSubmitting: "傳送中…",
  submitButtonOpening: "正在開啟結果…",
  submitButton: "查看適合我的滑鼠",
  submitErrors: {
    invalid: "這次掃描無法儲存，請重新拍一張俯拍照片再試。",
    tooLarge: "這次掃描沒有正確送出，請重新載入頁面並重拍。",
    rateLimited: "短時間內嘗試太多次，請等幾分鐘後再試。",
    network: "沒有網路連線，請檢查網路後再試一次。",
    server: "我們這邊出了點問題，請稍等一下再試。",
  },
  detectorLoadFailed: "無法載入手部偵測模型，請檢查網路連線後再試一次。",
  detectorTryAgain: "再試一次",
  detectorLoading: "正在載入手部偵測模型",
  detectorStarting: "正在啟動手部偵測模型",
  detectorPercent: (n) => `${n}%`,
  detectorSizeOf: (loaded, total) => `${loaded} / ${total} MB`,
  detectorSize: (loaded) => `${loaded} MB`,
  cameraBlocked: "相機權限被拒絕了。",
  cameraCantOpen: "無法開啟相機。",
  cameraTurnedOff: "相機已關閉。",
  cameraTapToResume: "點一下以重新開啟相機",
  cameraToUse: "要使用相機：",
  cameraStepSettings: "開啟瀏覽器中這個網站的設定。",
  cameraStepAllow: "允許使用相機。",
  cameraStepReloadEasy: "重新載入頁面後再試一次。",
  cameraStepReloadSheet: "重新載入頁面，再點一次「開啟相機」。",
  cameraOrUpload: "或用下方的按鈕改為上傳照片。",
  uploadInstead: "改為上傳照片",
  uploadPhoto: "上傳照片",
  takePhoto: "拍照",
  photoTaken: "已拍照",
  retakeNeeded: "需要重拍",
  tryAgain: "再試一次",
  handMeasured: "手部測量完成",
  retakePhoto: "重拍",
};

export const en: ScanCommonCopy = {
  privacyPhone:
    "Your photo never leaves your phone. Only measurements are sent.",
  privacyDevice:
    "Your photo never leaves this device. Only measurements are sent.",
  privacyAndCameraStays:
    "Your photo never leaves your phone. Only measurements are sent. The camera view stays on your phone.",
  handLeft: "Left hand",
  handRight: "Right hand",
  handChip: (hand, locked) =>
    `${hand === "left" ? "Left" : "Right"} hand${locked ? "" : " · auto"}`,
  handChipName: (hand, locked) =>
    `${hand === "left" ? "Left" : "Right"} hand${locked ? "" : " · auto"}, ${
      locked ? "set by you" : "set automatically"
    }. Change hand`,
  gripPalm: "Palm",
  gripClaw: "Claw",
  gripFingertip: "Fingertip",
  measuredNumbers: ({ handLength, palmWidth, entered }) =>
    `${entered ? `Hand length ${handLength}${NBSP}mm (entered)` : `Hand length ${handLength}${NBSP}mm`} · Palm width ${palmWidth}${NBSP}mm`,
  unverifiedNote: "Measurements are still being validated.",
  lengthRange: (min, max) =>
    `Enter a hand length between ${min} and ${max}${NBSP}mm.`,
  submitSending: "Sending your measurements…",
  submitSuccessStatus: "Measured — opening your matches…",
  submitButtonSubmitting: "Submitting…",
  submitButtonOpening: "Opening your matches…",
  submitButton: "See my matches",
  submitErrors: {
    invalid:
      "This scan couldn't be saved — retake the top-down photo and try again.",
    tooLarge:
      "This scan didn't send correctly — reload the page and retake the photo.",
    rateLimited:
      "Too many tries in a short time — wait a few minutes and try again.",
    network: "No connection — check your network, then try submitting again.",
    server: "Something went wrong on our end — wait a moment and try again.",
  },
  detectorLoadFailed:
    "We couldn't load the hand detector. Check your connection and try again.",
  detectorTryAgain: "Try again",
  detectorLoading: "Loading the hand detector",
  detectorStarting: "Starting the hand detector",
  detectorPercent: (n) => `${n} percent`,
  detectorSizeOf: (loaded, total) => `${loaded} of ${total} MB`,
  detectorSize: (loaded) => `${loaded} MB`,
  cameraBlocked: "Camera access was blocked.",
  cameraCantOpen: "The camera couldn't be opened.",
  cameraTurnedOff: "The camera turned off.",
  cameraTapToResume: "Tap to resume camera",
  cameraToUse: "To use the camera:",
  cameraStepSettings: "Open your browser's site settings for this page.",
  cameraStepAllow: "Allow camera access.",
  cameraStepReloadEasy: "Reload and try again.",
  cameraStepReloadSheet: 'Reload and tap "Turn on camera" again.',
  cameraOrUpload: "Or upload a photo instead using the button below.",
  uploadInstead: "Upload a photo instead",
  uploadPhoto: "Upload a photo",
  takePhoto: "Take photo",
  photoTaken: "Photo taken",
  retakeNeeded: "Retake needed",
  tryAgain: "Try again",
  handMeasured: "Hand measured",
  retakePhoto: "Retake photo",
};

export function scanCommonCopy(locale: Locale): ScanCommonCopy {
  return pickCopy(locale, { zhTW, en });
}
