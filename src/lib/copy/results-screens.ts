/**
 * Words on the results screens that `results-page.ts` does not cover: the
 * loading, not-found, rate-limited, error and deleted screens of
 * `/results/[scanId]`, the written-analysis card, the delete-this-scan dialog,
 * the sub-score names and bars, the gaps table, the confidence note, the 3D
 * viewer's lines, and the page titles. The English strings are moved verbatim
 * from the components.
 *
 * Every zh-TW string here is a CANDIDATE (未拍板), Claude's Taiwan wording
 * (滑鼠, 掃描, 合手度), until Kirby has read it. Numbers are never written here:
 * they arrive formatted, as arguments of the functions.
 */
import type { Subscore } from "../contracts/fit";
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

/** One error screen: a heading and one sentence. */
export interface ResultsErrorScreen {
  title: string;
  body: string;
}

export interface ResultsScreensCopy {
  /** Page titles (`<title>`, before the site name). */
  titleMain: string;
  titleDetail: string;
  /** `<meta name="description">` of the results routes. */
  metaDescription: string;
  /** Text of the step label in the journey top bar. */
  stepLabel: string;
  /** The journey top bar's back link, and the error screens' action. */
  scanAgain: string;
  loading: string;
  /** Small label above an error screen's heading. */
  eyebrow: string;
  notFound: ResultsErrorScreen;
  rateLimited: ResultsErrorScreen;
  networkError: ResultsErrorScreen;
  serverError: ResultsErrorScreen;
  tryAgain: string;
  deleted: ResultsErrorScreen;
  analysis: {
    eyebrow: string;
    preparing: string;
    rateLimited: string;
    error: string;
    retry: string;
    heading: string;
    tradeoffs: string;
    whatToAvoid: string;
    /** Shown under text written from the scores by a template. */
    provenance: string;
  };
  deleteScan: {
    trigger: string;
    title: string;
    body: string;
    error: string;
    cancel: string;
    confirm: string;
    deleting: string;
  };
  /** The full sub-score names (the bars), not the short ones in the reasons. */
  subscoreLabel: Record<Subscore, string>;
  /** A sub-score with no value: never shown as 0. */
  notAssessed: string;
  /** A mouse whose weight the catalogue does not list. */
  weightNotListed: string;
  /** Replaces a missing score's number. */
  noScoreMark: string;
  targetDeltas: {
    caption: string;
    dimension: string;
    ideal: string;
    thisMouse: string;
    diff: string;
    rowLength: string;
    rowGripWidth: string;
    rowHeight: string;
  };
  confidenceNote: string;
  viewer: {
    caption: string;
    fallback: string;
    label: (mouseName: string) => string;
  };
}

export const zhTW: ResultsScreensCopy = {
  titleMain: "你的結果",
  titleDetail: "其他推薦",
  metaDescription: "你的滑鼠推薦排名與文字分析。",
  stepLabel: "你的推薦結果",
  scanAgain: "重新掃描",
  loading: "正在載入你的結果…",
  eyebrow: "結果",
  notFound: {
    title: "找不到這次掃描",
    body: "可能已經過期，或這個連結不是你的。沒有登入帳號的掃描會自動過期。",
  },
  rateLimited: {
    title: "短時間內嘗試太多次",
    body: "請等幾分鐘再試。",
  },
  networkError: {
    title: "無法連上伺服器",
    body: "請檢查網路連線後再試一次。",
  },
  serverError: {
    title: "出了點問題",
    body: "無法載入你的結果，請再試一次。",
  },
  tryAgain: "再試一次",
  deleted: {
    title: "這次掃描已刪除",
    body: "你的測量資料已永久移除。",
  },
  analysis: {
    eyebrow: "文字分析",
    preparing: "正在準備你的文字分析…",
    rateLimited:
      "目前請求太多，暫時無法準備文字分析。上方的排名與各項分數不受影響，請幾分鐘後再試。",
    error: "目前無法準備文字分析。上方的排名與各項分數不受影響。",
    retry: "再試一次",
    heading: "為什麼推薦這支",
    tradeoffs: "取捨",
    whatToAvoid: "要避開的",
    provenance: "依上方的分數自動產生。",
  },
  deleteScan: {
    trigger: "立即刪除這次掃描",
    title: "要立即刪除這次掃描嗎？",
    body: "這會永久刪除這次掃描和它的測量資料，無法復原。",
    error: "無法刪除，請檢查網路連線後再試一次。",
    cancel: "取消",
    confirm: "刪除掃描",
    deleting: "刪除中…",
  },
  subscoreLabel: {
    length: "長度",
    gripWidth: "握寬",
    heightHump: "高度與背弧",
    frontFlare: "前端外擴",
    thumb: "拇指支撐",
    weight: "重量",
  },
  notAssessed: "尚未評估",
  weightNotListed: "未列出重量",
  noScoreMark: "—",
  targetDeltas: {
    caption: "你的理想尺寸與這支滑鼠的比較（mm）",
    dimension: "項目",
    ideal: "你的理想值",
    thisMouse: "這支滑鼠",
    diff: "差距",
    rowLength: "長度",
    rowGripWidth: "握寬",
    rowHeight: "高度",
  },
  confidenceNote:
    "我們還沒評估這支滑鼠的形狀，隨著我們更了解它的形狀，排名可能會改變。",
  viewer: {
    caption: "這是尺寸示意，不是接觸模擬。手的大小依你量到的手長與掌寬縮放。",
    fallback: "這支滑鼠暫時沒有 3D 預覽。",
    label: (mouseName) =>
      `${mouseName} 的 3D 檢視，手部模型已依你量到的手長縮放`,
  },
};

