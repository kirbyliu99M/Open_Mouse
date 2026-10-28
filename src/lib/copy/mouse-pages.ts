/**
 * Words of the public mouse pages (`/mice/[slug]`), the comparison pages
 * (`/compare/[pair]`) and the comparison index (`/compare`), zh-TW and
 * English, same keys (SEO task, 2026-10-28). Every string is a CANDIDATE
 * (未拍板) until Kirby has read it; Claude's wording.
 *
 * Templates only: every name and number is an argument, and every number is
 * computed in `src/lib/mice/compare.ts` from the catalogue row or the engine's
 * coefficients (hard rule 2). The sentences state differences in size and
 * nothing a spec sheet does not show: no claim about sensors, feel or quality.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export type DiffKind = "length" | "width" | "height" | "weight";

export interface MousePagesCopy {
  detail: {
    /** `<title>` and h1: the mouse's full name. */
    title: (name: string) => string;
    description: (
      name: string,
      length: string,
      width: string,
      height: string,
      weight: string,
    ) => string;
    /** When the weight is unknown. */
    descriptionNoWeight: (
      name: string,
      length: string,
      width: string,
      height: string,
    ) => string;
    specsHeading: string;
    length: string;
    width: string;
    height: string;
    weight: string;
    size: string;
    shape: string;
    connection: string;
    unknown: string;
    handFitHeading: string;
    handFitBody: (
      name: string,
      palm: string,
      claw: string,
      fingertip: string,
    ) => string;
    provisional: string;
    scanCta: string;
    similarHeading: string;
    similarLead: string;
    compareWith: (name: string) => string;
    officialLink: string;
    photoAlt: (name: string) => string;
    disclaimer: string;
  };
  compare: {
    title: (a: string, b: string) => string;
    description: (a: string, b: string) => string;
    lead: string;
    tableHeading: string;
    spec: string;
    difference: string;
    summaryHeading: string;
    /** `b` is `amount` more or less than `a` in `kind`; `more` is true for longer/wider/taller/heavier. */
    diff: Record<
      DiffKind,
      {
        more: (b: string, a: string, amount: string) => string;
        less: (b: string, a: string, amount: string) => string;
        same: string;
      }
    >;
    sameShape: (shape: string) => string;
    differentShape: (
      a: string,
      shapeA: string,
      b: string,
      shapeB: string,
    ) => string;
    sameSize: (size: string) => string;
    differentSize: (
      a: string,
      sizeA: string,
      b: string,
      sizeB: string,
    ) => string;
    handHeading: string;
    handBody: (
      name: string,
      palm: string,
      claw: string,
      fingertip: string,
    ) => string;
    scanNote: string;
    weightUnknown: string;
  };
  index: {
    title: string;
    description: string;
    lead: string;
    featuredHeading: string;
    howHeading: string;
    howBody: string;
    browseMice: string;
  };
  /** Units after a number. */
  mm: string;
  g: string;
  cm: string;
  vs: string;
}

