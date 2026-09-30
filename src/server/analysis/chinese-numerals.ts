/**
 * Chinese numerals for the no-new-numerals rule (AGENTS.md #2). `numerals.ts`
 * only understood Arabic digits and English number words, so a Chinese answer
 * could say 五, 十二, 一百二十, 半, 百分之三十 or 三分之一 and never be checked.
 * This module reads those into the same `{ value, percent }` tokens the digit
 * and English-word paths produce, so they are compared with the input exactly
 * like a digit is. Traditional and Simplified spellings both work.
 *
 * It receives text already run through `normalizeUnicodeDigits` (NFKC, so
 * full-width digits, `％` and `．` are ASCII by now, and `㊄` is `五`).
 * Arabic digits are the digit path's job; they only matter here when glued to
 * a Chinese unit or particle (`3萬`, `7成`, `3分之1`).
 *
 * What is read:
 * - Cardinals: 五, 十二, 二十五, 一百二十五, 一百二 (= 120), 一百零五, 兩千,
 *   三萬五千, 三萬五 (= 35000), 一億二千萬, shorthand 廿 / 卅 / 卌, and bare
 *   digit strings (二〇二四, 一二五). Ordinary and financial digits and units
 *   (壹貳叁肆伍陸柒捌玖拾佰仟), 兩/两, 萬/万, 億/亿, Suzhou numerals (〡〢〣...),
 *   and the colloquial 仨 (= 3) and 倆/俩 (= 2).
 * - Two characters that are digits only beside another numeral character: ○
 *   (U+25CB, 一○○ = 100) and 參/参 (financial 3, 參拾伍 = 35).
 * - Decimals: 三點五 (= 3.5), 零點九, 十二點五.
 * - 半 (= 0.5), and 一半 as 0.5 alone; 雙 / 双 (= 2, like "double"). 半 in a
 *   position word (前半 後半 上半 下半 左半 右半, as in 後半部) is not 0.5.
 * - Percentages: 百分之三十, 百分之百, `三十%`, 三十個百分點, 三十趴, and
 *   N成 (tenths: 七成 = 70 percent).
 * - Fractions: 三分之一 (= 1/3), 十分之三 (= 0.3); 百分之N is the percent form.
 * - Arabic digits followed by a unit: 3萬 = 30000, 1.5萬, 2千, 5億.
 * - Ordinals (第三名) are read as the number they name, so "the third pick"
 *   needs a rank 3 in the input. A ranking always has rank 1, so 第一名 is fine.
 *
 * What is not a number: a numeral character inside a listed non-quantity
 * compound (一些 一樣 一定 十分適合 萬一 零件 ...; see `NON_QUANTITY_COMPOUNDS`
 * and `CONDITIONAL_COMPOUNDS`), a placeholder ○ (○○滑鼠), and a financial
 * character that has an everyday meaning, on its own: 肆意, 大陸, 隊伍, 拾起,
 * 參考. The other financial characters (壹貳叁柒捌玖佰仟) have no such use, so
 * they are numbers even alone.
 *
 * Direction of every choice below: hard rule 2 is asymmetric. A false alarm
 * costs one retry (or the fallback answer); a miss puts an invented number in
 * front of the user. So a numeral character is a number unless it is in the
 * list, and an unlisted compound is flagged. Where a reading is ambiguous
 * (五六 = 56, or "5 or 6"), every reading is emitted and all must be allowed.
 * The list is a candidate list, like the medical-claims list: extend it when a
 * real answer is flagged for an ordinary word.
 *
 * A list entry only counts when no numeral character is glued to either side:
 * 萬一 inside 一萬一千 is the number 11000, not the word "in case".
 * The one exception: a lone 肆 / 陸 / 伍 in front of a word that starts with 一
 * is a noun (大陸一直, 隊伍一起), not the start of a number.
 */
import type { NumeralToken } from "./numerals";

