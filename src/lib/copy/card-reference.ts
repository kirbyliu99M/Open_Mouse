/**
 * Words of the easy scan's card reference (v3.4, 2026-11-05), zh-TW and
 * English, same keys. Only shown while `CARD_REFERENCE_ENABLED`.
 *
 * Every zh-TW string is a CANDIDATE (未拍板), Claude's Taiwan wording ported
 * from the scan lab's G-M2 v3 lines (`src/client/lab/hand/gm2Rules.ts`,
 * `guideCopy.ts`) and shortened for the 320 px cue bar, until Kirby has read
 * it. No medical wording. The card asked for: light or glossy, standard
 * size, back side up, not a business card; never the side with a name or
 * number on it.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface CardReferenceCopy {
  /** The reference chip's label in card mode. */
  chip: string;
  /** The reference chip's accessible name (any mode). */
  chipAccessibleName: (current: string) => string;
  /** The chip's menu (Pencil card-reference-menu, review items 5+6). */
  menuTitle: string;
  menuA4: string;
  menuA4Detail: string;
  menuLetter: string;
  menuLetterDetail: string;
  menuCard: string;
  menuCardDetail: string;
  /** The one line under the viewfinder in card mode: which card and how. */
  cardRule: string;
  /** Overlay labels. */
  handZone: string;
  cardZone: string;
  axis: string;
  wristLine: string;
  /** Live hints, one per G-M2 check (the first problem is shown). */
  hintLoading: string;
  hintNoHand: string;
  hintInFrame: string;
  hintCloser: string;
  hintHigher: string;
  hintWristUp: string;
  hintWristDown: string;
  hintAxis: string;
  hintFingers: string;
  hintTilt: string;
  hintSteady: string;
  hintOk: string;
  /** The outline check after the shot. */
  confirmQuestion: string;
  confirmYes: string;
  confirmNo: string;
  /** Why a card shot was turned back. */
  failNoCard: string;
  failCardClipped: string;
  failCardTooSmall: string;
  failCardEdges: string;
  failCardBlends: string;
  failMeasure: string;
}

export const zhTW: CardReferenceCopy = {
  chip: "卡片",
  chipAccessibleName: (current) => `參考物：${current}（點一下選擇）`,
  menuTitle: "拿什麼對照",
  menuA4: "A4 紙",
  menuA4Detail: "最常見的影印紙",
  menuLetter: "Letter 紙",
  menuLetterDetail: "美規信紙",
  menuCard: "卡片",
  menuCardDetail: "悠遊卡、一卡通大小",
  cardRule:
    "卡片要淺色或亮面、標準大小，背面朝上放在小指那側。不要用名片，也不要露出有名字或號碼的那面。",
  handZone: "手放這裡",
  cardZone: "卡片\n放這裡",
  axis: "中線",
  wristLine: "手腕大約在這附近",
  hintLoading: "準備中…",
  hintNoHand: "手背朝上，平放進框內，手指朝上",
  hintInFrame: "整隻手放進框內",
  hintCloser: "手機再靠近一點",
  hintHigher: "手機再拿高一點",
  hintWristUp: "手往上移一點",
  hintWristDown: "手往下移一點",
  hintAxis: "手放正，中指對準中線",
  hintFingers: "手指自然放鬆、平貼桌面，不要彎",
  hintTilt: "手機放平",
  hintSteady: "拿穩，不要動",
  hintOk: "就是這樣，保持不動",
  confirmQuestion: "外框有框住你放的那張卡片嗎？",
  confirmYes: "有，框對了",
  confirmNo: "沒有，重拍",
  failNoCard: "找不到卡片。請把卡片背面朝上放在虛線區裡，整張都要入鏡。",
  failCardClipped: "卡片有一部分在畫面外，請整張放進虛線區。",
  failCardTooSmall: "卡片太小了，手機再靠近一點。",
  failCardEdges: "卡片邊緣看不清楚，請拿穩再拍一次。",
  failCardBlends: "卡片和桌面顏色太接近，請換淺色或亮面的卡片，或換個桌面。",
  failMeasure: "這張照片量不出來，請照框線重拍一次。",
};

export const en: CardReferenceCopy = {
  chip: "Card",
  chipAccessibleName: (current) => `Reference: ${current} (tap to choose)`,
  menuTitle: "Measure against",
  menuA4: "A4 paper",
  menuA4Detail: "The usual copy paper",
  menuLetter: "Letter paper",
  menuLetterDetail: "US letter size",
  menuCard: "Card",
  menuCardDetail: "The size of a transit card",
  cardRule:
    "Use a light or glossy standard-size card, back side up, beside your little finger. Not a business card, and never the side with a name or number.",
  handZone: "Hand here",
  cardZone: "Card\nhere",
  axis: "Centre",
  wristLine: "Wrist about here",
  hintLoading: "Getting ready…",
  hintNoHand: "Back of the hand up, flat in the frame, fingers up",
  hintInFrame: "Put your whole hand inside the frame",
  hintCloser: "Bring the phone a little closer",
  hintHigher: "Hold the phone a little higher",
  hintWristUp: "Move your hand up a little",
  hintWristDown: "Move your hand down a little",
  hintAxis: "Straighten your hand, middle finger on the centre line",
  hintFingers: "Relax your fingers flat on the table, not bent",
  hintTilt: "Hold the phone level",
  hintSteady: "Hold still",
  hintOk: "That's it, hold still",
  confirmQuestion: "Does the outline go around the card you placed?",
  confirmYes: "Yes, it does",
  confirmNo: "No, retake",
  failNoCard:
    "We couldn't find the card. Lay it back side up in the dashed area, all of it in view.",
  failCardClipped:
    "Part of the card is out of view. Put all of it in the dashed area.",
  failCardTooSmall: "The card is too small. Bring the phone a little closer.",
  failCardEdges: "The card's edges aren't clear. Hold steady and try again.",
  failCardBlends:
    "The card is too close in colour to the table. Use a light or glossy card, or another surface.",
  failMeasure: "This photo couldn't be measured. Follow the frame and retake.",
};

export function cardReferenceCopy(locale: Locale): CardReferenceCopy {
  return pickCopy(locale, { zhTW, en });
}
