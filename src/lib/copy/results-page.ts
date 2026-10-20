/**
 * Words for the results page (`/results/[scanId]` and its detail pages), zh-TW
 * and English, same keys. The page picks a table by the site locale
 * (`useLocale()`, 2026-10-11), the same way `fit-bands.ts` is read.
 *
 * Every string here is a CANDIDATE (未拍板) until Kirby has read it. The hand
 * type copy describes the MOUSE that suits the person, never the hand, and
 * never compares anyone with anyone else (Kirby, 2026-10-09).
 *
 * Not covered: the English strings inside the components the page reuses
 * (`SubscoreBar`, `TargetDeltas`, `AnalysisSlot`, `ConfidenceNote`,
 * `DeleteScanAction`) and the loading and error screens. They
 * are English only for now.
 */
import type { ExclusionReason, GripStyle, Subscore } from "../contracts/fit";
import type {
  ConnectivityOption,
  FilterGroup,
  ShapeOption,
  SizeOption,
  WeightOption,
} from "../results/filters";
import type { ShapeSegment } from "../results/shapeToggle";
import type { Locale } from "../../lib/contracts/locale";

export interface ResultsPageCopy {
  /** Return link in the top bar. */
  scanAgain: string;
  /** The back link's accessible name: the destination, with a "back to" in front (the TopBar convention). */
  backTo: (destination: string) => string;
  /** `aria-label` of the top bar `<nav>`. */
  topBarLabel: string;
  /** Small line above the hand-type title. */
  handKicker: string;
  /** Hand-type parts, joined into the title. */
  handSize: Record<"small" | "medium" | "large", string>;
  handGrip: Record<GripStyle, string>;
  handWidth: Record<"slim" | "wide", string>;
  /** Joins the three title parts. */
  handTitleSeparator: string;
  /** Pieces of the one sentence under the title. */
  handSentence: {
    length: Record<"small" | "medium" | "large", string>;
    width: Record<"slim" | "wide", string>;
    grip: Record<GripStyle, string>;
    build: (parts: { length: string; width: string; grip: string }) => string;
  };
  /** "Rank 1 · Brand" line above the model name. */
  rankLine: (rank: number, brand: string) => string;
  scoreLabel: string;
  /** Heading above the three reason lines. */
  whyHeading: string;
  /** Short name of each sub-score in the three reason lines. */
  subscoreShort: Record<Subscore, string>;
  /** Where to buy: only shown when a link exists. Just the one word; no note line (Kirby, 2026-10-11). */
  purchaseHeading: string;
  /** Visually hidden, after each purchase link's text and after the official link's. */
  opensInNewTab: string;
  /** The maker's page for this very model (`officialKind` "product"). */
  officialProduct: (brand: string) => string;
  /** A lineup, series or support page of the maker (`officialKind` "brand"). */
  officialBrand: (brand: string) => string;
  detailsTitle: string;
  detailsHint: string;
  /** The hint while the 3D viewer is shown (`RESULTS_VIEWER_ENABLED`). */
  detailsHintWithViewer: string;
  scoresHeading: string;
  sizeNotice: string;
  fitNotice: string;
  /**
   * Shown instead of every score while the hand is outside the catalogue's
   * length range (`coverage.lengthOutOfRange`). `above` / `below` follow
   * `coverage.direction`; `partial` is for `direction` null (only some grips
   * are clamped). Candidate (未拍板): the first two are the 2026-10-18 draft
   * with "overall score" in place of "fit score", because the six sub-scores
   * stay on the page; the third is new. No health claim anywhere.
   */
  coverageNotice: { above: string; below: string; partial: string };
  enteredLengthNotice: (mm: number) => string;
  /**
   * One line shown when the target sizes were nudged by the survey ratings of
   * a signed-in person (fit-v3 automatic calibration: at least two usable
   * ratings, a non-zero shift). Candidate (未拍板, Kirby 2026-10-20: draft, to
   * be read before it ships). Says only where the nudge came from; no health
   * claim, no promise of accuracy, no number.
   */
  calibrationNotice: string;
  leftHandNotice: string;
  othersHeading: string;
  othersCaption: string;
  /**
   * One line on a card whose shell is shared with other catalogue entries
   * (SHELL-1). `models` are the variants' full model names. Wording is
   * Kirby's (2026-10-14, replacing 「相同構型」 of 2026-10-10): zh-TW
   * 「同款殼」, English "Same shell". Text only: a variant has no score, rank
   * or link.
   */
  variantsLine: (models: readonly string[]) => string;
  /** Out of 100, after a total. */
  outOf: string;
  otherMiceTitle: (count: number) => string;
  otherMiceHint: string;
  excludedHeading: string;
  /**
   * Why a mouse is not ranked, in words. `userHand` is the hand the scan
   * measured: a `wrong_hand` mouse is made for the other one.
   */
  excludedReason: (
    reason: ExclusionReason,
    userHand: "left" | "right",
  ) => string;
  /**
   * The label of an excluded mouse's number. The number is the score of the
   * mouse's mirror image for the scanned hand, i.e. of the shape in the
   * person's own hand's version, never "this mouse fits you".
   */
  excludedMirrorLabel: (userHand: "left" | "right") => string;
  /** Between the reason and the mirrored score. */
  excludedSeparator: string;
  /** The results-page filter (FILTER-1). Every string is a candidate. */
  filter: FilterCopy;
  /**
   * The shape toggle above the filter button (V3.2 U1). Every string is a
   * candidate (未拍板, Claude's draft from the 2026-10-21 design).
   */
  shapeToggle: ShapeToggleCopy;
  /** Click the big photo to enlarge it (candidate, 2026-10-11). */
  photoZoom: {
    /** Accessible name of the photo button, with the mouse named. */
    enlarge: (name: string) => string;
    close: string;
    /** Read by screen readers with the dialog; never shown. */
    keys: string;
  };
}

