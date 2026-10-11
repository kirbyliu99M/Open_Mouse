/**
 * Words of the printed-sheet scan page (`/scan`, `ScanClient.tsx`) and its
 * camera screen (`CameraCapture.tsx`, shared with the paper-edge preview),
 * zh-TW and English, same keys. English is moved verbatim from the code; e2e
 * specs and unit tests pin it. What the camera says live is in
 * `camera-cues.ts`, what both scan screens share is in `scan-common.ts`.
 *
 * Every zh-TW string is a CANDIDATE (未拍板), Claude's Taiwan wording, until
 * Kirby has read it. 校正表 is the printed calibration sheet; 紙張 is the
 * blank paper the paper-edge mode uses. Numbers are formatted in TypeScript
 * and handed in (hard rule 2).
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

const NBSP = "\u00A0";

export type MeasurementKey =
  | "handLengthMm"
  | "palmLengthMm"
  | "palmWidthMm"
  | "thumbLengthMm"
  | "indexLengthMm"
  | "middleLengthMm"
  | "ringLengthMm"
  | "pinkyLengthMm"
  | "palmThicknessMm"
  | "knuckleHeightMm"
  | "gripApertureMm"
  | "thumbAngleDeg";

export interface ScanSheetCopy {
  metaTitle: string;
  metaDescription: string;
  measurementLabels: Record<MeasurementKey, string>;
  statusReading: string;
  statusProcessing: string;
  statusNeedsCard: string;
  statusMeasured: string;
  /** Top bar: where back goes, and which step this is. */
  backHome: string;
  stepPhoto: string;
  backSheet: string;
  stepPhotoOfTwo: string;
  headingPaper: string;
  hintPaper: string;
  headingSheet: string;
  hintSheet: string;
  whichHand: string;
  gripLegend: string;
  gripGroupLabel: string;
  openCamera: string;
  replacePhoto: string;
  choosePhoto: string;
  overlayLabel: string;
  cardCornerLabel: (n: number) => string;
  useTheseCorners: string;
  measuredLabelPaper: string;
  measuredLabelSheet: string;
  /** Labels on the measurement lines drawn on the photo (one decimal). */
  dimHandLength: (mm: string) => string;
  dimPalmWidth: (mm: string) => string;
  captionPaper: string;
  captionAuto: string;
  captionManual: string;
  useDifferentPhoto: string;
  printSheetLink: string;
  /** The camera screen. */
  camera: {
    primerPaper1: (size: string) => string;
    primerPaper2: string;
    primerPaper3: string;
    paperSize: string;
    primerSheet1: string;
    primerSheet2: string;
    primerSheet3: string;
    turnOnCamera: string;
    startingCamera: string;
    backToCamera: string;
    reviewStepPaper: string;
    reviewStepSheet: string;
    checkHeading: string;
    checkSubtitle: (noun: string) => string;
    nounPaper: string;
    nounSheet: string;
    overlayLabel: (noun: string) => string;
    allCornersFound: (noun: string) => string;
    usePhoto: string;
    closeCamera: string;
    liveStepPaper: string;
    liveStepSheet: string;
  };
}