export const DIGITS: ReadonlyMap<string, number> = new Map([
  ["〇", 0],
  ["零", 0],
  ["一", 1],
  ["二", 2],
  ["兩", 2],
  ["两", 2],
  // Colloquial: 仨 = 三個, 倆 / 俩 = 兩個 (伎倆 is a word, see the list below).
  ["仨", 3],
  ["倆", 2],
  ["俩", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9],
  // Financial forms.
  ["壹", 1],
  ["貳", 2],
  ["貮", 2],
  ["贰", 2],
  ["叁", 3],
  ["肆", 4],
  ["伍", 5],
  ["陸", 6],
  ["陆", 6],
  ["柒", 7],
  ["捌", 8],
  ["玖", 9],
  // Suzhou numerals U+3021..U+3029.
  ["〡", 1],
  ["〢", 2],
  ["〣", 3],
  ["〤", 4],
  ["〥", 5],
  ["〦", 6],
  ["〧", 7],
  ["〨", 8],
  ["〩", 9],
]);

export const UNITS: ReadonlyMap<string, number> = new Map([
  ["十", 10],
  ["拾", 10],
  ["〸", 10],
  ["百", 100],
  ["佰", 100],
  ["千", 1000],
  ["仟", 1000],
  ["萬", 10_000],
  ["万", 10_000],
  ["億", 100_000_000],
  ["亿", 100_000_000],
]);

/**
 * One character standing for a whole number, expanded before parsing. 〹 and 〺
 * (Hangzhou 20 and 30) are listed for completeness, but NFKC has already
 * turned them into 卄 (U+5344) and 卅 by the time text gets here, so 卄 must be
 * listed as well or 〹 would slip through.
 */
export const SHORTHAND: ReadonlyMap<string, string> = new Map([
  ["廿", "二十"],
  ["卄", "二十"],
  ["卅", "三十"],
  ["卌", "四十"],
  ["〹", "二十"],
  ["〺", "三十"],
]);

/**
 * Characters that are a digit only when they touch another numeral character,
 * mapped to the digit they stand for there. Alone they are ordinary text: ○ is
 * a placeholder or a bullet (○○滑鼠), 參 / 参 is 參考 / 參數 / 參加.
 */
const CONTEXTUAL_NUMERALS: ReadonlyMap<string, string> = new Map([
  ["○", "〇"],
  ["參", "叁"],
  ["参", "叁"],
]);

/**
 * Financial characters that are also everyday words: 肆意, 大陸 / 陸續, 隊伍,
 * 拾起. On their own they are not numbers; a run of two or more (拾伍) is. Only
 * characters with such a use belong here. 壹貳貮贰叁柒捌玖佰仟 have none, so a
 * single one of them is a number (長度柒毫米). 參 is handled separately: see
 * CONTEXTUAL_NUMERALS.
 */
const EVERYDAY_FINANCIAL_DIGITS = new Set("肆陸陆伍");
const EVERYDAY_FINANCIAL = new Set([...EVERYDAY_FINANCIAL_DIGITS, "拾"]);

const DECIMAL_POINTS = new Set(["點", "点"]);

const isDigit = (c: string) => DIGITS.has(c);
const isNumeralChar = (c: string) =>
  DIGITS.has(c) || UNITS.has(c) || SHORTHAND.has(c);
/** Anything that makes a neighbouring lexicon match part of a number. */
const isQuantityChar = (c: string) =>
  /[0-9]/.test(c) || isNumeralChar(c) || c === "半" || c === "雙" || c === "双";

/**
 * Words in which a numeral character is never a quantity. A candidate list:
 * anything not here is read as a number and flagged unless it is in the input.
 * (In a real run 1 is always in the input as a rank, so the 一- words cost
 * nothing there; the words with 十, 千, 萬, 零, 二, 四 are the ones that matter.)
 * Only add a word whose numeral character is never a count. A word that is
 * sometimes an adverb and sometimes a number belongs in CONDITIONAL_COMPOUNDS.
 */
