/**
 * The sentence for each reason code on the results page (the six sub-score
 * bars), zh-TW and English, same keys. The English is moved verbatim from the
 * old `reasons.ts`. Every zh-TW sentence is a CANDIDATE (未拍板), Claude's
 * wording.
 *
 * The fit engine decides WHY a sub-score is what it is; a template only puts
 * the engine's numbers into a sentence. The caller formats the numbers
 * (`formatMm`, whole grams) and passes them as text, so no template does
 * arithmetic (hard rule 2). A `null` amount means the engine sent none: the
 * template then says the same thing without a number.
 */
import type { ReasonCode } from "../contracts/fit";
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

/** The numbers of one reason, already formatted ("3.2 mm", "13 g"), or null. */
export interface ReasonAmounts {
  /** A gap in mm, as a magnitude. */
  delta: string | null;
  /** The weight range as "min–max g" (in range only). */
  range: string | null;
  /** A weight gap in grams, as a magnitude. */
  deltaG: string | null;
}

export type ReasonTemplate = (amounts: ReasonAmounts) => string;
export type ReasonsCopy = Record<ReasonCode, ReasonTemplate>;

export const zhTW: ReasonsCopy = {
  length_ideal: (a) =>
    a.delta
      ? `長度與你的理想值相差不到 ${a.delta}，已經非常接近。`
      : "長度與你的理想值很接近。",
  length_short: (a) =>
    a.delta
      ? `這支滑鼠比你的理想長度短 ${a.delta}。`
      : "這支滑鼠比你的理想長度短。",
  length_long: (a) =>
    a.delta
      ? `這支滑鼠比你的理想長度長 ${a.delta}。`
      : "這支滑鼠比你的理想長度長。",
  width_ideal: (a) =>
    a.delta
      ? `握寬與你的理想值相差不到 ${a.delta}，相當吻合。`
      : "握寬與你的手相當吻合。",
  width_narrow: (a) =>
    a.delta
      ? `這支滑鼠比你的理想握寬窄 ${a.delta}。`
      : "這支滑鼠比你的理想握寬窄。",
  width_wide: (a) =>
    a.delta
      ? `這支滑鼠比你的理想握寬寬 ${a.delta}。`
      : "這支滑鼠比你的理想握寬寬。",
  height_low: (a) =>
    a.delta
      ? `這支滑鼠比你的理想掌心高度低 ${a.delta}。`
      : "這支滑鼠比你的理想掌心高度低。",
  height_ideal: (a) =>
    a.delta
      ? `掌心高度與你的理想值相差不到 ${a.delta}。`
      : "掌心高度與你的手相當吻合。",
  height_high: (a) =>
    a.delta
      ? `這支滑鼠比你的理想掌心高度高 ${a.delta}。`
      : "這支滑鼠比你的理想掌心高度高。",
  hump_matches_grip: () => "駝峰的位置適合你握滑鼠的方式。",
  hump_mismatch_grip: () => "駝峰的位置和你握滑鼠的方式不太相符。",
  flare_supports_fingers: () => "前端向外展開，手指有地方可以放。",
  flare_neutral: () => "前端形狀對手指既沒有幫助，也不會造成擠壓。",
  flare_crowds_fingers: () => "前端向內收，可能會擠到指尖。",
  thumb_rest_supports: () => "拇指托板能支撐你的握法。",
  thumb_neutral: () => "沒有拇指托板，不影響你的握法。",
  thumb_rest_missing: () => "沒有拇指托板，而趴握通常會把拇指靠在拇指托板上。",
  thumb_rest_unneeded: () => "有拇指托板，但你的握法用不到。",
  weight_in_range: (a) =>
    a.range ? `重量在你偏好的範圍內（${a.range}）。` : "重量在你偏好的範圍內。",
  weight_heavier: (a) =>
    a.deltaG
      ? `這支滑鼠比你偏好的約重 ${a.deltaG}。`
      : "這支滑鼠比你偏好的重。",
  weight_lighter: (a) =>
    a.deltaG
      ? `這支滑鼠比你偏好的約輕 ${a.deltaG}。`
      : "這支滑鼠比你偏好的輕。",
  descriptor_unknown: () => "形狀尚未評估",
  no_preference: () => "沒有重量偏好",
};

export const en: ReasonsCopy = {
  length_ideal: (a) =>
    a.delta
      ? `Length is within ${a.delta} of your ideal — about as close as it gets.`
      : "Length matches your ideal closely.",
  length_short: (a) =>
    a.delta
      ? `This mouse is ${a.delta} shorter than your ideal length.`
      : "This mouse is shorter than your ideal length.",
  length_long: (a) =>
    a.delta
      ? `This mouse is ${a.delta} longer than your ideal length.`
      : "This mouse is longer than your ideal length.",
  width_ideal: (a) =>
    a.delta
      ? `Grip width is within ${a.delta} of your ideal — a close match.`
      : "Grip width matches your hand well.",
  width_narrow: (a) =>
    a.delta
      ? `This mouse is ${a.delta} narrower than your ideal grip width.`
      : "This mouse is narrower than your ideal grip width.",
  width_wide: (a) =>
    a.delta
      ? `This mouse is ${a.delta} wider than your ideal grip width.`
      : "This mouse is wider than your ideal grip width.",
  height_low: (a) =>
    a.delta
      ? `This mouse sits ${a.delta} lower than your ideal palm height.`
      : "This mouse sits lower than your ideal palm height.",
  height_ideal: (a) =>
    a.delta
      ? `Palm height is within ${a.delta} of your ideal.`
      : "Palm height matches your hand well.",
  height_high: (a) =>
    a.delta
      ? `This mouse sits ${a.delta} higher than your ideal palm height.`
      : "This mouse sits higher than your ideal palm height.",
  hump_matches_grip: () => "The hump position suits how you hold a mouse.",
  hump_mismatch_grip: () =>
    "The hump position doesn't line up with how you hold a mouse.",
  flare_supports_fingers: () =>
    "The front flares outward, giving your fingertips somewhere to rest.",
  flare_neutral: () => "The front shape neither helps nor crowds your fingers.",
  flare_crowds_fingers: () =>
    "The front flares inward and may crowd your fingertips.",
  thumb_rest_supports: () => "The thumb rest supports how you grip.",
  thumb_neutral: () => "There's no thumb rest, which suits your grip fine.",
  thumb_rest_missing: () =>
    "There's no thumb rest, and a palm grip usually rests the thumb on one.",
  thumb_rest_unneeded: () =>
    "There's a thumb rest, but your grip doesn't need one.",
  weight_in_range: (a) =>
    a.range
      ? `Weight is within your preferred range (${a.range}).`
      : "Weight is within your preferred range.",
  weight_heavier: (a) =>
    a.deltaG
      ? `This mouse is about ${a.deltaG} heavier than you prefer.`
      : "This mouse is heavier than you prefer.",
  weight_lighter: (a) =>
    a.deltaG
      ? `This mouse is about ${a.deltaG} lighter than you prefer.`
      : "This mouse is lighter than you prefer.",
  descriptor_unknown: () => "Shape not rated yet",
  no_preference: () => "No weight preference given",
};

export function reasonsCopy(locale: Locale): ReasonsCopy {
  return pickCopy(locale, { zhTW, en });
}