export const zhTW: ScanSheetCopy = {
  metaTitle: "用列印的校正表掃描",
  metaDescription: "把手放在校正表上拍照來測量，所有處理都在你的裝置上完成。",
  measurementLabels: {
    handLengthMm: "手長",
    palmLengthMm: "掌長",
    palmWidthMm: "掌寬",
    thumbLengthMm: "拇指長度",
    indexLengthMm: "食指長度",
    middleLengthMm: "中指長度",
    ringLengthMm: "無名指長度",
    pinkyLengthMm: "小指長度",
    palmThicknessMm: "掌厚",
    knuckleHeightMm: "指節高度",
    gripApertureMm: "握持開口大小",
    thumbAngleDeg: "拇指角度",
  },
  statusReading: "正在讀取照片…",
  statusProcessing: "正在尋找校正表的定位方塊和你的手…",
  statusNeedsCard: "無法自動找到卡片，請拖曳四個角，對準你的卡片。",
  statusMeasured: "測量完成。",
  backHome: "首頁",
  stepPhoto: "拍照",
  backSheet: "校正表",
  stepPhotoOfTwo: "第 2 步，共 2 步 · 拍照",
  headingPaper: "把手放在紙上拍照",
  hintPaper: "請把手平放在空白的 A4 紙上、手指併攏，從正上方拍照。",
  headingSheet: "把手放在校正表上拍照",
  hintSheet:
    "請把手平放在校正表上、旁邊放一張銀行卡，手指併攏，從正上方把兩者一起拍下來。",
  whichHand: "哪一隻手？",
  gripLegend: "握法（選填）",
  gripGroupLabel: "握法，選填",
  openCamera: "開啟相機",
  replacePhoto: "更換照片",
  choosePhoto: "選擇照片",
  overlayLabel: "已在你的照片上標出偵測到的定位方塊、卡片和手部關鍵點",
  cardCornerLabel: (n) => `卡片第 ${n} 個角。可用方向鍵調整。`,
  useTheseCorners: "使用這些角點",
  measuredLabelPaper: "你測量過的手：標出紙張四角和手部骨架，以及手長和掌寬",
  measuredLabelSheet:
    "你測量過的手：標出校正表定位方塊、卡片和手部骨架，以及手長和掌寬",
  dimHandLength: (mm) => `手長 ${mm}${NBSP}mm`,
  dimPalmWidth: (mm) => `掌寬 ${mm}${NBSP}mm`,
  captionPaper: "已找到紙張的四個角，所以比例已經過檢查。",
  captionAuto: "已找到校正表的四個定位方塊和卡片，所以比例已經過檢查。",
  captionManual: "已找到校正表的四個定位方塊；比例是依你標出的卡片角點設定的。",
  useDifferentPhoto: "改用另一張照片",
  printSheetLink: "沒有校正表？列印一份",
  camera: {
    primerPaper1: (size) =>
      `在均勻、無反光的光線下，把空白 ${size} 紙放在較深色的素面桌上。`,
    primerPaper2: "手平放在紙上、手指併攏，手腕對齊下緣。",
    primerPaper3: "手機保持水平，在約 40 公分高的正上方，讓整張紙入鏡。",
    paperSize: "紙張大小",
    primerSheet1: "校正表平放在桌上，以 100% 列印，光線均勻、無反光。",
    primerSheet2: "銀行卡放在卡片框內；手平放、手指併攏，手腕對齊那條線。",
    primerSheet3: "手機保持水平，在約 40 公分高的正上方，讓整張校正表入鏡。",
    turnOnCamera: "開啟相機",
    startingCamera: "正在啟動相機…",
    backToCamera: "相機",
    reviewStepPaper: "檢查",
    reviewStepSheet: "第 2 步，共 2 步 · 檢查",
    checkHeading: "檢查你的照片",
    checkSubtitle: (noun) => `請確認整隻手和${noun}的四個角都看得到。`,
    nounPaper: "紙張",
    nounSheet: "校正表",
    overlayLabel: (noun) => `已在你的照片上標出偵測到的${noun}四個角`,
    allCornersFound: (noun) => `已找到${noun}的四個角`,
    usePhoto: "使用這張照片",
    closeCamera: "關閉相機，回到掃描頁",
    liveStepPaper: "拍照",
    liveStepSheet: "第 2 步，共 2 步 · 拍照",
  },
};