export const NON_QUANTITY_COMPOUNDS: readonly string[] = [
  // 一 as an adverb, pronoun or part of a fixed phrase.
  "一些",
  "一樣",
  "一样",
  "一定",
  "一起",
  "一般",
  "一直",
  "一旦",
  "一切",
  "一邊",
  "一边",
  "一下",
  "一會",
  "一会",
  "一同",
  "一律",
  "一向",
  "一再",
  "一貫",
  "一贯",
  "一度",
  "一時",
  "一时",
  "一陣",
  "一阵",
  "一連",
  "一连",
  "一味",
  "一併",
  "一并",
  "一致",
  "一方面",
  "一部分",
  "一部份",
  "一成不變",
  "一成不变",
  // 一 meaning "only", "same", "unify".
  "統一",
  "统一",
  "唯一",
  "同一",
  "單一",
  "单一",
  "專一",
  "专一",
  "劃一",
  "划一",
  // 十, 百, 千, 萬 in ordinary words.
  "十足",
  "十字",
  "萬一",
  "万一",
  "萬能",
  "万能",
  "萬用",
  "万用",
  // 零, 二, 四 in ordinary words.
  "零件",
  "零售",
  "零星",
  "零散",
  "零食",
  "零錢",
  "零钱",
  "零用",
  "零碎",
  "二手",
  // 四周 = "all around". This is a trade-off, not a fact: in Taiwan the four
  // weeks are written 四週, and 四周 is the surroundings (滑鼠四周), so the
  // list follows Taiwan usage. Simplified writing uses 周 for both, so a
  // mainland "用了四周" (four weeks) is let through. Revisit if the answers
  // are ever asked for in Simplified. 四週 is not in the list and is flagged.
  "四周",
  "四處",
  "四处",
  // 倆 in a name for a trick, not a count. 伎倆 / 技倆 = a (petty) trick, the
  // only everyday word in which 倆 is not "two".
  "伎倆",
  "伎俩",
  "技倆",
  "技俩",
  // A percentage as a concept ("信心百分比"), as opposed to 百分之三十.
  "百分比",
  "百分率",
  // 半 as "mostly".
  "多半",
  "大半",
  // 百, 千, 萬 in ordinary words and set phrases.
  "百搭",
  "百般",
  "百貨",
  "百货",
  "百科",
  "百姓",
  "千篇一律",
  "千里",
  "萬事",
  "万事",
  "萬物",
  "万物",
  "十全十美",
  "十有八九",
];

/** Longest first, so a longer word is masked before a shorter one inside it. */
const LEXICON = [...NON_QUANTITY_COMPOUNDS].sort((a, b) => b.length - a.length);

const MASK = "\u0001";

/** What surrounds a word being tested, for the context-dependent list below. */
interface WordContext {
  /** Everything before the word. Words masked earlier show up as MASK. */
  before: string;
  /** Everything after the word; empty at the end of the text. */
  after: string;
}

/** True when the text goes on with a Chinese word (a masked word counts). */
const continuesWithWord = (after: string) =>
  /^[\p{Script=Han}\u0001]/u.test(after);

/** Punctuation and spaces: the start of a clause. */
const CLAUSE_BOUNDARY = /[\s\p{P}]/u;

/**
 * Words before 十分 that make it a score or a difference (滿分十分, 高出十分):
 * matched anywhere in the last few characters of the clause.
 */
const SCORE_CONTEXT_WORDS: readonly string[] = [
  "滿分",
  "满分",
  "得分",
  "扣分",
  "加分",
  "減分",
  "减分",
  "高出",
  "高了",
  "低了",
  "低出",
  "差了",
  "相差",
  "多了",
  "少了",
  "多出",
  "少出",
  "加了",
  "減了",
  "减了",
  "扣了",
  "拿了",
  "拿到",
  "只有",
  "超出",
  "超過",
  "超过",
  "領先",
  "领先",
  "落後",
  "落后",
];

/** Comparison and arithmetic words that directly precede a quantity. */
const SCORE_CONTEXT_ENDINGS: readonly string[] = [
  "高",
  "低",
  "多",
  "少",
  "差",
  "增",
  "降",
  "加",
  "減",
  "减",
  "扣",
];

function followsScoreContext(before: string): boolean {
  const clause = before.split(CLAUSE_BOUNDARY).pop() ?? "";
  const nearby = clause.slice(-6);
  return (
    SCORE_CONTEXT_WORDS.some((word) => nearby.includes(word)) ||
    SCORE_CONTEXT_ENDINGS.some((word) => clause.endsWith(word))
  );
}

