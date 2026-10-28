/**
 * Words of the guides (`/guides` and its articles, SEO/GEO task 2026-10-28),
 * zh-TW and English, same keys. Every string is a CANDIDATE (未拍板) until
 * Kirby has read it; Claude's wording.
 *
 * Every number is an argument: the size chart comes from the engine's
 * `LENGTH_FACTOR`, the size classes from `SIZE_RULE`, and the catalogue
 * figures from the listed catalogue, all computed in TypeScript (hard rule 2).
 * The grip and shape descriptions repeat /learn's.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface GuidesCopy {
  index: {
    title: string;
    description: string;
    lead: string;
  };
  /** Shown on the index card of each guide, and as its own lead. */
  size: {
    title: string;
    description: string;
    lead: string;
    measureHeading: string;
    measureLength: string;
    measureWidth: string;
    chartHeading: string;
    /** Arguments: the palm, claw and fingertip factor as percentages. */
    chartIntro: (palm: string, claw: string, fingertip: string) => string;
    handLength: string;
    palm: string;
    claw: string;
    fingertip: string;
    chartCaption: string;
    widthHeading: string;
    /** Argument: the grip-width factor as a percentage. */
    widthBody: (factor: string) => string;
    classesHeading: string;
    /** Arguments: the width weight, the pivot width, the small and medium limits. */
    classesBody: (
      weight: string,
      pivot: string,
      small: string,
      medium: string,
    ) => string;
    /** One line per class: label, number of listed mice, median length. */
    classLine: (label: string, count: string, medianLength: string) => string;
    provisional: string;
    nextHeading: string;
    nextBody: string;
  };
  shape: {
    title: string;
    description: string;
    lead: string;
    symmetricalHeading: string;
    symmetricalBody: string;
    ergonomicHeading: string;
    ergonomicBody: string;
    gripHeading: string;
    gripBody: string;
    numbersHeading: string;
    /** One line per shape: label, count, median length, width, height. */
    numbersLine: (
      label: string,
      count: string,
      length: string,
      width: string,
      height: string,
    ) => string;
    /** Median weight of the shape's mice with a weight. */
    numbersWeight: (label: string, weight: string) => string;
    lightestHeading: (label: string) => string;
    nextBody: string;
  };
  readMore: string;
  faqLink: string;
  compareLink: string;
  scanButton: string;
  updated: string;
}

export const zhTW: GuidesCopy = {
  index: {
    title: "選購指南",
    description:
      "電競滑鼠選購指南：手長與滑鼠尺寸對照表、對稱型與人體工學滑鼠的差別，數字直接來自 Palmate 收錄的滑鼠規格。",
    lead: "挑滑鼠前值得先知道的事，數字都由收錄的規格算出。",
  },
  size: {
    title: "手長與滑鼠尺寸對照表：你的手適合多大的滑鼠？",
    description:
      "依手長與握法（趴握、抓握、指握）查出理想的滑鼠長度，並說明怎麼量手、小中大型鼠怎麼分。",
    lead: "滑鼠合不合手，第一個看的是長度。先量手長，再依你的握法查表。",
    measureHeading: "先量你的手",
    measureLength: "手長：從手腕橫紋量到中指指尖。",
    measureWidth: "手寬：量四指根部關節處，手掌最寬的地方。",
    chartHeading: "手長對照表",
    chartIntro: (palm, claw, fingertip) =>
      `Palmate 用手長乘上一個比例，當作理想的滑鼠長度：趴握 ${palm}、抓握 ${claw}、指握 ${fingertip}。整只手都貼著滑鼠的趴握需要最長的滑鼠，只用指尖的指握最短。`,
    handLength: "手長",
    palm: "趴握",
    claw: "抓握",
    fingertip: "指握",
    chartCaption: "理想滑鼠長度（mm），依手長與握法",
    widthHeading: "寬度也要看",
    widthBody: (factor) =>
      `長度之外，握寬是第二重要的項目。Palmate 以手寬的 ${factor} 當作理想的握寬，太寬的滑鼠握起來會撐開手，太窄則不好施力。`,
    classesHeading: "小型、中型、大型鼠怎麼分？",
    classesBody: (weight, pivot, small, medium) =>
      `Palmate 依長度與寬度計算尺寸：以長度為主，寬度每比 ${pivot} mm 寬 1 mm 就加 ${weight} mm，每窄 1 mm 就減 ${weight} mm。結果小於 ${small} 是小型鼠，${small} 到 ${medium} 是中型鼠，超過 ${medium} 是大型鼠。`,
    classLine: (label, count, medianLength) =>
      `${label}：收錄 ${count} 支，長度中位數 ${medianLength} mm。`,
    provisional:
      "這些比例是暫定值，還會依使用回饋調整；表格會跟著程式裡的數字自動更新。",
    nextHeading: "查表之後",
    nextBody:
      "長度只是六個比對項目之一。掃描你的手，Palmate 會把握寬、高度與駝峰、前端寬度、拇指托和重量一起算進去，替每支滑鼠排序。",
  },
  shape: {
    title: "對稱型 vs 人體工學滑鼠：哪一種適合你？",
    description:
      "左右對稱與人體工學（單手造型）滑鼠的差別、和握法的關係，以及 Palmate 收錄的兩種滑鼠尺寸與重量中位數。",
    lead: "外殼的形狀決定手怎麼貼在滑鼠上。先認識兩種造型，再看數字。",
    symmetricalHeading: "左右對稱",
    symmetricalBody:
      "左右兩側鏡像相同，最高點通常在中間。手的位置比較自由，趴握、抓握、指握都有人用。",
    ergonomicHeading: "人體工學",
    ergonomicBody:
      "為單手設計的造型，常見拇指那一側外凸成拇指托、另一側較直，最高點也可能偏後，讓整個手掌靠上去。",
    gripHeading: "和握法的關係",
    gripBody:
      "趴握時整個手掌貼在滑鼠上，拇指托與駝峰位置影響最大，Palmate 會為趴握考慮有沒有拇指托；抓握和指握接觸外殼的面積較小。",
    numbersHeading: "收錄滑鼠的數字",
    numbersLine: (label, count, length, width, height) =>
      `${label}：${count} 支，長度中位數 ${length} mm、寬 ${width} mm、高 ${height} mm。`,
    numbersWeight: (label, weight) => `${label}重量中位數 ${weight} g。`,
    lightestHeading: (label) => `最輕的${label}滑鼠`,
    nextBody:
      "形狀沒有好壞，只有合不合手。掃描你的手，Palmate 會依你的手與握法，為每支滑鼠的形狀與尺寸評分。",
  },
  readMore: "閱讀",
  faqLink: "常見問題",
  compareLink: "熱門滑鼠比較",
  scanButton: "掃描我的手",
  updated: "更新日期",
};

