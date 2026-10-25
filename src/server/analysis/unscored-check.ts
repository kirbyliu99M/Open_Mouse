/**
 * Output check for the unscored mode (the hand is outside the catalogue's
 * length range): the text must not state or imply an overall score or grade.
 * The prompt already says so, but a prompt is not a hard rule, so the answer is
 * checked the way numerals and medical terms are: a hit is a violation, which
 * `analyse()` turns into a retry and then the fallback text.
 *
 * What counts (candidate wording, 未拍板):
 * - a score or rating word ("score", "rating", "grade", 分數, 評分, 合手度...);
 * - a number of points ("99 points", "99 分", "九十九分");
 * - a band label of `fit-bands.ts`, in either language ("A good fit", 適合你);
 * - a graded fit or match in plain words ("excellent fit", "best match",
 *   "perfect fit", 最適合, 非常適合, 完美契合).
 * Plain comparison words stay allowed: "closest", 最接近, "may", "tends to".
 * It cannot catch every possible phrasing; it is a net under the prompt, and
 * the deterministic fallback is the guaranteed unscored text.
 */
import { en as enBands, zhTW as zhBands } from "../../lib/copy/fit-bands";
import { normalizeUnicodeDigits, withoutDisplayNames } from "./numerals";

const BAND_LABELS: readonly string[] = [
  ...Object.values(enBands.bands),
  ...Object.values(zhBands.bands),
].map(({ label }) => label);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PATTERNS: readonly RegExp[] = [
  // Every band label, as written. English ones also as "a good fit" etc.
  ...BAND_LABELS.map((label) => new RegExp(escape(label), "i")),
  // English: score / rating / grade words, points, out-of-100.
  /\bscor(?:e|es|ed|ing)\b/i,
  /\bratings?\b/i,
  /\bgrad(?:e|es|ed|ing)\b/i,
  /\d+(?:\.\d+)?\s*(?:points?|pts?)\b/i,
  /\bout of (?:100|a hundred)\b/i,
  /\/\s*100\b/,
  // English: a graded fit or match.
  /\b(?:very good|good|great|excellent|perfect|ideal|best|bad|poor|fair|strong|weak|top|high|low)\s+(?:fit|match|fitting)\b/i,
  /\b(?:fits|matches)\s+(?:you |your hand )?(?:perfectly|excellently|very well|really well|extremely well)\b/i,
  /\b(?:best|most)\s+(?:suitable|suited|comfortable)\b/i,
  // zh-TW: score words, fit-degree words, points.
  /分數|評分|得分|總分|滿分|高分|低分|打分|分值|百分制/,
  /(?:合手|合適|適合|契合|吻合|符合|匹配|相容)度/,
  /\d+(?:\.\d+)?\s*分(?![之鐘開析布])/,
  /[一二三四五六七八九百兩两][零〇一二三四五六七八九十百]*\s*分(?![之鐘開析布])/,
  // zh-TW: a graded fit.
  /最(?:適合|合適|合手|符合|完美|理想|契合|吻合)/,
  /(?:非常|很|十分|相當|極為|完全|完美|高度)(?:適合|合適|合手|符合|吻合|契合)/,
  /完美(?:契合|吻合|合手|匹配)/,
];

/**
 * The first score or grade wording in `text`, or null. `exemptNames` are the
 * input's display names: a mouse that happens to be called "Perfect Grip" is
 * not a grade.
 */
export function findUnscoredGradeTerm(
  text: string,
  exemptNames: readonly string[] = [],
): string | null {
  const folded = normalizeUnicodeDigits(withoutDisplayNames(text, exemptNames));
  for (const pattern of PATTERNS) {
    const hit = pattern.exec(folded);
    if (hit !== null) return hit[0].trim();
  }
  return null;
}