export const zhTW: MousePagesCopy = {
  detail: {
    title: (name) => `${name} 尺寸規格與適合手型`,
    description: (name, length, width, height, weight) =>
      `${name} 長 ${length} mm、寬 ${width} mm、高 ${height} mm、重 ${weight} g。看它適合多大的手、趴握／抓握／指握的理想手長，以及尺寸相近的滑鼠。`,
    descriptionNoWeight: (name, length, width, height) =>
      `${name} 長 ${length} mm、寬 ${width} mm、高 ${height} mm。看它適合多大的手、趴握／抓握／指握的理想手長，以及尺寸相近的滑鼠。`,
    specsHeading: "規格",
    length: "長度",
    width: "寬度",
    height: "高度",
    weight: "重量",
    size: "尺寸",
    shape: "滑鼠握感",
    connection: "連線方式",
    unknown: "未提供",
    handFitHeading: "適合多大的手？",
    handFitBody: (name, palm, claw, fingertip) =>
      `依 Palmate 目前的長度目標，${name} 最符合手長約 ${palm} 公分的趴握、約 ${claw} 公分的抓握，或約 ${fingertip} 公分的指握。長度只是六個比對項目之一，掃描你的手，就能看到它在所有項目上的分數。`,
    provisional: "這些比例是暫定值，還會依使用回饋調整。",
    scanCta: "掃描我的手",
    similarHeading: "尺寸相近的滑鼠",
    similarLead: "長、寬、高最接近的幾支，點選即可並排比較。",
    compareWith: (name) => `和 ${name} 比較`,
    officialLink: "原廠產品頁",
    photoAlt: (name) => `${name} 產品照片`,
    disclaimer:
      "規格來自公開資料與官方網站，以原廠資訊為準，購買前請再確認。Palmate 與任何品牌都沒有隸屬關係。",
  },
  compare: {
    title: (a, b) => `${a} vs ${b}：尺寸、重量與形狀比較`,
    description: (a, b) =>
      `${a} 和 ${b} 的長、寬、高、重量、形狀與連線方式並排比較，加上各自適合的手長。`,
    lead: "兩支滑鼠的規格並排，差異由規格直接算出。",
    tableHeading: "規格比較",
    spec: "項目",
    difference: "差異",
    summaryHeading: "差在哪裡",
    diff: {
      length: {
        more: (b, a, x) => `${b} 比 ${a} 長 ${x} mm。`,
        less: (b, a, x) => `${b} 比 ${a} 短 ${x} mm。`,
        same: "兩支長度相同。",
      },
      width: {
        more: (b, a, x) => `${b} 比 ${a} 寬 ${x} mm。`,
        less: (b, a, x) => `${b} 比 ${a} 窄 ${x} mm。`,
        same: "兩支寬度相同。",
      },
      height: {
        more: (b, a, x) => `${b} 比 ${a} 高 ${x} mm。`,
        less: (b, a, x) => `${b} 比 ${a} 矮 ${x} mm。`,
        same: "兩支高度相同。",
      },
      weight: {
        more: (b, a, x) => `${b} 比 ${a} 重 ${x} g。`,
        less: (b, a, x) => `${b} 比 ${a} 輕 ${x} g。`,
        same: "兩支重量相同。",
      },
    },
    sameShape: (shape) => `兩支都是${shape}造型。`,
    differentShape: (a, shapeA, b, shapeB) =>
      `${a} 是${shapeA}造型，${b} 是${shapeB}造型。`,
    sameSize: (size) => `兩支都屬於${size}。`,
    differentSize: (a, sizeA, b, sizeB) =>
      `${a} 屬於${sizeA}，${b} 屬於${sizeB}。`,
    handHeading: "各自適合的手長",
    handBody: (name, palm, claw, fingertip) =>
      `${name}：趴握約 ${palm} 公分、抓握約 ${claw} 公分、指握約 ${fingertip} 公分。`,
    scanNote:
      "這裡只比較長度。掃描你的手，Palmate 會把兩支滑鼠在六個項目上和你的手比對。",
    weightUnknown: "其中一支沒有重量資料，無法比較重量。",
  },
  index: {
    title: "電競滑鼠比較",
    description:
      "熱門電競滑鼠的尺寸、重量與形狀並排比較：Superlight 2、Viper V3 Pro、DeathAdder V3 Pro、Zowie EC2 等，並附上各自適合的手長。",
    lead: "熱門對決，規格並排；每支滑鼠的頁面也列出尺寸最接近的對手。",
    featuredHeading: "熱門比較",
    howHeading: "怎麼比較",
    howBody:
      "比較頁只用規格：長、寬、高、重量、形狀與連線方式，再用 Palmate 的長度目標換算出各自適合的手長。想知道哪一支更合你的手，請掃描你的手。",
    browseMice: "瀏覽所有滑鼠",
  },
  mm: "mm",
  g: "g",
  cm: "公分",
  vs: "vs",
};

/** Lower case for a word inside an English sentence ("Symmetrical" → "symmetrical"). */
const lower = (word: string) => String(word).toLowerCase();