/**
 * Words of the results-page filter (FILTER-1, candidate / 未拍板). Wording of
 * the filter's groups, 適合你, the no-match button and the status line is
 * Kirby's (2026-10-10); the rest is Claude's draft.
 */
export interface FilterCopy {
  title: string;
  /** The phone's button; `n` chosen options, none shows no number. */
  openButton: (n: number) => string;
  /** 「找到 N 款」: the count line and the live region. */
  found: (n: number) => string;
  clearAll: string;
  /** Accessible name of a chip's remove button. */
  removeChip: (label: string) => string;
  /** The chips' list. */
  chipsLabel: string;
  group: Record<FilterGroup, string>;
  /** The collapsed header's summary when nothing is chosen. */
  anyValue: string;
  /** Joins several chosen options in a collapsed header. */
  summaryJoin: string;
  size: Record<SizeOption, string>;
  /** Under the size group's title. */
  sizeNote: string;
  fitsYou: string;
  weight: Record<WeightOption, string>;
  shape: Record<ShapeOption, string>;
  connectivity: Record<ConnectivityOption, string>;
  showMoreBrands: (n: number) => string;
  showFewerBrands: string;
  /** Accessible name of an option: its label, then how many it would give. */
  optionName: (label: string, count: number, fits: boolean) => string;
  /** The sheet's footer button. */
  viewButton: (n: number) => string;
  closeSheet: string;
  noMatch: string;
  relaxButton: (groupName: string, count: number) => string;
  oneLeft: string;
  /** Under a group that has a choice, when some mice lack that value. */
  missingData: (noun: string, n: number) => string;
  missingNoun: Record<"weight" | "shape" | "connectivity", string>;
  filteredRank: (n: number) => string;
  /** A card's place in the filtered list. */
  place: (n: number) => string;
  overallRank: (n: number) => string;
  /** On a detail page: the way back to the filtered list. */
  backToList: (n: number) => string;
  /** Above the other picks while filtering. */
  othersHeading: string;
  /** Replaces the excluded list while filtering. */
  excludedHidden: (n: number) => string;
  /** The collapsed analysis line and its buttons. */
  analysisLine: (name: string) => string;
  analysisShow: string;
  analysisHide: string;
  /** The share button and its note while filtering. */
  shareOverall: string;
  shareNote: string;
}

/** Words of the 「綜合｜左右對稱｜人體工學」 toggle (V3.2 U1, candidate / 未拍板). */
export interface ShapeToggleCopy {
  /** The toggle's accessible name. */
  label: string;
  segment: Record<ShapeSegment, string>;
  /** The large card's place when the shape is the only filter: 「人體工學第 1 名」. */
  segmentRank: (n: number, segment: string) => string;
  /** Under a shape that has only a few mice, all of them on the page. */
  fewNote: (n: number, segment: string) => string;
  /** The note's way back to 「綜合」. */
  seeOverall: string;
}

const NBSP = " ";

