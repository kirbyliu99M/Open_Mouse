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
 *   (壹貳叁肆伍陸柒捌玖拾佰仟), 兩/两, 萬/万, 億/亿, Suzhou numerals (〡〢〣...).
 * - Decimals: 三點五 (= 3.5), 零點九, 十二點五.
 * - 半 (= 0.5), and 一半 as 0.5 alone; 雙 / 双 (= 2, like "double").
 * - Percentages: 百分之三十, 百分之百, `三十%`, 三十個百分點, 三十趴, and
 *   N成 (tenths: 七成 = 70 percent).
 * - Fractions: 三分之一 (= 1/3), 十分之三 (= 0.3); 百分之N is the percent form.
 * - Arabic digits followed by a unit: 3萬 = 30000, 1.5萬, 2千, 5億.
 * - Ordinals (第三名) are read as the number they name, so "the third pick"
 *   needs a rank 3 in the input. A ranking always has rank 1, so 第一名 is fine.
 *
 * What is not a number: a numeral character inside a listed non-quantity
 * compound (一些 一樣 一定 十分適合 萬一 零件 ...; see `NON_QUANTITY_COMPOUNDS`),
 * and a financial character on its own (大陸, 參考, 隊伍, 拾起).
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
 */
import type { NumeralToken } from "./numerals";

const DIGITS: ReadonlyMap<string, number> = new Map([
  ["〇", 0],
  ["零", 0],
  ["一", 1],
  ["二", 2],
  ["兩", 2],
  ["两", 2],
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

const UNITS: ReadonlyMap<string, number> = new Map([
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

/** One character standing for a whole number, expanded before parsing. */
const SHORTHAND: ReadonlyMap<string, string> = new Map([
  ["廿", "二十"],
  ["卅", "三十"],
  ["卌", "四十"],
  ["〹", "二十"],
  ["〺", "三十"],
]);

/**
 * Characters that are also everyday words (隊伍, 大陸, 拾起, 肆意...). On their
 * own they are not numbers; a run of two or more (壹佰貳拾伍) is.
 */
const FINANCIAL = new Set("壹貳貮贰叁肆伍陸陆柒捌玖拾佰仟");

const DECIMAL_POINTS = new Set(["點", "点"]);

const isDigit = (c: string) => DIGITS.has(c);
const isNumeralChar = (c: string) =>
  DIGITS.has(c) || UNITS.has(c) || SHORTHAND.has(c);
/** Anything that makes a neighbouring lexicon match part of a number. */
const isQuantityChar = (c: string) =>
  /[0-9]/.test(c) || isNumeralChar(c) || c === "半" || c === "雙" || c === "双";

/**
 * Words in which a numeral character is not a quantity. A candidate list:
 * anything not here is read as a number and flagged unless it is in the input.
 * (In a real run 1 is always in the input as a rank, so the 一- words cost
 * nothing there; the words with 十, 千, 萬, 零, 二, 四 are the ones that matter.)
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
  "千萬",
  "千万",
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
  "四周",
  "四處",
  "四处",
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
  "萬分",
  "万分",
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

/**
 * Words that are non-quantities only in some contexts:
 * - 十分 means "very" unless it is 十分之N (a fraction) or 十分鐘 (ten minutes).
 * - 一點 / 一点 means "a little" unless a digit follows (一點五 = 1.5).
 */
const CONDITIONAL_COMPOUNDS: readonly {
  word: string;
  applies: (next: string | undefined) => boolean;
}[] = [
  { word: "十分", applies: (n) => n === undefined || !"之鐘钟".includes(n) },
  { word: "一點", applies: () => true },
  { word: "一点", applies: () => true },
];

function maskWord(
  text: string,
  word: string,
  applies: (next: string | undefined) => boolean,
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
      (before !== undefined && isQuantityChar(before)) ||
      (next !== undefined && isQuantityChar(next));
    if (!glued && applies(next)) {
      out = out.slice(0, at) + MASK.repeat(word.length) + out.slice(end);
    }
    from = at + 1;
  }
}

function maskNonQuantityCompounds(text: string): string {
  let out = text;
  for (const word of LEXICON) out = maskWord(out, word, () => true);
  for (const { word, applies } of CONDITIONAL_COMPOUNDS) {
    out = maskWord(out, word, applies);
  }
  return out;
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
      if (!(lone && FINANCIAL.has(run))) {
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
  const text = maskNonQuantityCompounds(normalized);
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
