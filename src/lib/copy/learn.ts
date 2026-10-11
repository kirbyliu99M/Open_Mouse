/**
 * Words of the learning kit (/learn, /learn/print, /learn/slates,
 * /learn/check, the pose page behind a printed QR code, and the printed
 * pages themselves). Every zh-TW string is a CANDIDATE (未拍板), Claude's
 * Taiwan wording (滑鼠, 掃描, 趴握/抓握/指握 as in `results-page.ts`), until
 * Kirby has read it. The kit is a research tool: file paths, commands, kit
 * codes (G01, P001, agreed-v2) and the checker's per-photo diagnostics
 * (`src/lib/learning/checks.ts`, `sortv2.ts`) stay in English.
 *
 * English strings are the old strings, moved verbatim. Strings with a number
 * are functions; the numbers come from the page.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";
import { GESTURES, type GestureCode } from "../learning/kit";

export interface GestureCopy {
  name: string;
  steps: readonly string[];
  yields: string;
}

export interface LearnCopy {
  /** Joins the sentences of one paragraph: with spaces in English, none in Chinese. */
  join: (sentences: readonly string[]) => string;
  /** The full stop. */
  stop: string;
  // Shared chrome.
  learningKit: string;
  home: string;
  print: string;
  /** "Print 1 page" / "Print 3 pages". */
  printPages: (n: number) => string;
  participantCards: string;

  // /learn
  metaDescription: string;
  lead: string;
  v2Heading: string;
  v2Before: string;
  v2After: string;
  printSheetA: string;
  sheetBNotUsed: string;
  cardsS0: string;
  cardsMain: string;
  checkSheetA: string;
  afterSession: string;
  afterSessionB: string;
  afterSessionC: string;
  v1Heading: string;
  v1Body: string;
  youNeed: string;
  needPrinter: string;
  needRuler: string;
  needTable: string;
  needPhone: string;
  printHeading: string;
  printBoth: (pages: number) => string;
  printRight: (pages: number) => string;
  printLeft: (pages: number) => string;
  participantCardsLink: string;
  reusableNote: string;
  sessionOrder: string;
  sessionOrderBody: (perHand: number) => string;
  seqCard: string;
  seqCardCount: string;
  seqCardDetail: string;
  eachHand: (shots: number) => string;
  cameraAbove: string;
  cameraSide: string;
  instructions: string;
  poseOrderNote: string;
  checkSortHeading: string;
  checkKitV1: string;
  checkerBody1: string;
  checkerBody2: string;
  checkerBody3: string;
  privacyHeading: string;
  privacyBody: string;

  // /learn/print
  printMetaTitle: string;
  step: string;
  printKitV2Sheet: (sheet: string, notUsed: boolean) => string;
  sheetNameA: string;
  sheetNameB: string;
  printDialogV2: string;
  checkRulerA: string;
  checkRulerB: string;
  cardsPageBefore: string;
  cardsPageLink: string;
  print1Page: string;
  otherSheet: string;
  sheetLabel: (sheet: string, notUsed: boolean) => string;
  kitSheetLabel: (sheet: string) => string;
  printTheKit: string;
  handsBoth: string;
  handsRight: string;
  handsLeft: string;
  printKitLead: (pages: number, hands: string) => string;
  printKitLeadAfter: string;

  // /learn/slates
  slatesMetaTitle: string;
  kitV2Cards: string;
  cardsLeadV2: (from: string, to: string) => string;
  cardsLeadV2After: string;
  s0Pilot: string;
  more: string;
  slatesLead: (from: string, to: string) => string;
  slatesLeadAfter: string;
  needMore: string;
  needMoreAfter: string;

  // /learn/check
  checkMetaTitle: string;
  checkPhotos: string;
  checkLead: string;

  // CheckClient
  verdictReady: string;
  verdictSlate: string;
  verdictRetake: string;
  verdictUnidentified: string;
  usLetter: string;
  choosePhotos: string;
  orDrop: string;
  photosToCheck: string;
  sheetSize: string;
  kitV2A4Only: string;
  paperAppliesNext: string;
  kitLabel: string;
  kitV1Option: string;
  kitV2Option: (sheet: string, notUsed: boolean) => string;
  kitV2Note: string;
  checking: (current: number, total: number) => string;
  checked: (n: number) => string;
  countReady: (n: number) => string;
  countCards: (n: number) => string;
  countRetake: (n: number) => string;
  countUnidentified: (n: number) => string;
  coverage: string;
  colParticipant: string;
  colPose: string;
  colPhotos: string;
  gotOf: (got: number, expected: number) => string;
  extraShot: string;
  needsReview: string;
  needsReviewRow: (
    participant: string,
    photos: number,
    reason: string,
  ) => string;
  noQr: string;
  fileShot: (gesture: string, shot: number | null, extra: boolean) => string;
  measureLine: (
    markersLength: string,
    paperLength: string,
    markersWidth: string,
    paperWidth: string,
  ) => string;
  downloadJson: string;
  downloadNote: string;

  // /l/v1/[token]
  poseMetaTitle: string;
  session: string;
  sessionTitle: (participant: string) => string;
  sessionLead: (perHand: number) => string;
  startWith: (code: string, poseName: string) => string;
  poseOf: (n: number, total: number) => string;
  rightHand: string;
  leftHand: string;
  poseLead: (hand: string, shots: number, flat: boolean) => string;
  whatFor: string;
  nextPrefix: string;
  nextAfter: (poseName: string, otherHand: boolean) => string;
  openNext: string;
  lastPose: string;

  // Printed pages (SVG).
  svgPageLabel: (
    token: string,
    poseName: string,
    hand: "right" | "left",
  ) => string;
  svgSideTitle: (
    token: string,
    poseName: string,
    hand: "right" | "left",
    photos: number,
  ) => string;
  svgSideLine: (version: number) => string;
  svgTopLine: (version: number) => string;
  svgHandPhotos: (hand: "right" | "left", photos: number) => string;
  svgFoldUp: string;
  svgKeepFlat: string;
  svgLayAlongFold: string;
  svgFingersPoint: (hand: "right" | "left") => string;
  svgCameraSide: string;
  svgMiddleFinger: string;
  svgWristCrease: string;
  svgRulerCheck: string;
  svgSlatesLabel: (ids: string) => string;
  svgNoNames: string;
  svgPhotographFirst: string;
  svgRulerMm: string;
  svgRight: string;
  svgLeft: string;
  svgHandLength: string;
  svgPalmWidth: string;
  svgSheetLabel: (version: number, sheet: string) => string;
  svgCardsLabel: (version: number, ids: string) => string;
  svgCardBrand: (version: number) => string;

  gestures: Readonly<Record<GestureCode, GestureCopy>>;
}

