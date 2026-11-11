/**
 * Search descriptions (`<meta name="description">` and the share cards) of the
 * public pages, zh-TW and English, same keys (SEO task, 2026-10-28). Every
 * string is a CANDIDATE (未拍板) until Kirby has read it; Claude's wording.
 * The home page and /scan/easy keep their own (site-meta.ts, easy-scan.ts).
 * No string carries a number: a count would go stale when the catalogue
 * changes.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface PageMetaCopy {
  mice: string;
  learn: string;
  howItWorks: string;
  privacy: string;
  terms: string;
}

export const zhTW: PageMetaCopy = {
  mice: "瀏覽 Palmate 收錄的每一支電競滑鼠：長、寬、高、重量、形狀與連線方式一次看完，可依品牌、尺寸與重量篩選。",
  learn:
    "挑滑鼠前先看這篇：手長與掌寬、趴握／抓握／指握、手掌厚度、滑鼠尺寸與形狀，各自怎麼影響合不合手。",
  howItWorks:
    "Palmate 怎麼量手：一張空白 A4 紙當尺，手機拍照後在瀏覽器裡分析，照片預設不上傳，大約一分鐘就能看到依你的手排序的滑鼠。",
  privacy:
    "Palmate 收集哪些資料、為什麼收集、保存多久：照片預設不會上傳，只有你自己選擇傳送時才會；掃描只把測量數值送到伺服器，並預設保留一份不記名的數值副本。",
  terms:
    "Palmate 的使用條款：測量與排名僅供參考，不構成醫療或人體工學建議；品牌與商標屬於各自的所有者。",
};

export const en: PageMetaCopy = {
  mice: "Browse every gaming mouse Palmate compares: length, width, height, weight, shape and connection side by side, filterable by brand, size and weight.",
  learn:
    "What to check before you pick a mouse: hand length and palm width, palm, claw or fingertip grip, palm thickness, and the mouse's size and shape.",
  howItWorks:
    "How Palmate measures your hand: a blank sheet of A4 is the ruler, the photo is analysed in your browser and is not uploaded by default, and in about a minute you see mice ranked for your hand.",
  privacy:
    "What Palmate collects, why, and for how long: by default photos are not uploaded, only if you choose to send one; a scan sends only the measurements, and by default an unnamed copy of them is kept.",
  terms:
    "Palmate's terms of use: measurements and rankings are estimates for reference, not medical or ergonomic advice; brand names belong to their owners.",
};

export function pageMetaCopy(locale: Locale): PageMetaCopy {
  return pickCopy(locale, { zhTW, en });
}