export const en: MousePagesCopy = {
  detail: {
    title: (name) => `${name} dimensions and hand size fit`,
    description: (name, length, width, height, weight) =>
      `${name}: ${length} mm long, ${width} mm wide, ${height} mm tall, ${weight} g. See what hand size it suits in a palm, claw or fingertip grip, and mice of a similar size.`,
    descriptionNoWeight: (name, length, width, height) =>
      `${name}: ${length} mm long, ${width} mm wide, ${height} mm tall. See what hand size it suits in a palm, claw or fingertip grip, and mice of a similar size.`,
    specsHeading: "Specifications",
    length: "Length",
    width: "Width",
    height: "Height",
    weight: "Weight",
    size: "Size",
    shape: "Shape",
    connection: "Connection",
    unknown: "Not given",
    handFitHeading: "What hand size does it fit?",
    handFitBody: (name, palm, claw, fingertip) =>
      `By Palmate's current length targets, the ${name} best matches a hand about ${palm} cm long in a palm grip, about ${claw} cm in a claw grip, or about ${fingertip} cm in a fingertip grip. Length is one of six parts we compare; scan your hand to see its score on all of them.`,
    provisional:
      "These ratios are provisional and will be tuned from user feedback.",
    scanCta: "Scan my hand",
    similarHeading: "Mice of a similar size",
    similarLead:
      "The closest in length, width and height. Pick one to compare side by side.",
    compareWith: (name) => `Compare with ${name}`,
    officialLink: "Official product page",
    photoAlt: (name) => `${name} product photo`,
    disclaimer:
      "Specifications come from public data and official sites; the maker's information comes first, so check it before you buy. Palmate is not affiliated with any brand.",
  },
  compare: {
    title: (a, b) => `${a} vs ${b}: size, weight and shape compared`,
    description: (a, b) =>
      `${a} and ${b} side by side: length, width, height, weight, shape and connection, plus the hand size each one suits.`,
    lead: "Two mice side by side; every difference is computed from the specifications.",
    tableHeading: "Specifications",
    spec: "Spec",
    difference: "Difference",
    summaryHeading: "How they differ",
    diff: {
      length: {
        more: (b, a, x) => `The ${b} is ${x} mm longer than the ${a}.`,
        less: (b, a, x) => `The ${b} is ${x} mm shorter than the ${a}.`,
        same: "Both are the same length.",
      },
      width: {
        more: (b, a, x) => `The ${b} is ${x} mm wider than the ${a}.`,
        less: (b, a, x) => `The ${b} is ${x} mm narrower than the ${a}.`,
        same: "Both are the same width.",
      },
      height: {
        more: (b, a, x) => `The ${b} is ${x} mm taller than the ${a}.`,
        less: (b, a, x) => `The ${b} is ${x} mm lower than the ${a}.`,
        same: "Both are the same height.",
      },
      weight: {
        more: (b, a, x) => `The ${b} is ${x} g heavier than the ${a}.`,
        less: (b, a, x) => `The ${b} is ${x} g lighter than the ${a}.`,
        same: "Both weigh the same.",
      },
    },
    sameShape: (shape) => `Both have a ${lower(shape)} shape.`,
    differentShape: (a, shapeA, b, shapeB) =>
      `The ${a} has a ${lower(shapeA)} shape; the ${b} is ${lower(shapeB)}.`,
    sameSize: (size) => `Both are ${lower(size)} mice.`,
    differentSize: (a, sizeA, b, sizeB) =>
      `The ${a} is a ${lower(sizeA)} mouse; the ${b} is ${lower(sizeB)}.`,
    handHeading: "The hand size each one suits",
    handBody: (name, palm, claw, fingertip) =>
      `${name}: about ${palm} cm in a palm grip, ${claw} cm in a claw grip, ${fingertip} cm in a fingertip grip.`,
    scanNote:
      "This compares length only. Scan your hand and Palmate compares both mice with your hand on all six parts.",
    weightUnknown:
      "One of the two has no weight listed, so weight is not compared.",
  },
  index: {
    title: "Gaming mouse comparisons",
    description:
      "Popular gaming mice compared side by side on size, weight and shape: Superlight 2, Viper V3 Pro, DeathAdder V3 Pro, Zowie EC2 and more, with the hand size each one suits.",
    lead: "Popular match-ups, specifications side by side. Every mouse page also lists its closest rivals in size.",
    featuredHeading: "Popular comparisons",
    howHeading: "How we compare",
    howBody:
      "The comparisons use specifications only: length, width, height, weight, shape and connection, and Palmate's length targets turn each length into the hand size it suits. To see which one fits your hand, scan it.",
    browseMice: "Browse all mice",
  },
  mm: "mm",
  g: "g",
  cm: "cm",
  vs: "vs",
};

export function mousePagesCopy(locale: Locale): MousePagesCopy {
  return pickCopy(locale, { zhTW, en });
}