const shotsLabel = (n: number) => `${n} photos`;

function enGestures(): Record<GestureCode, GestureCopy> {
  const out = {} as Record<GestureCode, GestureCopy>;
  for (const g of GESTURES) {
    out[g.code] = { name: g.name, steps: g.steps, yields: g.yields };
  }
  return out;
}

const zhTopDown =
  "手機平放在紙張正上方約 40 公分，使用主鏡頭 1×。整張紙和四個紙張邊緣都要入鏡。";
const zhSide =
  "手機放在桌上、紙張前方，鏡頭與桌面等高，正對立起的紙條，距離約 40 公分。請使用計時器或請人幫忙。";

export const zhTW: LearnCopy = {
  join: (sentences) => sentences.join(""),
  stop: "。",
  learningKit: "學習套件",
  home: "首頁",
  print: "列印",
  printPages: (n) => `列印 ${n} 頁`,
  participantCards: "受測者卡片",

  metaDescription: "印出附有 QR code 的頁面，用來蒐集用尺核對過的手部照片。",
  lead: "用印出來的頁面為每張照片貼上標籤。每一頁示範一種姿勢，並附有自己的 QR code，因此每張照片都記錄了它是哪一種姿勢。許多人的手、用尺核對過的照片，決定了空白紙張掃描能有多準。",
  v2Heading: "套件 v2：一張紙、一張卡片",
  v2Before: "收集流程",
  v2After:
    "（2026-10-02）：兩隻手共用一張 A4 紙，卡片槽放入受測者卡片，每人拍 G02 ×3，再拍 G04 ×2。姿勢由拍攝順序決定，卡片上的 QR code 則標示受測者。只使用 A 版紙張（Kirby，2026-10-02）：它保留產品紙張的四個標記。B 版（外圈六個標記、手部區域留白）已做好，但暫時不使用。",
  printSheetA: "列印 A 版紙張",
  sheetBNotUsed: "B 版（不使用，Kirby 2026-10-02）",
  cardsS0: "卡片 P901 至 P912（S0）",
  cardsMain: "卡片 P001 至 P048",
  checkSheetA: "檢查照片（A 版紙張）",
  afterSession: "拍攝結束後：",
  afterSessionB: "。它會從歸檔的副本中移除 EXIF。詳情請見",
  afterSessionC: "的「Kit v2」一節。",
  v1Heading: "套件 v1：每隻手七種姿勢",
  v1Body:
    "較早的套件，每個姿勢頁都有 QR code，並以尺實際量測的數值作為基準。它的頁面仍可在下方列印，但它的照片與 v2 的拍攝流程版本不符。",
  youNeed: "你需要",
  needPrinter: "設為 100%／實際大小的印表機，以及一般 A4 紙",
  needRuler: "一把尺，用來檢查印出的 100 mm 線，並量測每隻手",
  needTable: "比紙張更深色的桌面，以及一本可以靠住折片的書",
  needPhone: "一支手機。使用內建相機 App 的主鏡頭 1×",
  printHeading: "列印",
  printBoth: (pages) => `列印雙手，${pages} 頁`,
  printRight: (pages) => `僅右手，${pages} 頁`,
  printLeft: (pages) => `僅左手，${pages} 頁`,
  participantCardsLink: "受測者卡片",
  reusableNote:
    "這些頁面可供不同的人重複使用。每人印一張卡片：卡片上只有受測者編號，不會有姓名。",
  sessionOrder: "拍攝順序",
  sessionOrderBody: (perHand) =>
    `每隻手 ${perHand} 張照片，每隻手約 10 分鐘。每頁的 QR code 標示了姿勢與哪一隻手，檢查工具會從照片中讀取。`,
  seqCard: "卡片",
  seqCardCount: "1 張照片",
  seqCardDetail:
    "在受測者卡片上寫下用尺量到的數值：手長（手腕橫紋到中指指尖）和掌寬。先拍下這張卡片。",
  eachHand: (shots) => `每隻手 ${shots} 張`,
  cameraAbove: "相機在上方，折片攤平。",
  cameraSide: "相機與桌面等高，折片向上折起。",
  instructions: "說明",
  poseOrderNote:
    "先用右手做完全部七種姿勢，再用左手做七種。每張照片之間都要把手抬起再重新放下，同一種姿勢內也一樣。",
  checkSortHeading: "檢查與分類（套件 v1）",
  checkKitV1: "檢查套件 v1 照片",
  checkerBody1:
    "檢查工具會讀取每張照片的 QR code，找出印出的標記和紙張邊緣，並指出哪些照片需要重拍。若要依受測者和拍攝順序整批歸檔整個資料夾（2026-10-02 起僅限套件 v2），請執行",
  checkerBody2: "。它無法歸檔套件 v1 的照片。結果會寫入",
  checkerBody3: "，位於儲存庫之外。",
  privacyHeading: "隱私",
  privacyBody:
    "檢查工具在這台裝置上處理照片，不會上傳任何內容。拍攝每個人的手之前請先徵得同意，使用受測者編號而非姓名，並且不要把照片放進儲存庫。這些照片只用於測量手型與姿勢，不是健康評估。",

  printMetaTitle: "列印學習套件",
  step: "列印",
  printKitV2Sheet: (sheet, notUsed) =>
    `列印套件 v2，${sheet} 版紙張${notUsed ? "（不使用，Kirby 2026-10-02）" : ""}`,
  sheetNameA: "A 版紙張：產品紙張的四個標記、中線、手腕線和 100 mm 的尺。",
  sheetNameB:
    "B 版紙張（不使用，Kirby 2026-10-02）：外圈六個標記和空白的手部區域。",
  printDialogV2:
    "兩隻手共用一張 A4 紙。在列印視窗中選擇 A4、100%／實際大小，並關閉「縮放至符合頁面大小」。",
  checkRulerA: "然後用尺檢查 100 mm 的線。",
  checkRulerB: "然後用尺檢查標記 0 的外緣到標記 1 的外緣是否為 180 mm。",
  cardsPageBefore: "受測者卡片在",
  cardsPageLink: "卡片頁面",
  print1Page: "列印 1 頁",
  otherSheet: "另一版紙張：",
  sheetLabel: (sheet, notUsed) => `${sheet} 版${notUsed ? "（不使用）" : ""}`,
  kitSheetLabel: (sheet) => `套件 v2 · ${sheet} 版`,
  printTheKit: "列印套件",
  handsBoth: "雙手",
  handsRight: "右手",
  handsLeft: "左手",
  printKitLead: (pages, hands) => `${pages} 頁，${hands}。`,
  printKitLeadAfter:
    "在列印視窗中選擇 A4、100%／實際大小，並關閉「縮放至符合頁面大小」。然後用尺檢查其中一頁的 100 mm 線。",

  slatesMetaTitle: "受測者卡片",
  kitV2Cards: "套件 v2 受測者卡片",
  cardsLeadV2: (from, to) => `卡片 ${from} 至 ${to}，每頁 24 張。`,
  cardsLeadV2After:
    "以 A4、100%／實際大小列印，並沿虛線剪下。每張卡片為 60 × 30 mm，在每個人拍第一張照片之前放進紙張的卡片槽，之後每張照片都會標示受測者。",
  s0Pilot: "S0 試行：",
  more: "更多：",
  slatesLead: (from, to) => `卡片 ${from} 至 ${to}。`,
  slatesLeadAfter:
    "剪下卡片，把一個人用尺量到的數值寫在卡片上，並在第一個姿勢之前先拍下它。之後的每張照片都歸在這個編號下，直到下一張卡片。",
  needMore: "需要更多？在這個頁面的網址加上",
  needMoreAfter: "。",

  checkMetaTitle: "檢查照片",
  checkPhotos: "檢查照片",
  checkLead:
    "選擇一次拍攝的照片。每張都在這台裝置上檢查，不會上傳任何內容。請保留相機的檔名：檔名決定拍攝順序。",

  verdictReady: "可歸檔",
  verdictSlate: "受測者卡片",
  verdictRetake: "需要重拍",
  verdictUnidentified: "無法辨識",
  usLetter: "US Letter",
  choosePhotos: "選擇照片",
  orDrop: "或拖放到這裡",
  photosToCheck: "要檢查的照片",
  sheetSize: "頁面的紙張大小",
  kitV2A4Only: "套件 v2 僅支援 A4。",
  paperAppliesNext: "套用在你接下來選擇的照片。套件是為 A4 設計的。",
  kitLabel: "套件",
  kitV1Option: "套件 v1（舊版）",
  kitV2Option: (sheet, notUsed) =>
    `套件 v2，${sheet} 版${notUsed ? "（不使用）" : ""}`,
  kitV2Note:
    "套件 v2 依受測者卡片和拍攝順序歸檔，並保留每張標有受測者的照片。下方的判定是產品本身的判定：在你把這次拍攝的照片標為好或壞之前，請不要先看（docs/learning/README.md，「Kit v2」一節）。",
  checking: (current, total) => `正在檢查第 ${current} 張，共 ${total} 張…`,
  checked: (n) => `已檢查 ${n} 張照片。`,
  countReady: (n) => `${n} 張可歸檔`,
  countCards: (n) => `${n} 張卡片`,
  countRetake: (n) => `${n} 張需重拍`,
  countUnidentified: (n) => `${n} 張無法辨識`,
  coverage: "涵蓋範圍",
  colParticipant: "受測者",
  colPose: "姿勢",
  colPhotos: "照片",
  gotOf: (got, expected) => `${got} / ${expected}`,
  extraShot: "（多拍一張）",
  needsReview: "需要覆核",
  needsReviewRow: (participant, photos, reason) =>
    `${participant}，${photos} 張照片：${reason}。這些照片都沒有歸檔。`,
  noQr: "沒有 QR code",
  fileShot: (gesture, shot, extra) =>
    `（${gesture}，第 ${shot} 張${extra ? "，多拍" : ""}）`,
  measureLine: (ml, pl, mw, pw) =>
    `手長：標記 ${ml} mm · 紙張邊緣 ${pl} mm。掌寬：標記 ${mw} mm · 紙張邊緣 ${pw} mm。`,
  downloadJson: "下載結果（JSON）",
  downloadNote: "檔案內含每張照片的測量值和偵測到的點，不含照片本身。",

  poseMetaTitle: "學習套件姿勢",
  session: "拍攝場次",
  sessionTitle: (participant) => `場次 ${participant}`,
  sessionLead: (perHand) =>
    `拍下這張寫有用尺量到之數值的卡片，然後依序完成七種姿勢：每隻手 ${perHand} 張照片，先右手。`,
  startWith: (code, poseName) => `從 ${code} 開始，${poseName}`,
  poseOf: (n, total) => `姿勢 ${n} / ${total}`,
  rightHand: "右手",
  leftHand: "左手",
  poseLead: (hand, shots, flat) =>
    `${hand}，${shots} 張照片。${flat ? "紙張上方的折片保持攤平。" : "把紙張上方的折片向上折起。"}`,
  whatFor: "這些照片的用途",
  nextPrefix: "下一個：",
  nextAfter: (poseName, otherHand) =>
    `，${poseName}${otherHand ? "，換另一隻手" : ""}。`,
  openNext: "開啟下一個姿勢",
  lastPose: "這是最後一個姿勢。請在受測者離開之前先檢查照片。",

  svgPageLabel: (token, poseName, hand) =>
    `學習套件頁面 ${token}：${poseName}，${hand === "right" ? "右" : "左"}手`,
  svgSideTitle: (token, poseName, hand, photos) =>
    `${token} · ${poseName} · ${hand === "right" ? "右手" : "左手"} · ${photos} 張照片`,
  svgSideLine: (version) =>
    `Open Mouse 學習套件 v${version}。以 100% 列印。沿虛線折起，把折片立起來。`,
  svgTopLine: (version) =>
    `Open Mouse 學習套件 v${version}。以 100%／實際大小列印。`,
  svgHandPhotos: (hand, photos) =>
    `${hand === "right" ? "右手" : "左手"} · ${photos} 張照片`,
  svgFoldUp: "▲ 把這個折片向上折，靠在書上立起來",
  svgKeepFlat: "這個姿勢請讓折片保持攤平",
  svgLayAlongFold: "把手沿著折線放，小指側貼著立起的紙條。",
  svgFingersPoint: (hand) =>
    `手指朝這個方向（${hand === "right" ? "右手" : "左手"}）`,
  svgCameraSide: "相機：鏡頭與桌面等高，正對立起的紙條，距離約 40 公分。",
  svgMiddleFinger: "中指沿著這條線",
  svgWristCrease: "手腕橫紋對齊這條線",
  svgRulerCheck: "用真正的尺檢查：這條線正好是 100 mm。",
  svgSlatesLabel: (ids) => `受測者卡片 ${ids}`,
  svgNoNames: "不寫姓名。",
  svgPhotographFirst: "請先拍下這張卡片。",
  svgRulerMm: "尺（單位 mm）",
  svgRight: "右手",
  svgLeft: "左手",
  svgHandLength: "手長",
  svgPalmWidth: "掌寬",
  svgSheetLabel: (version, sheet) =>
    `學習套件 v${version} ${sheet} 版紙張：雙手，頂端有受測者卡片槽`,
  svgCardsLabel: (version, ids) => `套件 v${version} 受測者卡片 ${ids}`,
  svgCardBrand: (version) => `Open Mouse · 套件 v${version}`,

  gestures: {
    G01: {
      name: "平放，手指併攏",
      steps: [
        "手掌向下平放，手指併攏，拇指自然靠在食指旁。",
        "中指對齊虛線中線，手腕橫紋對齊手腕線。",
        zhTopDown,
        "每拍一張之前，都要把手抬起再重新放下。",
      ],
      yields:
        "手長、掌長、掌寬和各手指長度。五次重複拍攝是 M2 準確度與可重複性的關卡。",
    },
    G02: {
      name: "平放，手指張開",
      steps: [
        "手掌向下平放，手指自然張開，拇指向側邊伸出。",
        "中指對齊虛線中線，手腕橫紋對齊手腕線。",
        zhTopDown,
        "每拍一張之前，都要把手抬起再重新放下。",
      ],
      yields: "不被相鄰手指遮住關節的手指長度，以及拇指到小指的跨距。",
    },
    G03: {
      name: "趴握",
      steps: [
        "擺出像把手放在滑鼠上的姿勢：整個手掌放低放鬆，手指微微彎曲。",
        "掌根保持在手腕線上，中指在中線上方。",
        zhTopDown,
        "放鬆後，每拍一張之前都重新擺一次握法。",
      ],
      yields:
        "趴握時的握持開口大小與拇指角度，用來對照所述握法與手型是否相符。",
    },
    G04: {
      name: "抓握",
      steps: [
        "手指拱起，像要抓住滑鼠：指節隆起，指尖朝下，掌根貼在紙上。",
        "掌根在手腕線上，中指在中線上方。",
        zhTopDown,
        "放鬆後，每拍一張之前都重新擺一次握法。",
      ],
      yields: "抓握時的握持開口大小與拇指角度。",
    },
    G05: {
      name: "指握",
      steps: [
        "把手掌抬離紙面，只讓指尖和拇指尖碰到紙，像捏著一隻小滑鼠的邊緣。",
        "手保持在中線上方，手腕在手腕線上方。",
        zhTopDown,
        "放鬆後，每拍一張之前都重新擺一次握法。",
      ],
      yields: "指握時的握持開口大小與拇指角度。",
    },
    G06: {
      name: "側面，手掌平放",
      steps: [
        "沿虛線把這一頁上方的折片向上折，靠在書或盒子上立起來。",
        "手掌向下平放在折線旁，小指側貼著立起的紙條。右手：手指朝左。左手：手指朝右。",
        zhSide,
        "每拍一張之前，都要把手抬起再重新放下。",
      ],
      yields:
        "從側面輪廓得到的手掌厚度和指節高度。紙條位於手部中線後方約半個掌寬處；記錄下來的掌寬可讓分析修正這個差異。",
    },
    G07: {
      name: "側面，趴握",
      steps: [
        "與 G06 使用相同的側面頁面和折法。",
        "沿折線擺出 G03 的趴握姿勢，小指側朝向紙條，前臂放在桌上。",
        zhSide,
        "放鬆後，每拍一張之前都重新擺一次握法。",
      ],
      yields:
        "握著滑鼠姿勢下的指節高度與手部俯仰角，用於手與手腕角度的研究。僅供研究資料使用，不是健康評估。",
    },
  },
};