export const zhTW: ResultsPageCopy = {
  scanAgain: "重新掃描",
  backTo: (destination) => `返回${destination}`,
  topBarLabel: "結果頁導覽",
  handKicker: "適合你的滑鼠型",
  handSize: { small: "小型滑鼠", medium: "中型滑鼠", large: "大型滑鼠" },
  handGrip: { palm: "趴握", claw: "抓握", fingertip: "指握" },
  handWidth: { slim: "窄身", wide: "寬身" },
  handTitleSeparator: "・",
  handSentence: {
    length: { small: "偏短", medium: "中等", large: "偏長" },
    width: { slim: "較窄", wide: "較寬" },
    grip: { palm: "趴握", claw: "抓握", fingertip: "指握" },
    build: ({ length, width, grip }) =>
      `適合長度${length}、握寬${width}的滑鼠；以${grip}的方式最能發揮。`,
  },
  // Arabic numerals since FILTER-1 (Kirby, 2026-10-10): 「第 5 名」, like the
  // filter's 「總排名第 5 名」.
  rankLine: (rank, brand) => `第 ${rank} 名 · ${brand}`,
  scoreLabel: "合手度分數 / 100",
  whyHeading: "為什麼是這支",
  subscoreShort: {
    length: "長度",
    gripWidth: "握寬",
    heightHump: "高度",
    frontFlare: "前端",
    thumb: "拇指",
    weight: "重量",
  },
  purchaseHeading: "購買",
  opensInNewTab: "（開新分頁）",
  officialProduct: (brand) => `${brand} 官網產品頁`,
  officialBrand: (brand) => `${brand} 品牌頁`,
  detailsTitle: "詳細資料",
  detailsHint: "六項分數、和理想尺寸的差距、完整分析",
  detailsHintWithViewer: "3D 檢視、六項分數、和理想尺寸的差距、完整分析",
  scoresHeading: "六項分數",
  sizeNotice: "這支滑鼠有幾項形狀分數還沒評過，所以合手度分數目前主要看尺寸。",
  fitNotice: "這幾支都不太適合你的手，下面是最接近的一支。",
  coverageNotice: {
    above:
      "你的手型超出目前目錄涵蓋範圍。以下是目錄中最大、與你其他尺寸最接近的款式，僅供參考，不提供合手度總分。",
    below:
      "你的手型超出目前目錄涵蓋範圍。以下是目錄中最小、與你其他尺寸最接近的款式，僅供參考，不提供合手度總分。",
    partial:
      "你的手型在部分握法下，理想尺寸超出目前目錄涵蓋範圍。排名僅供參考，不提供合手度總分。",
  },
  enteredLengthNotice: (mm) =>
    `依你輸入的手長（${mm}${NBSP}mm）估算，掃描時沒有使用紙張。`,
  calibrationNotice: "已參考你在問卷評過的滑鼠微調尺寸",
  leftHandNotice: "左手的合手度還沒評過，購買前請先確認每支滑鼠的形狀。",
  othersHeading: "其他推薦",
  othersCaption: "點選任一款，會看到同樣版面的結果頁。",
  variantsLine: (models) => `同款殼：${models.join("、")}`,
  outOf: "/ 100",
  otherMiceTitle: (count) => `其他滑鼠（共 ${count} 款）`,
  otherMiceHint: "分數與型號；未列入比較的附原因",
  excludedHeading: "未列入比較",
  excludedReason: (reason, userHand) => {
    switch (reason) {
      case "wrong_hand":
        return userHand === "right" ? "為左手設計" : "為右手設計";
      case "vertical_form_factor":
        return "垂直滑鼠：目前的評分方式不適用";
      case "trackball_form_factor":
        return "軌跡球：目前的評分方式不適用";
    }
  },
  excludedMirrorLabel: (userHand) =>
    userHand === "right" ? "若是右手形狀：" : "若是左手形狀：",
  excludedSeparator: " · ",
  filter: {
    title: "篩選",
    openButton: (n) => (n > 0 ? `篩選（${n}）` : "篩選"),
    found: (n) => `找到 ${n} 款`,
    clearAll: "清除全部",
    removeChip: (label) => `移除「${label}」`,
    chipsLabel: "已套用的篩選",
    group: {
      brand: "品牌",
      size: "尺寸",
      weight: "重量",
      shape: "滑鼠握感",
      connectivity: "連線方式",
    },
    anyValue: "不限",
    summaryJoin: "、",
    size: { small: "小型鼠", medium: "中型鼠", large: "大型鼠" },
    sizeNote: "依長度與寬度估算",
    fitsYou: "適合你",
    weight: {
      lt50: "未滿 50 g",
      "50-69": "50–69 g",
      "70-89": "70–89 g",
      gte90: "90 g 以上",
    },
    shape: { ergonomic: "人體工學", symmetrical: "左右對稱" },
    connectivity: { wireless: "無線", wired: "有線" },
    showMoreBrands: (n) => `顯示其他 ${n} 個品牌`,
    showFewerBrands: "收合其他品牌",
    optionName: (label, count, fits) =>
      `${label}，${count} 款${fits ? "，適合你" : ""}`,
    viewButton: (n) => `查看 ${n} 款滑鼠`,
    closeSheet: "關閉篩選",
    noMatch: "目前沒有符合條件的滑鼠",
    relaxButton: (groupName, count) =>
      `拿掉「${groupName}」條件，可看到 ${count} 款`,
    oneLeft: "只有這 1 款符合",
    missingData: (noun, n) => `另有 ${n} 款沒有${noun}資料，篩選時不會列出`,
    missingNoun: { weight: "重量", shape: "握感", connectivity: "連線方式" },
    filteredRank: (n) => `篩選後第 ${n} 名`,
    place: (n) => `第 ${n} 名`,
    overallRank: (n) => `總排名第 ${n} 名`,
    backToList: (n) => `回到篩選結果（${n} 款）`,
    othersHeading: "其他符合條件的推薦",
    excludedHidden: (n) => `篩選中，未列入比較的 ${n} 款不會列出。`,
    analysisLine: (name) => `AI 分析是針對總排名第 1 的 ${name}`,
    analysisShow: "看分析",
    analysisHide: "收起分析",
    shareOverall: "分享總排名第 1 名",
    shareNote: "篩選中，分享圖仍放總排名第 1 名",
  },
  shapeToggle: {
    label: "滑鼠形狀",
    segment: {
      overall: "綜合",
      symmetrical: "左右對稱",
      ergonomic: "人體工學",
    },
    segmentRank: (n, segment) => `${segment}第 ${n} 名`,
    fewNote: (n, segment) =>
      `目前符合的${segment}款只有 ${n} 款，全部列在這裡。`,
    seeOverall: "看綜合排序",
  },
  photoZoom: {
    enlarge: (name) => `放大照片：${name}`,
    close: "關閉",
    keys: "按加號與減號縮放，按 0 還原，放大後可用方向鍵移動，按 Esc 關閉。",
  },
};