/** 十分 followed by these is a number: 十分之三, 十分鐘, the ten-point scale. */
const SHIFEN_NUMBER_FOLLOWERS = "之鐘钟鍾制";

/** 千萬 is "by all means" only in front of these (千萬不要, 千萬別, 千萬小心). */
const QIANWAN_ADVERB_FOLLOWERS: readonly string[] = [
  "不",
  "別",
  "别",
  "要",
  "記",
  "记",
  "勿",
  "莫",
  "小心",
  "注意",
  "得",
];

/**
 * 前半 / 後半 / 上半 ...: a position ("後半部隆起"), not 0.5. Two contexts turn
 * it back into a number: 半個 right after it, and 然 / 之 / 以 in front (然後半
 * 小時 = "then half an hour", where 後 belongs to the previous word).
 */
const POSITION_HALF_WORDS: readonly string[] = [
  "前半",
  "後半",
  "后半",
  "上半",
  "下半",
  "左半",
  "右半",
];

const isPositionHalf = ({ before, after }: WordContext) =>
  !/^[個个]/u.test(after) && !/[然之以晚早]$/u.test(before);

/**
 * Words that are non-quantities only in some contexts. `isNonQuantity` says
 * whether the word is masked here; when it is not, the numeral characters in it
 * are read as a number. Every rule leans to "number" when the context is not
 * clearly the adverb: a false alarm costs a retry, a miss breaks hard rule 2.
 *
 * - 十分 is the adverb "very" (十分貼合) only when a Chinese word follows and
 *   nothing before it makes it a score. It is a number in 十分之三, 十分鐘,
 *   十分制, at the end of a clause (高出十分。) and after a score or
 *   comparison word (滿分十分, 得分十分, 比第二名高出十分).
 * - 萬分 is "extremely" (萬分感謝, 感激萬分) unless 之 follows: 萬分之一 is
 *   1/10000. 千萬分之一 is caught earlier: a numeral character glued to the
 *   left keeps 萬分 a number. (千分 and 百分 are not in any list, so 千分之一
 *   and 百分之三 already fall through to the fraction path.)
 * - 千萬 is "by all means" only before 不 / 別 / 要 / 記 / 勿 / 莫 / 小心 /
 *   注意 / 得. Anywhere else (千萬像素) it is ten million.
 * - 一點 / 一点 means "a little" unless a digit follows (一點五 = 1.5): the
 *   digit is a numeral character, which already stops the match.
 * - 前半 / 後半 / 上半 / 下半 / 左半 / 右半 are positions; see POSITION_HALF_WORDS.
 */
export const CONDITIONAL_COMPOUNDS: readonly {
  word: string;
  isNonQuantity: (context: WordContext) => boolean;
}[] = [
  {
    word: "十分",
    isNonQuantity: ({ before, after }) =>
      continuesWithWord(after) &&
      !SHIFEN_NUMBER_FOLLOWERS.includes(after[0]!) &&
      !followsScoreContext(before),
  },
  {
    word: "萬分",
    isNonQuantity: ({ after }) => !after.startsWith("之"),
  },
  {
    word: "万分",
    isNonQuantity: ({ after }) => !after.startsWith("之"),
  },
  {
    word: "千萬",
    isNonQuantity: ({ after }) =>
      QIANWAN_ADVERB_FOLLOWERS.some((next) => after.startsWith(next)),
  },
  {
    word: "千万",
    isNonQuantity: ({ after }) =>
      QIANWAN_ADVERB_FOLLOWERS.some((next) => after.startsWith(next)),
  },
  { word: "一點", isNonQuantity: () => true },
  { word: "一点", isNonQuantity: () => true },
  ...POSITION_HALF_WORDS.map((word) => ({
    word,
    isNonQuantity: isPositionHalf,
  })),
];