export const en: ScanSheetCopy = {
  metaTitle: "Scan on a printed sheet",
  metaDescription:
    "Photograph your hand on the calibration sheet to measure it — entirely on this device.",
  measurementLabels: {
    handLengthMm: "Hand length",
    palmLengthMm: "Palm length",
    palmWidthMm: "Palm width",
    thumbLengthMm: "Thumb length",
    indexLengthMm: "Index finger length",
    middleLengthMm: "Middle finger length",
    ringLengthMm: "Ring finger length",
    pinkyLengthMm: "Pinky length",
    palmThicknessMm: "Palm thickness",
    knuckleHeightMm: "Knuckle height",
    gripApertureMm: "Grip aperture",
    thumbAngleDeg: "Thumb angle",
  },
  statusReading: "Reading photo…",
  statusProcessing: "Looking for the sheet markers and your hand…",
  statusNeedsCard:
    "We couldn't find the card automatically — drag its four corners to match your card.",
  statusMeasured: "Measured.",
  backHome: "Home",
  stepPhoto: "Photo",
  backSheet: "Sheet",
  stepPhotoOfTwo: "Step 2 of 2 · Photo",
  headingPaper: "Photograph your hand on a sheet of paper",
  hintPaper:
    "Lay your hand flat on a blank A4 sheet, fingers together, and photograph it from directly above.",
  headingSheet: "Photograph your hand on the sheet",
  hintSheet:
    "Lay your hand flat on the sheet next to a bank card, fingers together, and photograph both from directly above.",
  whichHand: "Which hand?",
  gripLegend: "Grip style (optional)",
  gripGroupLabel: "Grip style, optional",
  openCamera: "Open camera",
  replacePhoto: "Replace photo",
  choosePhoto: "Choose photo",
  overlayLabel:
    "Detected markers, card and hand landmarks overlaid on your photo",
  cardCornerLabel: (n) => `Card corner ${n}. Use arrow keys to adjust.`,
  useTheseCorners: "Use these corners",
  measuredLabelPaper:
    "Your measured hand: the paper corners and hand skeleton, with hand length and palm width labelled",
  measuredLabelSheet:
    "Your measured hand: the sheet markers, card and hand skeleton, with hand length and palm width labelled",
  dimHandLength: (mm) => `Hand length ${mm} mm`,
  dimPalmWidth: (mm) => `Palm width ${mm} mm`,
  captionPaper: "All four paper corners were found, so the scale is checked.",
  captionAuto:
    "All four sheet markers and the card were found, so the scale is checked.",
  captionManual:
    "All four sheet markers were found; the card corners you placed set the scale.",
  useDifferentPhoto: "Use a different photo",
  printSheetLink: "Don't have the sheet? Print it",
  camera: {
    primerPaper1: (size) =>
      `Blank ${size} paper on a darker, plain table, in even light with no glare.`,
    primerPaper2:
      "Hand flat on the paper, fingers together, wrist at the bottom edge.",
    primerPaper3:
      "Hold the phone flat above, about 40 cm up — the whole paper in view.",
    paperSize: "Paper size",
    primerSheet1:
      "Sheet flat on a table, printed at 100%, good even light, no glare.",
    primerSheet2:
      "Bank card in the card outline; hand flat, fingers together, wrist at the line.",
    primerSheet3:
      "Hold the phone flat above, about 40 cm up — the whole sheet in view.",
    turnOnCamera: "Turn on camera",
    startingCamera: "Starting the camera…",
    backToCamera: "Camera",
    reviewStepPaper: "Review",
    reviewStepSheet: "Step 2 of 2 · Review",
    checkHeading: "Check your photo",
    checkSubtitle: (noun) =>
      `Make sure your whole hand and all four ${noun} corners are visible.`,
    nounPaper: "paper",
    nounSheet: "sheet",
    overlayLabel: (noun) => `Detected ${noun} corners overlaid on your photo`,
    allCornersFound: (noun) => `All four ${noun} corners found`,
    usePhoto: "Use this photo",
    closeCamera: "Close camera, back to Scan",
    liveStepPaper: "Photo",
    liveStepSheet: "Step 2 of 2 · Photo",
  },
};

export function scanSheetCopy(locale: Locale): ScanSheetCopy {
  return pickCopy(locale, { zhTW, en });
}