export const en: LearnCopy = {
  join: (sentences) => sentences.join(" "),
  stop: ".",
  learningKit: "Learning kit",
  home: "Home",
  print: "Print",
  printPages: (n) => `Print ${n === 1 ? "1 page" : `${n} pages`}`,
  participantCards: "Participant cards",

  metaDescription:
    "Printed, QR-labelled pages for collecting ruler-checked hand photos.",
  lead: "Printed pages that label every photo. Each page shows one hand pose and carries its own QR code, so a photo records which pose it is. Photos from many hands, checked against a ruler, set how accurate the blank-paper scan can be.",
  v2Heading: "Kit v2: one sheet, one card",
  v2Before: "The collection protocol",
  v2After:
    "(2026-10-02): one A4 sheet for both hands, a participant card in its slot, G02 ×3 then G04 ×2 per person. The pose comes from the shooting order; the card's QR code names the participant. Only sheet A is used (Kirby, 2026-10-02): it keeps the product sheet's four markers. Sheet B (six markers on the outer ring, a blank hand area) is built but not used for now.",
  printSheetA: "Print sheet A",
  sheetBNotUsed: "Sheet B (not used, Kirby 2026-10-02)",
  cardsS0: "Cards P901 to P912 (S0)",
  cardsMain: "Cards P001 to P048",
  checkSheetA: "Check photos (sheet A)",
  afterSession: "After a session:",
  afterSessionB: ". It strips EXIF from the filed copies. Details:",
  afterSessionC: ", “Kit v2”.",
  v1Heading: "Kit v1: seven poses per hand",
  v1Body:
    "The earlier kit, with a QR code on every pose page and a ruler-measured truth. Its pages stay printable below. Its photos are a version mismatch to a v2 run.",
  youNeed: "You need",
  needPrinter: "A printer set to 100% / Actual size, and plain A4 paper",
  needRuler: "A ruler, to check the printed 100 mm line and measure each hand",
  needTable:
    "A table darker than the paper, and a book to stand a flap against",
  needPhone: "A phone. Use its normal camera app with the main 1× lens",
  printHeading: "Print",
  printBoth: (pages) => `Print both hands, ${pages} pages`,
  printRight: (pages) => `Right hand only, ${pages} pages`,
  printLeft: (pages) => `Left hand only, ${pages} pages`,
  participantCardsLink: "Participant cards",
  reusableNote:
    "The pages are reusable across people. Print one card per person: it carries their participant number, never their name.",
  sessionOrder: "Session order",
  sessionOrderBody: (perHand) =>
    `${perHand} photos per hand, about 10 minutes per hand. Each page's QR code names its pose and hand; the checker reads it from the photo.`,
  seqCard: "Card",
  seqCardCount: "1 photo",
  seqCardDetail:
    "Write the ruler values on the participant card: hand length (wrist crease to middle fingertip) and palm width. Photograph the card first.",
  eachHand: (shots) => `${shots} × each hand`,
  cameraAbove: "Camera above, flap flat.",
  cameraSide: "Camera at table height, flap folded up.",
  instructions: "Instructions",
  poseOrderNote:
    "Do all seven poses with the right hand, then all seven with the left. Lift the hand and place it again between photos, even within a pose.",
  checkSortHeading: "Check and sort (kit v1)",
  checkKitV1: "Check kit v1 photos",
  checkerBody1:
    "The checker reads each photo's QR code, finds the printed markers and the paper edges, and says which photos to retake. To file a whole folder, kit v2 only since 2026-10-02, by participant and shooting order, run",
  checkerBody2: ". It cannot file kit v1 photos. It writes to",
  checkerBody3: ", outside the repo.",
  privacyHeading: "Privacy",
  privacyBody:
    "The checker processes photos on this device; nothing is uploaded. Ask each person before photographing their hand, use participant numbers instead of names, and keep the photos out of the repo. These photos are for measuring hand shape and posture only; they are not a health assessment.",

  printMetaTitle: "Print the learning kit",
  step: "Print",
  printKitV2Sheet: (sheet, notUsed) =>
    `Print kit v2, sheet ${sheet}${notUsed ? " (not used, Kirby 2026-10-02)" : ""}`,
  sheetNameA:
    "Sheet A: the product sheet's four markers, centre line, wrist line and a 100 mm ruler.",
  sheetNameB:
    "Sheet B (not used, Kirby 2026-10-02): six markers on the outer ring and a blank hand area.",
  printDialogV2:
    "One A4 page for both hands. In the print dialog choose A4, 100% / Actual size, and turn off “Fit to page”.",
  checkRulerA: "Then check the 100 mm line with a ruler.",
  checkRulerB:
    "Then check with a ruler that the outer edge of marker 0 to the outer edge of marker 1 is 180 mm.",
  cardsPageBefore: "Participant cards are on the",
  cardsPageLink: "cards page",
  print1Page: "Print 1 page",
  otherSheet: "Other sheet:",
  sheetLabel: (sheet, notUsed) =>
    `sheet ${sheet}${notUsed ? " (not used)" : ""}`,
  kitSheetLabel: (sheet) => `Kit v2 · sheet ${sheet}`,
  printTheKit: "Print the kit",
  handsBoth: "both hands",
  handsRight: "right hand",
  handsLeft: "left hand",
  printKitLead: (pages, hands) => `${pages} pages, ${hands}.`,
  printKitLeadAfter:
    "In the print dialog choose A4, 100% / Actual size, and turn off “Fit to page”. Then check the 100 mm line on one page with a ruler.",

  slatesMetaTitle: "Participant cards",
  kitV2Cards: "Kit v2 participant cards",
  cardsLeadV2: (from, to) => `Cards ${from} to ${to}, 24 to a page.`,
  cardsLeadV2After:
    "Print at A4, 100% / Actual size, and cut along the dashed lines. Each card is 60 × 30 mm and goes in the sheet's card slot before a person's first photo; every photo then names its participant.",
  s0Pilot: "S0 pilot:",
  more: "More:",
  slatesLead: (from, to) => `Cards ${from} to ${to}.`,
  slatesLeadAfter:
    "Cut them out, write one person's ruler values on a card, and photograph it before their first pose. Every photo after it is filed under that number until the next card.",
  needMore: "Need more? Add",
  needMoreAfter: "to this page's address.",

  checkMetaTitle: "Check photos",
  checkPhotos: "Check photos",
  checkLead:
    "Choose the photos from a session. Each one is checked on this device; nothing is uploaded. Keep the camera's file names: they set the capture order.",

  verdictReady: "Ready to file",
  verdictSlate: "Participant card",
  verdictRetake: "Retake",
  verdictUnidentified: "Not identified",
  usLetter: "US Letter",
  choosePhotos: "Choose photos",
  orDrop: "or drop them here",
  photosToCheck: "Photos to check",
  sheetSize: "Sheet size of the pages",
  kitV2A4Only: "Kit v2 is A4 only.",
  paperAppliesNext:
    "Applies to the photos you choose next. The kit is designed for A4.",
  kitLabel: "Kit",
  kitV1Option: "Kit v1: pose pages with their own QR code (earlier kit)",
  kitV2Option: (sheet, notUsed) =>
    `Kit v2: sheet ${sheet}, participant card in the slot${notUsed ? " (not used, Kirby 2026-10-02)" : ""}`,
  kitV2Note:
    "Kit v2 files by the participant card and the shooting order, and keeps every photo that names a participant. The verdicts below are the product's own: do not look at them before you have labelled the session's photos good or bad (docs/learning/README.md, “Kit v2”).",
  checking: (current, total) => `Checking ${current} of ${total}…`,
  checked: (n) => `Checked ${n} photo${n === 1 ? "" : "s"}.`,
  countReady: (n) => `${n} ready`,
  countCards: (n) => `${n} cards`,
  countRetake: (n) => `${n} to retake`,
  countUnidentified: (n) => `${n} not identified`,
  coverage: "Coverage",
  colParticipant: "Participant",
  colPose: "Pose",
  colPhotos: "Photos",
  gotOf: (got, expected) => `${got} of ${expected}`,
  extraShot: " (extra shot)",
  needsReview: "Needs review",
  needsReviewRow: (participant, photos, reason) =>
    `${participant}, ${photos} photos: ${reason}. None of them is filed.`,
  noQr: "No QR code",
  fileShot: (gesture, shot, extra) =>
    ` (${gesture}, shot ${shot}${extra ? ", extra" : ""})`,
  measureLine: (ml, pl, mw, pw) =>
    `Hand length: markers ${ml} mm · paper edges ${pl} mm. Palm width: markers ${mw} mm · paper edges ${pw} mm.`,
  downloadJson: "Download results (JSON)",
  downloadNote:
    "The file holds the measurements and detected points for each photo, not the photos.",

  poseMetaTitle: "Learning kit pose",
  session: "Session",
  sessionTitle: (participant) => `Session ${participant}`,
  sessionLead: (perHand) =>
    `Photograph this card with the ruler values written on it, then work through the seven poses: ${perHand} photos per hand, right hand first.`,
  startWith: (code, poseName) =>
    `Start with ${code}, ${poseName.toLowerCase()}`,
  poseOf: (n, total) => `Pose ${n} of ${total}`,
  rightHand: "Right hand",
  leftHand: "Left hand",
  poseLead: (hand, shots, flat) =>
    `${hand}, ${shots} photos. ${flat ? "Keep the sheet's top flap flat." : "Fold the sheet's top flap up."}`,
  whatFor: "What these photos are for",
  nextPrefix: "Next:",
  nextAfter: (poseName, otherHand) =>
    `, ${poseName.toLowerCase()}${otherHand ? ", other hand" : ""}.`,
  openNext: "Open the next pose",
  lastPose:
    "That was the last pose. Check the photos before the person leaves.",

  svgPageLabel: (token, poseName, hand) =>
    `Learning kit page ${token}: ${poseName}, ${hand} hand`,
  svgSideTitle: (token, poseName, hand, photos) =>
    `${token} · ${poseName} · ${hand === "right" ? "Right" : "Left"} hand · ${shotsLabel(photos)}`,
  svgSideLine: (version) =>
    `Open Mouse learning kit v${version}. Print at 100%. Fold along the dashed line and stand the flap up.`,
  svgTopLine: (version) =>
    `Open Mouse learning kit v${version}. Print at 100% / Actual size.`,
  svgHandPhotos: (hand, photos) =>
    `${hand === "right" ? "Right" : "Left"} hand · ${shotsLabel(photos)}`,
  svgFoldUp: "▲ fold this flap up and stand it against a book",
  svgKeepFlat: "Keep this flap flat for this pose",
  svgLayAlongFold:
    "Lay the hand along the fold, its little-finger edge touching the folded-up strip.",
  svgFingersPoint: (hand) => `Fingers point this way (${hand} hand)`,
  svgCameraSide:
    "Camera: lens at table height, facing the upright strip, about 40 cm away.",
  svgMiddleFinger: "middle finger along this line",
  svgWristCrease: "wrist crease on this line",
  svgRulerCheck: "Check with a real ruler: this line is exactly 100 mm.",
  svgSlatesLabel: (ids) => `Participant slates ${ids}`,
  svgNoNames: "No names.",
  svgPhotographFirst: "Photograph this card first.",
  svgRulerMm: "Ruler, in mm",
  svgRight: "Right",
  svgLeft: "Left",
  svgHandLength: "Hand length",
  svgPalmWidth: "Palm width",
  svgSheetLabel: (version, sheet) =>
    `Learning kit v${version} sheet ${sheet}: both hands, participant card slot at the top`,
  svgCardsLabel: (version, ids) => `Kit v${version} participant cards ${ids}`,
  svgCardBrand: (version) => `Open Mouse · kit v${version}`,

  gestures: enGestures(),
};

/**
 * Words the kit v2 layout draws (`src/lib/learning/layoutv2.ts` keeps them in
 * English, as part of its tested geometry); the printed sheet shows this
 * translation of each, and anything not listed as it is. Candidates (未拍板).
 */
const LAYOUT_TEXT_ZH: Readonly<Record<string, string>> = {
  "G02 ×3, then G04 ×2": "G02 ×3，再 G04 ×2",
  "sheet A": "A 版紙張",
  "sheet B": "B 版紙張",
  "participant card": "受測者卡片",
  "middle finger along this line": "中指沿著這條線",
  "wrist crease on this line": "手腕橫紋對齊這條線",
  "100 mm: check with a ruler (print at 100%)":
    "100 mm：用尺檢查（以 100% 列印）",
  "Keep all four paper corners visible": "紙張四角都要入鏡",
  "wrist crease": "手腕橫紋",
  "outer edge to outer edge": "外緣到外緣",
};

/** The text of one drawn layout label in the visitor's language. */
export function layoutText(locale: Locale, text: string): string {
  return locale === "zh-TW" ? (LAYOUT_TEXT_ZH[text] ?? text) : text;
}

export function learnCopy(locale: Locale): LearnCopy {
  return pickCopy(locale, { zhTW, en });
}
