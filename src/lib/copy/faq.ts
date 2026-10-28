/**
 * Words of the FAQ page (`/faq`, SEO/GEO task 2026-10-28), zh-TW and English,
 * same keys. Every string is a CANDIDATE (未拍板) until Kirby has read it;
 * Claude's wording. Each answer repeats something a public page already says
 * (how it works, /learn, the manual-entry sheet, the privacy notice, the
 * terms); nothing here is a new product claim.
 *
 * No number is written by hand: the answers that carry one are functions, and
 * the page passes values computed in TypeScript (the engine's coefficients and
 * the listed catalogue), so a coefficient change or a reseed updates the text.
 * Each answer is one self-contained paragraph, so a search or AI engine can
 * quote it alone.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface FaqItem {
  q: string;
  a: string;
}

export interface FaqCopy {
  title: string;
  lead: string;
  description: string;
  groups: {
    basics: string;
    measuring: string;
    results: string;
    privacy: string;
  };
  whatIs: FaqItem;
  needs: FaqItem;
  whyA4: FaqItem;
  accuracy: FaqItem;
  manual: FaqItem;
  howToMeasure: FaqItem;
  grips: FaqItem;
  /** Arguments: the palm, claw and fingertip length factor, as percentages. */
  gripChangesSize: {
    q: string;
    a: (palm: string, claw: string, fingertip: string) => string;
  };
  /** Arguments: the six weights as percentages, in the engine's order. */
  scoring: {
    q: string;
    a: (
      length: string,
      gripWidth: string,
      heightHump: string,
      frontFlare: string,
      thumb: string,
      weight: string,
    ) => string;
  };
  /** Arguments: the number of listed mice and of brands. */
  catalogue: { q: string; a: (mice: string, brands: string) => string };
  /** The same answer when the catalogue cannot be read (no numbers). */
  catalogueNoCount: string;
  photos: FaqItem;
  account: FaqItem;
  brands: FaqItem;
  sizeGuideLink: string;
  learnLink: string;
  scanButton: string;
}

export const zhTW: FaqCopy = {
  title: "常見問題",
  lead: "關於量手、握法、分數與隱私，最常被問到的問題。",
  description:
    "Palmate 常見問題：需要準備什麼、照片會不會上傳、A4 紙怎麼當尺、量得準不準、握法如何影響滑鼠大小、分數怎麼算。",
  groups: {
    basics: "開始之前",
    measuring: "量手",
    results: "握法與分數",
    privacy: "隱私與資料",
  },
  whatIs: {
    q: "Palmate 是什麼？",
    a: "Palmate 是依手型挑選電競滑鼠的免費線上工具。用手機和一張空白 A4 紙量出手的尺寸，再把收錄的每支滑鼠和你的手比對、排序，並說明原因，作為選購參考。",
  },
  needs: {
    q: "需要準備什麼？",
    a: "一支有相機的手機，和一張空白 A4 紙，不用列印。把紙放在顏色較深的桌面上，手掌攤平放在紙上，手機在正上方拍照。從頭到尾大約一分鐘，不需要註冊。",
  },
  whyA4: {
    q: "為什麼要用 A4 紙？",
    a: "A4 紙的大小是固定的，它就是照片裡的尺。程式找到紙的四個角之後，就能把照片換算成公釐，算出手長與掌寬。所以四個角都要入鏡，紙也要平整。",
  },
  accuracy: {
    q: "量出來的數字準嗎？",
    a: "所有測量與排名都是估算值，僅供參考。手掌攤平、手指併攏、手機在紙的正上方、四個角都清楚入鏡時最準。結果看起來不對時，可以重拍一次比較。",
  },
  manual: {
    q: "沒辦法掃描，可以自己輸入手的尺寸嗎？",
    a: "可以。在掃描畫面選「改用輸入數字」，輸入手長與手寬（公分），再選擇你的握法即可。掌長會用平均比例估算。",
  },
  howToMeasure: {
    q: "手長和手寬要怎麼量？",
    a: "手長：從手腕橫紋量到中指指尖。手寬：量四指根部關節處，也就是手掌最寬的地方。請量你握滑鼠的那隻手。",
  },
  grips: {
    q: "趴握、抓握、指握有什麼不同？",
    a: "趴握是整個手掌貼在滑鼠上；抓握是手掌碰到滑鼠後方、手指拱起；指握是僅用指尖操控滑鼠。握法會影響適合的形狀與大小。",
  },
  gripChangesSize: {
    q: "握法會改變適合的滑鼠大小嗎？",
    a: (palm, claw, fingertip) =>
      `會。Palmate 用手長乘上一個比例，當作理想的滑鼠長度：趴握約為手長的 ${palm}，抓握約 ${claw}，指握約 ${fingertip}。所以同一隻手，趴握適合較長的滑鼠，指握適合較短的。這些比例是暫定值，還會依使用回饋調整。`,
  },
  scoring: {
    q: "合手分數是怎麼算的？",
    a: (length, gripWidth, heightHump, frontFlare, thumb, weight) =>
      `每支滑鼠會在六個項目上和你的手比對：長度（${length}）、握寬（${gripWidth}）、高度與駝峰（${heightHump}）、前端寬度（${frontFlare}）、拇指托（${thumb}）和重量（${weight}）。括號裡是各項目的權重，長度影響最大；重量只有在你填了偏好時才會計入。`,
  },
  catalogue: {
    q: "收錄了哪些滑鼠？",
    a: (mice, brands) =>
      `目前收錄 ${brands} 個品牌、${mice} 支現正販售的電競滑鼠，規格來自公開資料與官方網站。垂直滑鼠和軌跡球暫時不列入。`,
  },
  catalogueNoCount:
    "收錄的是現正販售的電競滑鼠，規格來自公開資料與官方網站。垂直滑鼠和軌跡球暫時不列入。",
  photos: {
    q: "手的照片會上傳嗎？",
    a: "不會。照片在你的手機瀏覽器裡分析，從不上傳；只有測量數值（例如手長、掌寬）會送到伺服器，用來替滑鼠排序。",
  },
  account: {
    q: "需要註冊嗎？資料會保存多久？",
    a: "不需要，掃描和排名不用帳號就能用。沒有帳號的掃描會在 24 小時內刪除；用 Google 登入後結果會保留，帳號 90 天沒有使用會連同所有掃描一起刪除。",
  },
  brands: {
    q: "Palmate 和滑鼠品牌有合作嗎？",
    a: "沒有。Palmate 與任何品牌都沒有隸屬關係，提到品牌與型號只是為了描述產品。規格以原廠資訊為準，購買前請再確認。",
  },
  sizeGuideLink: "手長與滑鼠尺寸對照表",
  learnLink: "如何挑選最合手的滑鼠",
  scanButton: "掃描我的手",
};