export const en: GuidesCopy = {
  index: {
    title: "Buying guides",
    description:
      "Gaming mouse buying guides: a mouse size chart by hand length, and symmetrical versus ergonomic mice, with figures taken straight from the mice Palmate lists.",
    lead: "What is worth knowing before you pick a mouse, with every figure computed from the specifications we list.",
  },
  size: {
    title: "Mouse size chart by hand length: what size mouse fits your hand?",
    description:
      "Find the ideal mouse length for your hand length and grip (palm, claw or fingertip), how to measure your hand, and how small, medium and large mice are told apart.",
    lead: "The first thing that decides whether a mouse fits is its length. Measure your hand, then look up your grip.",
    measureHeading: "Measure your hand first",
    measureLength:
      "Hand length: from the crease at your wrist to the tip of your middle finger.",
    measureWidth:
      "Hand width: across the knuckles at the base of your four fingers, the widest part of the palm.",
    chartHeading: "Hand length chart",
    chartIntro: (palm, claw, fingertip) =>
      `Palmate takes a share of your hand length as the ideal mouse length: ${palm} for a palm grip, ${claw} for claw and ${fingertip} for fingertip. A palm grip, with the whole hand on the mouse, needs the longest mouse; a fingertip grip the shortest.`,
    handLength: "Hand length",
    palm: "Palm",
    claw: "Claw",
    fingertip: "Fingertip",
    chartCaption: "Ideal mouse length (mm) by hand length and grip",
    widthHeading: "Width matters too",
    widthBody: (factor) =>
      `After length, grip width is the next most important part. Palmate takes ${factor} of your hand width as the ideal grip width: too wide spreads the hand, too narrow leaves less to push against.`,
    classesHeading: "How are small, medium and large mice told apart?",
    classesBody: (weight, pivot, small, medium) =>
      `Palmate computes size from length and width: length first, plus ${weight} mm for every millimetre of width above ${pivot} mm, minus as much for every millimetre below. A result below ${small} is a small mouse, ${small} to ${medium} medium, and above ${medium} large.`,
    classLine: (label, count, medianLength) =>
      `${label}: ${count} mice listed, median length ${medianLength} mm.`,
    provisional:
      "These ratios are provisional and will be tuned from user feedback; the chart follows the numbers in the code automatically.",
    nextHeading: "After the chart",
    nextBody:
      "Length is one of six parts we compare. Scan your hand and Palmate adds grip width, height and hump, front width, thumb rest and weight, and ranks every mouse.",
  },
  shape: {
    title: "Symmetrical vs ergonomic mice: which one suits you?",
    description:
      "How symmetrical and ergonomic (one-handed) mice differ, how that relates to your grip, and the median size and weight of each among the mice Palmate lists.",
    lead: "The shell's shape decides how your hand rests on the mouse. Know the two shapes, then look at the numbers.",
    symmetricalHeading: "Symmetrical",
    symmetricalBody:
      "Both sides mirror each other and the highest point is usually in the middle. It leaves the hand free to sit where it likes; people use it in palm, claw and fingertip grips.",
    ergonomicHeading: "Ergonomic",
    ergonomicBody:
      "Shaped for one hand: often a thumb rest bulges out on the thumb side while the other side is straighter, and the highest point may sit further back so the whole palm can lean on it.",
    gripHeading: "How it relates to your grip",
    gripBody:
      "In a palm grip your whole palm rests on the mouse, so the thumb rest and the hump matter most, and Palmate checks for a thumb rest in a palm grip. Claw and fingertip grips touch less of the shell.",
    numbersHeading: "The numbers in our catalogue",
    numbersLine: (label, count, length, width, height) =>
      `${label}: ${count} mice, median length ${length} mm, width ${width} mm, height ${height} mm.`,
    numbersWeight: (label, weight) => `${label}: median weight ${weight} g.`,
    lightestHeading: (label) => `The lightest ${label.toLowerCase()} mice`,
    nextBody:
      "No shape is better than the other, only a better fit. Scan your hand and Palmate scores every mouse's shape and size for your hand and grip.",
  },
  readMore: "Read",
  faqLink: "FAQ",
  compareLink: "Popular mouse comparisons",
  scanButton: "Scan my hand",
  updated: "Updated",
};

export function guidesCopy(locale: Locale): GuidesCopy {
  return pickCopy(locale, { zhTW, en });
}
