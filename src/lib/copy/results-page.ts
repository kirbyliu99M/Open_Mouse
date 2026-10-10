/**
 * Words for the results page (`/results/[scanId]` and its detail pages), zh-TW
 * and English, same keys. There is no i18n framework yet (2026-10-09): the
 * page picks a table with `pickUiLanguage` (`src/client/uiLanguage.ts`), the
 * same way `fit-bands.ts` is read.
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
import type { UiLanguage } from "../../client/uiLanguage";

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
  /** Where to buy: only shown when a link exists. */
  purchaseHeading: string;
  /** One short line above the purchase links. */
  purchaseNote: string;
  /** Visually hidden, after each purchase link's text. */
  opensInNewTab: string;
  detailsTitle: string;
  detailsHint: string;
  /** The hint while the 3D viewer is shown (`RESULTS_VIEWER_ENABLED`). */
  detailsHintWithViewer: string;
  scoresHeading: string;
  sizeNotice: string;
  fitNotice: string;
  enteredLengthNotice: (mm: number) => string;
  leftHandNotice: string;
  othersHeading: string;
  othersCaption: string;
  /**
   * One line on a card whose shell is shared with other catalogue entries
   * (SHELL-1). `models` are the variants' full model names. Wording is
   * Kirby's (approved 2026-10-10): zh-TW 「相同構型」, English "Same
   * modeling". Text only: a variant has no score, rank or link.
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
  scoreLabel: "適配分數 / 100",
  whyHeading: "為什麼是這支",
  subscoreShort: {
    length: "長度",
    gripWidth: "握寬",
    heightHump: "高度",
    frontFlare: "前端",
    thumb: "拇指",
    weight: "重量",
  },
  purchaseHeading: "購買連結",
  purchaseNote: "合作商店連結・開新分頁",
  opensInNewTab: "（開新分頁）",
  detailsTitle: "詳細資料",
  detailsHint: "六項分數、和理想尺寸的差距、完整分析",
  detailsHintWithViewer: "3D 檢視、六項分數、和理想尺寸的差距、完整分析",
  scoresHeading: "六項分數",
  sizeNotice: "這支滑鼠有幾項形狀分數還沒評過，所以適配分數目前主要看尺寸。",
  fitNotice: "這幾支都不太適合你的手，下面是最接近的一支。",
  enteredLengthNotice: (mm) =>
    `依你輸入的手長（${mm}${NBSP}mm）估算，掃描時沒有使用紙張。`,
  leftHandNotice: "左手的適配還沒評過，購買前請先確認每支滑鼠的形狀。",
  othersHeading: "其他推薦",
  othersCaption: "點選任一款，會看到同樣版面的結果頁。",
  variantsLine: (models) => `相同構型：${models.join("、")}`,
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
      lt50: "50 g 以下",
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
    othersHeading: "其他符合條件的推薦",
    excludedHidden: (n) => `篩選中，未列入比較的 ${n} 款不會列出。`,
    analysisLine: (name) => `AI 分析是針對總排名第 1 的 ${name}`,
    analysisShow: "看分析",
    analysisHide: "收起分析",
    shareOverall: "分享總排名第 1 名",
    shareNote: "篩選中，分享圖仍放總排名第 1 名",
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
  purchaseHeading: "Where to buy",
  purchaseNote: "Partner shop links · open in a new tab",
  opensInNewTab: "(opens in a new tab)",
  detailsTitle: "Details",
  detailsHint: "Six scores, gaps to your ideal size, full analysis",
  detailsHintWithViewer:
    "3D view, six scores, gaps to your ideal size, full analysis",
  scoresHeading: "How it scores",
  sizeNotice:
    "Some shape scores aren't rated yet for this mouse, so the fit score currently leans on its size.",
  fitNotice: "None of these fits your hand well. The closest is below.",
  enteredLengthNotice: (mm) =>
    `Based on the hand length you entered (${mm}${NBSP}mm). Measured without paper.`,
  leftHandNotice:
    "Left-hand fit isn't rated yet — check each mouse's shape before you buy.",
  othersHeading: "Other picks",
  othersCaption: "Tap any pick to see a results page with the same layout.",
  variantsLine: (models) => `Same modeling: ${models.join(", ")}`,
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
};

export const RESULTS_PAGE_COPY: Record<UiLanguage, ResultsPageCopy> = {
  "zh-TW": zhTW,
  en,
};