export const en: FaqCopy = {
  title: "Frequently asked questions",
  lead: "The questions we hear most about measuring, grips, scores and privacy.",
  description:
    "Palmate FAQ: what you need, whether the photo is uploaded, how a sheet of A4 works as a ruler, how accurate it is, how your grip changes mouse size, and how the score is made.",
  groups: {
    basics: "Before you start",
    measuring: "Measuring",
    results: "Grips and scores",
    privacy: "Privacy and data",
  },
  whatIs: {
    q: "What is Palmate?",
    a: "Palmate is a free online tool for choosing a gaming mouse by hand size. You measure your hand with a phone and a blank sheet of A4, and every mouse we list is compared with your hand, ranked, and explained, as a reference for buying.",
  },
  needs: {
    q: "What do I need?",
    a: "A phone with a camera and one blank sheet of A4. No printing. Put the sheet on a darker table, lay your hand flat on it and hold the phone straight above. It takes about a minute, with no sign-up.",
  },
  whyA4: {
    q: "Why a sheet of A4?",
    a: "A sheet of A4 always has the same size, so it is the ruler in the photo. Once the four corners are found, the photo can be turned into millimetres to get your hand length and palm width. Keep all four corners in view and the sheet flat.",
  },
  accuracy: {
    q: "How accurate are the measurements?",
    a: "Every measurement and ranking is an estimate, for reference only. It is most accurate with your hand flat, fingers together, the phone straight above the sheet and all four corners clearly in view. If a result looks off, scan again and compare.",
  },
  manual: {
    q: "Can I type my hand size instead of scanning?",
    a: "Yes. On the scan screen choose to enter numbers, type your hand length and hand width in centimetres, then pick your grip. Palm length is then estimated from an average ratio.",
  },
  howToMeasure: {
    q: "How do I measure hand length and width?",
    a: "Hand length: from the crease at your wrist to the tip of your middle finger. Hand width: across the knuckles at the base of your four fingers, the widest part of the palm. Measure the hand you use the mouse with.",
  },
  grips: {
    q: "What is the difference between palm, claw and fingertip grip?",
    a: "Palm grip: your whole palm rests on the mouse. Claw grip: your palm touches the back and your fingers arch. Fingertip grip: only your fingertips control the mouse. Your grip changes which shapes and sizes suit you.",
  },
  gripChangesSize: {
    q: "Does my grip change the right mouse size?",
    a: (palm, claw, fingertip) =>
      `Yes. Palmate takes a share of your hand length as the ideal mouse length: about ${palm} for a palm grip, ${claw} for claw and ${fingertip} for fingertip. So the same hand suits a longer mouse in a palm grip than in a fingertip grip. These ratios are provisional and will be tuned from user feedback.`,
  },
  scoring: {
    q: "How is the fit score made?",
    a: (length, gripWidth, heightHump, frontFlare, thumb, weight) =>
      `Each mouse is compared with your hand on six parts: length (${length}), grip width (${gripWidth}), height and hump (${heightHump}), front width (${frontFlare}), thumb rest (${thumb}) and weight (${weight}). The figures are each part's weight; length counts most, and weight only counts when you give a preference.`,
  },
  catalogue: {
    q: "Which mice are included?",
    a: (mice, brands) =>
      `${mice} gaming mice currently on sale, from ${brands} brands, with specifications from public data and official sites. Vertical mice and trackballs are left out for now.`,
  },
  catalogueNoCount:
    "Gaming mice currently on sale, with specifications from public data and official sites. Vertical mice and trackballs are left out for now.",
  photos: {
    q: "Is the photo of my hand uploaded?",
    a: "No. The photo is analysed in your phone's browser and never uploaded; only the measurements, such as hand length and palm width, reach our server to rank the mice.",
  },
  account: {
    q: "Do I need an account? How long is my data kept?",
    a: "No, scanning and the rankings work without an account. Scans without an account are deleted within 24 hours; sign in with Google to keep your results, and an account unused for 90 days is deleted with all its scans.",
  },
  brands: {
    q: "Is Palmate affiliated with any mouse brand?",
    a: "No. Palmate is not affiliated with any brand and names brands and models only to describe the products. Check the maker's information before you buy.",
  },
  sizeGuideLink: "Hand size to mouse size chart",
  learnLink: "How to choose a mouse that fits",
  scanButton: "Scan my hand",
};

export function faqCopy(locale: Locale): FaqCopy {
  return pickCopy(locale, { zhTW, en });
}