export const en: ResultsScreensCopy = {
  titleMain: "Your results",
  titleDetail: "Other picks",
  metaDescription: "Your ranked mouse recommendations and written analysis.",
  stepLabel: "Your matches",
  scanAgain: "Scan again",
  loading: "Loading your results…",
  eyebrow: "Results",
  notFound: {
    title: "We couldn't find this scan",
    body: "It may have expired, or the link isn't yours. Scans without an account expire automatically.",
  },
  rateLimited: {
    title: "Too many tries in a short time",
    body: "Wait a few minutes, then try again.",
  },
  networkError: {
    title: "We couldn't reach the server",
    body: "Check your connection and try again.",
  },
  serverError: {
    title: "Something went wrong",
    body: "We couldn't load your results. Try again.",
  },
  tryAgain: "Try again",
  deleted: {
    title: "This scan has been deleted",
    body: "Its measurements have been permanently removed.",
  },
  analysis: {
    eyebrow: "Written analysis",
    preparing: "Preparing your written analysis…",
    rateLimited:
      "Too many requests right now, so we couldn't prepare the written analysis. Your ranked results and sub-scores above are unaffected — try again in a few minutes.",
    error:
      "We couldn't prepare the written analysis right now. Your ranked results and sub-scores above are unaffected.",
    retry: "Try again",
    heading: "Why this one",
    tradeoffs: "Tradeoffs",
    whatToAvoid: "What to avoid",
    provenance: "Generated automatically from your scores above.",
  },
  deleteScan: {
    trigger: "Delete this scan now",
    title: "Delete this scan now?",
    body: "This permanently deletes this scan and its measurements. This can't be undone.",
    error: "Couldn't delete — check your connection and try again.",
    cancel: "Cancel",
    confirm: "Delete scan",
    deleting: "Deleting…",
  },
  subscoreLabel: {
    length: "Length",
    gripWidth: "Grip width",
    heightHump: "Height & hump",
    frontFlare: "Front flare",
    thumb: "Thumb support",
    weight: "Weight",
  },
  notAssessed: "Not yet assessed",
  weightNotListed: "Weight not listed",
  noScoreMark: "—",
  targetDeltas: {
    caption: "Your ideal mouse vs. this mouse (mm)",
    dimension: "Dimension",
    ideal: "Your ideal",
    thisMouse: "This mouse",
    diff: "Diff.",
    rowLength: "Length",
    rowGripWidth: "Grip width",
    rowHeight: "Height",
  },
  confidenceNote:
    "We haven't assessed this mouse's shape yet. This ranking may change as we learn more about its shape.",
  viewer: {
    caption:
      "Size illustration, not a contact simulation. The hand is scaled to your measured hand length and palm width.",
    fallback: "3D preview isn't available for this mouse.",
    label: (mouseName) =>
      `3D view of the ${mouseName}, with a hand model scaled to your measured hand length`,
  },
};

export function resultsScreensCopy(locale: Locale): ResultsScreensCopy {
  return pickCopy(locale, { zhTW, en });
}