/**
 * 大陸一直, 隊伍一起: a lone everyday financial digit in front of a word that
 * starts with 一 is a noun followed by that word, not the start of 51 or 61.
 * Financial figures are written with 壹, not 一, so 伍一 is not a number; and a
 * lone 伍 is already read as the noun (see EVERYDAY_FINANCIAL). Only these four
 * digits and only 一-words: 拾一 is 11, and 伍萬用戶 is 50000 users.
 */
function isNounBeforeOne(text: string, at: number, word: string): boolean {
  if (!word.startsWith("一") || !EVERYDAY_FINANCIAL_DIGITS.has(text[at - 1]!)) {
    return false;
  }
  return at < 2 || !isQuantityChar(text[at - 2]!);
}

function maskWord(
  text: string,
  word: string,
  isNonQuantity: (context: WordContext) => boolean,
): string {
  let out = text;
  let from = 0;
  for (;;) {
    const at = out.indexOf(word, from);
    if (at === -1) return out;
    const end = at + word.length;
    const before = at > 0 ? out[at - 1] : undefined;
    const next = end < out.length ? out[end] : undefined;
    const glued =
      (before !== undefined &&
        isQuantityChar(before) &&
        !isNounBeforeOne(out, at, word)) ||
      (next !== undefined && isQuantityChar(next));
    if (
      !glued &&
      isNonQuantity({ before: out.slice(0, at), after: out.slice(end) })
    ) {
      out = out.slice(0, at) + MASK.repeat(word.length) + out.slice(end);
    }
    from = at + 1;
  }
}

function maskNonQuantityCompounds(text: string): string {
  let out = text;
  for (const word of LEXICON) out = maskWord(out, word, () => true);
  for (const { word, isNonQuantity } of CONDITIONAL_COMPOUNDS) {
    out = maskWord(out, word, isNonQuantity);
  }
  return out;
}

/**
 * ○ and 參 / 参 read as a digit only when they touch another numeral
 * character; the run they belong to is then folded to the plain digit form
 * (一○○ -> 一〇〇, 參拾伍 -> 叁拾伍). A run made only of these characters, or
 * one that has none of them, is left alone, so ○○滑鼠 and 參考 are not numbers.
 * Touching an everyday financial character (大陸參加) counts as touching: a run
 * of two numeral characters is a number everywhere else in this file too.
 */
function foldContextualNumerals(text: string): string {
  const chars = [...text];
  const inRun = (c: string) => isNumeralChar(c) || CONTEXTUAL_NUMERALS.has(c);
  let i = 0;
  while (i < chars.length) {
    if (!inRun(chars[i]!)) {
      i++;
      continue;
    }
    let end = i;
    let touchesNumeral = false;
    while (end < chars.length && inRun(chars[end]!)) {
      if (isNumeralChar(chars[end]!)) touchesNumeral = true;
      end++;
    }
    if (touchesNumeral) {
      for (let k = i; k < end; k++) {
        chars[k] = CONTEXTUAL_NUMERALS.get(chars[k]!) ?? chars[k]!;
      }
    }
    i = end;
  }
  return chars.join("");
}

