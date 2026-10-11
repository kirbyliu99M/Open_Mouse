/**
 * The "retake" instructions a photo can fail with (`src/client/photo/gates.ts`,
 * `user-length.ts`, `pipeline.ts`), zh-TW and English, same keys. The code
 * that produces an issue keeps its English `message` (attempt logs and unit
 * tests read it); `issueText` (`src/client/photo/issueText.ts`) picks the
 * words shown on screen from the issue's `code`.
 *
 * English here is the same text the code builds, and
 * `tests/unit/i18n-scan.test.ts` compares the two. Every zh-TW string is a
 * CANDIDATE (未拍板), Claude's Taiwan wording, until Kirby has read it. Each
 * is one instruction, as the design guidelines ask for errors. 校正表 is the
 * printed calibration sheet, 紙張 the blank paper of the easy scan.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

const NBSP = " ";

/** How a handedness mismatch tells the person to fix it. */
export type HandFix = "button" | "picker";

export interface ScanIssuesCopy {
  markersMissing: string;
  handNotDetected: string;
  /** `detected` and `stated` are "left" or "right". */
  handednessMismatch: (
    detected: "left" | "right",
    stated: "left" | "right",
    fix: HandFix,
  ) => string;
  lowLandmarkConfidence: string;
  handOutOfBounds: string;
  reprojectionError: string;
  cardScaleMismatch: string;
  paperNotFound: string;
  paperCornerHidden: string;
  paperEdgeHidden: string;
  paperCurled: string;
  lowSharpness: string;
  measurementImplausible: string;
  /** The palm does not fit the typed length (`mm` as shown). */
  measurementOutOfRangeTyped: (mm: string) => string;
  fingerNotStraight: string;
  handTilted: string;
  decodeFailed: string;
  processingFailed: string;
  unexpected: string;
}

const handName = {
  "zh-TW": { left: "左手", right: "右手" },
  en: { left: "left", right: "right" },
} as const;

export const zhTW: ScanIssuesCopy = {
  markersMissing: "有定位方塊被擋住了，請讓校正表四個角落的方塊都露出來。",
  handNotDetected: "照片裡找不到手，請把手平放、手指併攏後重拍。",
  handednessMismatch: (detected, stated, fix) =>
    `這看起來是你的${handName["zh-TW"][detected]}，但你選的是${handName["zh-TW"][stated]}。請用${handName["zh-TW"][stated]}重拍，或${
      fix === "button" ? "點下方的左右手按鈕" : "改選左右手"
    }。`,
  lowLandmarkConfidence:
    "手部辨識得不夠清楚，請在明亮、均勻的光線下，讓整隻手平放後重拍。",
  handOutOfBounds: "手有一部分超出校正表，請讓整隻手和校正表都完整入鏡。",
  reprojectionError:
    "校正表看起來歪了，或相機角度偏斜。請把校正表攤平，用手機主鏡頭（1×）從正上方拍攝。",
  cardScaleMismatch:
    "列印時頁面被縮放了，請以 100%（實際大小）重新列印校正表，並關閉「縮放至頁面大小」。",
  paperNotFound:
    "照片裡找不到紙張。請把空白 A4（或 Letter）紙平放在單色、對比明顯的桌面上，然後重拍。",
  paperCornerHidden:
    "紙張有角落或邊緣被擋住了。請退後一點，讓整張紙從角到角都入鏡，手不要碰到紙邊，然後重拍。",
  paperEdgeHidden:
    "紙張有一條邊被蓋住太多。請移動你的手，讓更多紙邊露出來，然後重拍。",
  paperCurled:
    "紙張看起來不平整。請把它壓平在硬質桌面上（不要有捲曲、摺痕或翹起的角），然後重拍。",
  lowSharpness:
    "這張照片有點模糊，可能會影響準確度。你可以繼續，或重拍一張更清晰的。",
  measurementImplausible:
    "這些測量結果看起來不合理。請讓整隻手平放、相機在正上方，然後重拍。",
  measurementOutOfRangeTyped: (mm) =>
    `你的手掌和你輸入的 ${mm}${NBSP}mm 對不上。請確認這個數字：從手腕橫紋量到中指指尖。`,
  fingerNotStraight: "請把手指伸直、手平放，然後重拍。",
  handTilted: "照片看起來是歪的。請把手機放平、在手的正上方，然後重拍。",
  decodeFailed: "無法開啟這張照片。請把它匯出成 JPEG 後再試一次。",
  processingFailed: "處理這張照片時出了點問題，請再試一次。",
  unexpected: "出了點問題，請再試一次。",
};

export const en: ScanIssuesCopy = {
  markersMissing: "Markers are hidden — keep all four corner squares visible.",
  handNotDetected:
    "We couldn't find a hand in this photo — lay your hand flat on the sheet, fingers together, and retake.",
  handednessMismatch: (detected, stated, fix) =>
    `This looks like your ${handName.en[detected]} hand, but you selected ${handName.en[stated]}. Retake with your ${handName.en[stated]} hand, or ${
      fix === "button" ? "tap the hand button below" : "change the hand picker"
    }.`,
  lowLandmarkConfidence:
    "The hand wasn't detected clearly enough — retake in brighter, even light with your whole hand flat on the sheet.",
  handOutOfBounds:
    "Part of your hand is outside the sheet — make sure your whole hand and the sheet are both fully in frame.",
  reprojectionError:
    "The sheet looks warped or the camera is at an angle — flatten the sheet, shoot from directly above with your phone's main (1×) camera.",
  cardScaleMismatch:
    'Your printer scaled the page — reprint the sheet at 100% / actual size (turn off "fit to page").',
  paperNotFound:
    "We couldn't find a sheet of paper in this photo — place a blank A4 (or Letter) sheet flat on a plain, contrasting surface and retake.",
  paperCornerHidden:
    "A corner or edge of the paper is hidden — move back, reposition so the whole sheet is visible corner to corner, and keep your hand clear of the edges.",
  paperEdgeHidden:
    "Too much of one edge of the paper is covered — move your hand so more of the sheet's edges are visible, then retake.",
  paperCurled:
    "The paper doesn't look flat — smooth it out on a hard surface (no curls, folds or lifted corners) and retake.",
  lowSharpness:
    "This photo looks a little blurry, which may reduce accuracy. You can continue, or retake for a sharper shot.",
  measurementImplausible:
    "These measurements look implausible — retake with your whole hand flat on the sheet and the camera directly overhead.",
  measurementOutOfRangeTyped: (mm) =>
    `Your palm doesn't fit the ${mm}${NBSP}mm you entered. Check that number: wrist crease to the tip of your middle finger.`,
  fingerNotStraight:
    "Straighten your fingers and lay your hand flat, then retake.",
  handTilted:
    "The photo looks tilted — hold the phone flat, straight above your hand, and retake.",
  decodeFailed:
    "This photo couldn't be opened — export it as a JPEG and try again.",
  processingFailed:
    "Something went wrong while measuring that photo. Try again.",
  unexpected: "Something went wrong. Try again.",
};

export function scanIssuesCopy(locale: Locale): ScanIssuesCopy {
  return pickCopy(locale, { zhTW, en });
}
