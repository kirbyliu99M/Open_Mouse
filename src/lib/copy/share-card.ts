/**
 * Words on the share card and its button, zh-TW and English, same keys. Every
 * string here is a CANDIDATE (未拍板) until Kirby has read it.
 *
 * Rules, as for `fit-bands.ts`: no medical or health claim, no comparison with
 * other people, nothing about how accurate an estimate is. The sentence under
 * the hand-type title describes the MOUSE that suits, never the hand. The hand
 * type words are the same ones the results page uses (builder R, candidate).
 */
import type { HandType } from "../contracts/fit";
import type { UiLanguage } from "../../client/uiLanguage";

export interface ShareCardCopy {
  kicker: string;
  /** Hand-type parts. The card joins them with `partSeparator`. */
  size: Record<HandType["size"], string>;
  grip: Record<HandType["grip"], string>;
  width: Record<HandType["width"], string>;
  partSeparator: string;
  /** What kind of mouse suits: length class and grip width, never the hand. */
  sentence: (type: HandType) => string;
  topPickLabel: string;
  scoreLabel: string;
  tagline: string;
  /** Alt/accessible name of the silhouette is not needed: it is drawn on a canvas. */
  buttonLink: string;
  buttonPrimary: string;
  busy: string;
  error: string;
}

const sizeLengthZh: Record<HandType["size"], string> = {
  small: "偏短",
  medium: "中等",
  large: "偏長",
};
const widthGripZh: Record<HandType["width"], string> = {
  slim: "較窄",
  wide: "較寬",
};
const sizeLengthEn: Record<HandType["size"], string> = {
  small: "short",
  medium: "medium",
  large: "long",
};
const widthGripEn: Record<HandType["width"], string> = {
  slim: "narrower",
  wide: "wider",
};

export const zhTW: ShareCardCopy = {
  kicker: "適合我的滑鼠型",
  size: { small: "小型滑鼠", medium: "中型滑鼠", large: "大型滑鼠" },
  grip: { palm: "趴握", claw: "抓握", fingertip: "指握" },
  width: { slim: "窄身", wide: "寬身" },
  partSeparator: "・",
  sentence: (t) =>
    `適合長度${sizeLengthZh[t.size]}、握寬${widthGripZh[t.width]}的滑鼠`,
  topPickLabel: "最適合我的滑鼠",
  scoreLabel: "適配分數",
  tagline: "測測你的手型",
  buttonLink: "分享",
  buttonPrimary: "製作我的分享圖",
  busy: "製作中…",
  error: "分享圖做不出來，請再試一次。",
};

export const en: ShareCardCopy = {
  kicker: "My mouse type",
  size: { small: "Small mouse", medium: "Medium mouse", large: "Large mouse" },
  grip: { palm: "Palm grip", claw: "Claw grip", fingertip: "Fingertip grip" },
  width: { slim: "Slim", wide: "Wide" },
  partSeparator: " · ",
  sentence: (t) =>
    `Suits a mouse of ${sizeLengthEn[t.size]} length and ${widthGripEn[t.width]} grip width.`,
  topPickLabel: "My best-fit mouse",
  scoreLabel: "Fit score",
  tagline: "Find your mouse type",
  buttonLink: "Share",
  buttonPrimary: "Make my share card",
  busy: "Making…",
  error: "Could not make the card. Please try again.",
};

export function shareCardCopy(lang: UiLanguage): ShareCardCopy {
  return lang === "zh-TW" ? zhTW : en;
}

/** The hand-type title: size, grip, width, joined with the language's separator. */
export function handTypeTitle(copy: ShareCardCopy, type: HandType): string {
  return [
    copy.size[type.size],
    copy.grip[type.grip],
    copy.width[type.width],
  ].join(copy.partSeparator);
}