/** A reading of a run of digit and unit characters, possibly ambiguous. */
function parseIntegerRun(run: string): number[] {
  const chars = [...run];
  const hasUnit = chars.some((c) => UNITS.has(c));

  if (!hasUnit) {
    const digits = chars.map((c) => DIGITS.get(c)!);
    if (digits.length === 1) return [digits[0]!];
    // Two plain digits are "5 or 6" (五六個) as often as 56: emit every reading.
    if (digits.length === 2 && !digits.includes(0)) {
      return [digits[0]! * 10 + digits[1]!, digits[0]!, digits[1]!];
    }
    return [Number(digits.join(""))];
  }

  const results: number[] = [];
  let total = 0;
  let section = 0;
  let num = 0;
  let numSet = false;
  let lastWasDigit = false;
  let digitAfterUnit = 0; // the unit directly before the last digit, if any
  let previousWasUnit = 0;

  const finish = () => {
    let value = total + section + num;
    // 一百二 = 120, 三萬五 = 35000: a lone last digit after 百/千/萬/億 is the
    // next unit down. Not after 十 (二十五 = 25) and not after 零 (一百零二).
    if (lastWasDigit && digitAfterUnit >= 100) {
      value = total + section + num * (digitAfterUnit / 10);
    }
    results.push(value);
    total = section = num = 0;
    numSet = false;
    lastWasDigit = false;
    digitAfterUnit = 0;
    previousWasUnit = 0;
  };

  for (const c of chars) {
    const digit = DIGITS.get(c);
    if (digit !== undefined) {
      if (digit === 0) {
        // 零 between units (一百零五): a separator, not a digit.
        lastWasDigit = false;
        previousWasUnit = 0;
        continue;
      }
      if (lastWasDigit) finish(); // two digits in a row: two numbers (二三十)
      num = digit;
      numSet = true;
      digitAfterUnit = previousWasUnit;
      lastWasDigit = true;
      previousWasUnit = 0;
      continue;
    }
    const unit = UNITS.get(c)!;
    lastWasDigit = false;
    if (unit < 10_000) {
      section += (numSet ? num : 1) * unit;
    } else if (unit === 10_000) {
      const value = section + (numSet ? num : 0);
      total += (value === 0 ? 1 : value) * 10_000;
      section = 0;
    } else {
      const value = total + section + (numSet ? num : 0);
      total = (value === 0 ? 1 : value) * unit;
      section = 0;
    }
    num = 0;
    numSet = false;
    previousWasUnit = unit;
    digitAfterUnit = 0;
  }
  finish();
  return results;
}

/** All readings of one maximal run of numeral characters (decimal point allowed). */
function parseRun(run: string): number[] {
  const expanded = [...run].map((c) => SHORTHAND.get(c) ?? c).join("");
  const dot = [...expanded].findIndex((c) => DECIMAL_POINTS.has(c));
  if (dot === -1) return parseIntegerRun(expanded);

  const chars = [...expanded];
  const integerPart = chars.slice(0, dot).join("");
  const rest = chars.slice(dot + 1);
  let digitCount = 0;
  while (digitCount < rest.length && isDigit(rest[digitCount]!)) digitCount++;
  const fraction = rest
    .slice(0, digitCount)
    .map((c) => DIGITS.get(c)!)
    .join("");
  const leftover = rest.slice(digitCount).join("");

  const values = parseIntegerRun(integerPart).map((n) =>
    Number(`${n}.${fraction === "" ? "0" : fraction}`),
  );
  if (leftover !== "") values.push(...parseRun(leftover));
  return values;
}

interface Atom {
  start: number;
  end: number;
  text: string;
  values: number[];
  arabic: boolean;
  /** For an Arabic number: the Chinese unit glued to it (3萬), already consumed. */
  unit?: number;
}

/** A 點 / 点 belongs to a number only between a numeral and a digit. */
function readRunEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    const c = text[i]!;
    if (isNumeralChar(c)) {
      i++;
    } else if (
      DECIMAL_POINTS.has(c) &&
      i > start &&
      isNumeralChar(text[i - 1]!) &&
      i + 1 < text.length &&
      isDigit(text[i + 1]!)
    ) {
      i++;
    } else {
      break;
    }
  }
  return i;
}