export const en: ResultsPageCopy = {
  scanAgain: "Scan again",
  backTo: (destination) => `Back to ${destination}`,
  topBarLabel: "Results navigation",
  handKicker: "The mouse type for you",
  handSize: {
    small: "Small mouse",
    medium: "Medium mouse",
    large: "Large mouse",
  },
  handGrip: {
    palm: "Palm grip",
    claw: "Claw grip",
    fingertip: "Fingertip grip",
  },
  handWidth: { slim: "Slim", wide: "Wide" },
  handTitleSeparator: " · ",
  handSentence: {
    length: {
      small: "a shorter",
      medium: "a medium-length",
      large: "a longer",
    },
    width: { slim: "a narrower", wide: "a wider" },
    grip: { palm: "a palm", claw: "a claw", fingertip: "a fingertip" },
    build: ({ length, width, grip }) =>
      `Suits ${length} mouse with ${width} grip width; it works best with ${grip} grip.`,
  },
  rankLine: (rank, brand) => `#${rank} · ${brand}`,
  scoreLabel: "fit score / 100",
  whyHeading: "Why this mouse",
  subscoreShort: {
    length: "Length",
    gripWidth: "Grip width",
    heightHump: "Height",
    frontFlare: "Front",
    thumb: "Thumb",
    weight: "Weight",
  },
  purchaseHeading: "Buy",
  opensInNewTab: "(opens in a new tab)",
  officialProduct: (brand) => `${brand} official product page`,
  officialBrand: (brand) => `${brand} brand page`,
  detailsTitle: "Details",
  detailsHint: "Six scores, gaps to your ideal size, full analysis",
  detailsHintWithViewer:
    "3D view, six scores, gaps to your ideal size, full analysis",
  scoresHeading: "How it scores",
  sizeNotice:
    "Some shape scores aren't rated yet for this mouse, so the fit score currently leans on its size.",
  fitNotice: "None of these fits your hand well. The closest is below.",
  coverageNotice: {
    above:
      "Your hand is larger than the catalogue currently covers. Below are the largest mice in it, closest to your other measurements. For reference only, with no overall fit score.",
    below:
      "Your hand is smaller than the catalogue currently covers. Below are the smallest mice in it, closest to your other measurements. For reference only, with no overall fit score.",
    partial:
      "For some grips, your ideal size falls outside what the catalogue currently covers. The order is for reference only, with no overall fit score.",
  },
  enteredLengthNotice: (mm) =>
    `Based on the hand length you entered (${mm}${NBSP}mm). Measured without paper.`,
  calibrationNotice: "Sizes adjusted using the mice you rated in the survey.",
  leftHandNotice:
    "Left-hand fit isn't rated yet — check each mouse's shape before you buy.",
  othersHeading: "Other picks",
  othersCaption: "Tap any pick to see a results page with the same layout.",
  variantsLine: (models) => `Same shell: ${models.join(", ")}`,
  outOf: "/ 100",
  otherMiceTitle: (count) => `Other mice (${count})`,
  otherMiceHint: "Scores and names; mice left out show why",
  excludedHeading: "Not shown",
  excludedReason: (reason, userHand) => {
    switch (reason) {
      case "wrong_hand":
        return userHand === "right"
          ? "Made for the left hand"
          : "Made for the right hand";
      case "vertical_form_factor":
        return "Vertical mouse: our scoring doesn't cover this shape yet";
      case "trackball_form_factor":
        return "Trackball: our scoring doesn't cover this shape yet";
    }
  },
  excludedMirrorLabel: (userHand) =>
    userHand === "right" ? "as a right-hand shape:" : "as a left-hand shape:",
  excludedSeparator: " · ",
  filter: {
    title: "Filter",
    openButton: (n) => (n > 0 ? `Filter (${n})` : "Filter"),
    found: (n) => (n === 1 ? "1 mouse found" : `${n} mice found`),
    clearAll: "Clear all",
    removeChip: (label) => `Remove "${label}"`,
    chipsLabel: "Applied filters",
    group: {
      brand: "Brand",
      size: "Size",
      weight: "Weight",
      shape: "Shape",
      connectivity: "Connection",
    },
    anyValue: "Any",
    summaryJoin: ", ",
    size: { small: "Small", medium: "Medium", large: "Large" },
    sizeNote: "Estimated from length and width",
    fitsYou: "Fits you",
    weight: {
      lt50: "Under 50 g",
      "50-69": "50–69 g",
      "70-89": "70–89 g",
      gte90: "90 g and up",
    },
    shape: { ergonomic: "Ergonomic", symmetrical: "Symmetrical" },
    connectivity: { wireless: "Wireless", wired: "Wired" },
    showMoreBrands: (n) => `Show ${n} more brands`,
    showFewerBrands: "Show fewer brands",
    optionName: (label, count, fits) =>
      `${label}, ${count === 1 ? "1 mouse" : `${count} mice`}${fits ? ", fits you" : ""}`,
    viewButton: (n) => (n === 1 ? "View 1 mouse" : `View ${n} mice`),
    closeSheet: "Close filter",
    noMatch: "No mouse matches these filters",
    relaxButton: (groupName, count) =>
      `Remove "${groupName}" to see ${count} ${count === 1 ? "mouse" : "mice"}`,
    oneLeft: "Only this one matches",
    missingData: (noun, n) =>
      `${n} more ${n === 1 ? "mouse has" : "mice have"} no ${noun} data and ${n === 1 ? "is" : "are"} not listed while you filter`,
    missingNoun: {
      weight: "weight",
      shape: "shape",
      connectivity: "connection",
    },
    filteredRank: (n) => `#${n} in your filter`,
    place: (n) => `#${n}`,
    overallRank: (n) => `#${n} overall`,
    backToList: (n) =>
      n === 1
        ? "Back to the filtered list (1 mouse)"
        : `Back to the filtered list (${n} mice)`,
    othersHeading: "Other picks that match",
    excludedHidden: (n) =>
      `While you filter, the ${n} mice left out of the ranking are not listed.`,
    analysisLine: (name) =>
      `The written analysis is about the overall #1, ${name}`,
    analysisShow: "Show analysis",
    analysisHide: "Hide analysis",
    shareOverall: "Share the overall #1",
    shareNote: "While filtering, the share image still shows the overall #1",
  },
  shapeToggle: {
    label: "Mouse shape",
    segment: {
      overall: "Overall",
      symmetrical: "Symmetrical",
      ergonomic: "Ergonomic",
    },
    segmentRank: (n, segment) => `#${n} ${segment.toLowerCase()}`,
    fewNote: (n, segment) =>
      `Only ${n} ${segment.toLowerCase()} mice match right now. They are all listed here.`,
    seeOverall: "See the overall ranking",
  },
  photoZoom: {
    enlarge: (name) => `Enlarge photo: ${name}`,
    close: "Close",
    keys: "Press plus and minus to zoom, 0 to reset, arrow keys to move when zoomed, Escape to close.",
  },
};

export const RESULTS_PAGE_COPY: Record<Locale, ResultsPageCopy> = {
  "zh-TW": zhTW,
  en,
};