function toAtoms(text: string): Atom[] {
  const atoms: Atom[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (/[0-9]/.test(c)) {
      const match = /^\d+(?:\.\d+)?/.exec(text.slice(i))!;
      let end = i + match[0].length;
      // 3萬: the unit belongs to the number, it is not a number of its own.
      const unit = end < text.length ? UNITS.get(text[end]!) : undefined;
      if (unit !== undefined) end++;
      atoms.push({
        start: i,
        end,
        text: match[0],
        values: [Number(match[0])],
        arabic: true,
        unit,
      });
      i = end;
    } else if (text.startsWith("百分點", i) || text.startsWith("百分点", i)) {
      // "percentage point": a percent marker (see PERCENT_SUFFIX), not 100.
      i += 3;
    } else if (c === "半") {
      // 一半 is one half, not "1" and "0.5".
      const previous = atoms[atoms.length - 1];
      if (
        previous &&
        !previous.arabic &&
        previous.end === i &&
        previous.text === "一"
      ) {
        atoms.pop();
      }
      atoms.push({
        start: i,
        end: i + 1,
        text: c,
        values: [0.5],
        arabic: false,
      });
      i++;
    } else if (text.startsWith("加倍", i) || text.startsWith("翻倍", i)) {
      // "double it": 2, like the English "double".
      atoms.push({
        start: i,
        end: i + 2,
        text: "倍",
        values: [2],
        arabic: false,
      });
      i += 2;
    } else if (c === "雙" || c === "双") {
      atoms.push({ start: i, end: i + 1, text: c, values: [2], arabic: false });
      i++;
    } else if (isNumeralChar(c)) {
      const end = readRunEnd(text, i);
      const run = text.slice(i, end);
      const lone = [...run].length === 1;
      if (!(lone && EVERYDAY_FINANCIAL.has(run))) {
        atoms.push({
          start: i,
          end,
          text: run,
          values: parseRun(run),
          arabic: false,
        });
      }
      i = end;
    } else {
      i++;
    }
  }
  return atoms;
}

/**
 * A decimal written half in Arabic digits and half in Chinese: 3點5, 3點五,
 * 三點5. Each half is also checked on its own by the other paths; this adds
 * the decimal they make together (3.5), which they cannot see.
 */
function mixedDecimals(text: string): NumeralToken[] {
  const tokens: NumeralToken[] = [];
  const fractionDigits = (s: string) =>
    [...s].map((c) => (/[0-9]/.test(c) ? c : String(DIGITS.get(c)))).join("");

  for (const m of text.matchAll(/(\d+)[點点]([0-9〇零一二三四五六七八九]+)/g)) {
    tokens.push({
      value: Number(`${m[1]}.${fractionDigits(m[2]!)}`),
      percent: false,
    });
  }
  for (const m of text.matchAll(
    /([〇零一二三四五六七八九十百千萬万億亿]+)[點点](\d+)/g,
  )) {
    for (const whole of parseRun(m[1]!)) {
      tokens.push({ value: Number(`${whole}.${m[2]}`), percent: false });
    }
  }
  return tokens;
}

const PERCENT_SUFFIX = /^\s*(?:%|(?:個|个)?百分[點点]|趴)/;

/**
 * Numeral tokens for the Chinese numbers in `normalized`, which must already
 * be `normalizeUnicodeDigits` output. Bare Arabic digits are not returned.
 */
export function readChineseNumerals(normalized: string): NumeralToken[] {
  const text = maskNonQuantityCompounds(foldContextualNumerals(normalized));
  const atoms = toAtoms(text);
  const tokens: NumeralToken[] = mixedDecimals(text);

  for (let k = 0; k < atoms.length; k++) {
    const atom = atoms[k]!;
    const after = text.slice(atom.end);

    // N分之M: a fraction; 百分之M is M percent.
    const numerator = atoms[k + 1];
    if (
      after.startsWith("分之") &&
      numerator !== undefined &&
      numerator.start === atom.end + 2
    ) {
      for (const denominator of atom.values) {
        for (const n of numerator.values) {
          if (denominator === 100) tokens.push({ value: n, percent: true });
          else if (denominator !== 0) {
            tokens.push({ value: n / denominator, percent: false });
          }
        }
      }
      k++;
      continue;
    }

    // N成: N tenths, i.e. N * 10 percent (七成).
    if (
      after.startsWith("成") &&
      atom.values.length === 1 &&
      Number.isInteger(atom.values[0]) &&
      atom.values[0]! >= 1 &&
      atom.values[0]! <= 10
    ) {
      tokens.push({ value: atom.values[0]! * 10, percent: true });
      continue;
    }

    if (atom.arabic) {
      // 3萬: the digit path reports the 3; this reports the 30000.
      if (atom.unit !== undefined) {
        tokens.push({ value: atom.values[0]! * atom.unit, percent: false });
      }
      continue;
    }

    const percent = PERCENT_SUFFIX.test(after);
    for (const value of atom.values) tokens.push({ value, percent });
  }
  return tokens;
}
