/**
 * The no-new-numerals rule (AGENTS.md #2, hard): every number in the model's
 * output must already appear somewhere in the input we sent it. Pure and
 * tested independently of any model call.
 *
 * "Normalise 125, 125.0 and 125 mm" — those are the same number written
 * three ways. `collectNumbers` walks the input and records the numeric
 * *values* (125), not their source formatting; `extractNumerals` pulls
 * numeric tokens out of free text the same way, stripping any unit suffix.
 * Comparing the resulting numbers (not strings) is the normalisation.
 *
 * Three bypass classes this file guards against, on top of plain digits:
 *
 * 1. Unicode digits that are not `0-9` — fullwidth (`１２５`), superscript/
 *    subscript (`¹²⁵`), and other-script decimal digits (Arabic-Indic
 *    `١٢٥`, Devanagari, etc.). `normalizeUnicodeDigits` folds all of these
 *    to ASCII before extraction.
 * 2. Spelled-out numbers and multiplier/fraction words ("five", "twelve",
 *    "a dozen", "half", "double") — `extractWordNumerals` parses these into
 *    the same numeric values a digit would produce, so they're checked
 *    against the input exactly like a digit is.
 * 3. Percent-form mismatches — an input fraction like `confidence: 0.9`
 *    written back as `"90%"` (or `"90 %"`) is the *same* number, not a new
 *    one. Only tokens actually marked with a percent sign/word get this
 *    equivalence, so a genuinely new number is never let through by it.
 */

const NUMERAL_PATTERN = /(?<![\w.])-?\d+(?:\.\d+)?(?!\d)/g;
const EPSILON = 1e-9;

/**
 * Start code points of every Unicode decimal-digit (`Nd`) block this project
 * expects to see, each spanning exactly 10 consecutive code points for 0-9
 * in ascending order (a stability guarantee of the Unicode `Nd` category).
 * ASCII and fullwidth are included for completeness even though NFKC
 * (applied first) already handles fullwidth, superscript and subscript.
 */
const DIGIT_BLOCK_STARTS: readonly number[] = [
  0x0030, // ASCII
  0x0660, // Arabic-Indic
  0x06f0, // Extended Arabic-Indic (Persian)
  0x07c0, // NKo
  0x0966, // Devanagari
  0x09e6, // Bengali
  0x0a66, // Gurmukhi
  0x0ae6, // Gujarati
  0x0b66, // Oriya
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
  0x0de6, // Sinhala Lith
  0x0e50, // Thai
  0x0ed0, // Lao
  0x0f20, // Tibetan
  0x1040, // Myanmar
  0x1090, // Myanmar Shan
  0x17e0, // Khmer
  0x1810, // Mongolian
  0x1946, // Limbu
  0x19d0, // New Tai Lue
  0x1a80, // Tai Tham Hora
  0x1a90, // Tai Tham Tham
  0x1b50, // Balinese
  0x1bb0, // Sundanese
  0x1c40, // Lepcha
  0x1c50, // Ol Chiki
  0xa8d0, // Saurashtra
  0xa900, // Kayah Li
  0xa9d0, // Javanese
  0xa9f0, // Myanmar Tai Laing
  0xaa50, // Cham
  0xabf0, // Meetei Mayek
  0xff10, // Fullwidth
  0x104a0, // Osmanya
  0x1d7ce, // Mathematical Bold
  0x1d7d8, // Mathematical Double-Struck
  0x1d7e2, // Mathematical Sans-Serif
  0x1d7ec, // Mathematical Sans-Serif Bold
  0x1d7f6, // Mathematical Monospace
  0x1e140, // Nyiakeng Puachue Hmong
  0x1e2f0, // Wancho
  0x1e4f0, // Nag Mundari
  0x1e950, // Adlam
  0x1fbf0, // Segmented digits
];

const UNICODE_DIGIT_VALUES: ReadonlyMap<number, number> = (() => {
  const map = new Map<number, number>();
  for (const start of DIGIT_BLOCK_STARTS) {
    for (let i = 0; i < 10; i++) map.set(start + i, i);
  }
  return map;
})();

/**
 * Folds any Unicode representation of a decimal digit to ASCII `0`-`9`.
 * NFKC handles fullwidth and super/subscript forms (they have compatibility
 * decompositions); the explicit `Nd`-block table handles scripts that don't
 * decompose to ASCII (Arabic-Indic, Devanagari, ...). Everything else in the
 * string passes through unchanged.
 */
export function normalizeUnicodeDigits(text: string): string {
  const nfkc = text.normalize("NFKC");
  let out = "";
  for (const ch of nfkc) {
    const digit = UNICODE_DIGIT_VALUES.get(ch.codePointAt(0)!);
    out += digit !== undefined ? String(digit) : ch;
  }
  return out;
}

/** Recursively collects every numeric leaf value in an arbitrary object tree. */
export function collectNumbers(
  value: unknown,
  out: Set<number> = new Set(),
): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) collectNumbers(v, out);
  }
  return out;
}

export interface NumeralToken {
  value: number;
  /** True when written as a percentage — `"90%"`, `"90 %"`, or `"ninety percent"`. */
  percent: boolean;
}

/** Digit-based numeral tokens, Unicode-digit-normalised, with percent detection. */
function matchDigitNumerals(text: string): NumeralToken[] {
  const normalized = normalizeUnicodeDigits(text);
  const tokens: NumeralToken[] = [];
  for (const match of normalized.matchAll(NUMERAL_PATTERN)) {
    const value = Number.parseFloat(match[0]);
    const after = normalized.slice(match.index + match[0].length);
    tokens.push({ value, percent: /^\s*%/.test(after) });
  }
  return tokens;
}

/** Pulls numeric tokens out of free text — "125", "125.0" and "125mm" alike. */
export function extractNumerals(text: string): number[] {
  return matchDigitNumerals(text).map((t) => t.value);
}

const CARDINAL_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SCALE_WORDS: Record<string, number> = {
  hundred: 100,
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

/** Multiplier/fraction words that are themselves a number, not a scale. */
const MULTIPLIER_WORDS: Record<string, number> = {
  half: 0.5,
  quarter: 0.25,
  third: 1 / 3,
  couple: 2,
  double: 2,
  twice: 2,
  triple: 3,
  thrice: 3,
  quadruple: 4,
  dozen: 12,
};

const WORD_TOKEN_PATTERN = /[a-z]+/g;

/**
 * Parses spelled-out cardinal numbers ("twenty-five", "one hundred and
 * five") and standalone multiplier/fraction words ("half", "a dozen",
 * "double") out of free text, returning them as numeral tokens exactly like
 * `matchDigitNumerals` — so "five" is checked against the input the same way
 * "5" would be.
 */
export function extractWordNumerals(text: string): NumeralToken[] {
  const tokens = text.toLowerCase().match(WORD_TOKEN_PATTERN) ?? [];
  const results: NumeralToken[] = [];
  let current = 0;
  let total = 0;
  let inRun = false;

  const flush = (stopToken: string | undefined) => {
    if (inRun) {
      results.push({
        value: total + current,
        percent: stopToken === "percent",
      });
    }
    current = 0;
    total = 0;
    inRun = false;
  };

  for (const token of tokens) {
    if (token === "a" || token === "an") continue;
    if (token === "and" && inRun) continue;

    if (Object.prototype.hasOwnProperty.call(CARDINAL_WORDS, token)) {
      current += CARDINAL_WORDS[token]!;
      inRun = true;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(SCALE_WORDS, token)) {
      const scale = SCALE_WORDS[token]!;
      if (current === 0) current = 1;
      if (scale >= 1000) {
        total += current * scale;
        current = 0;
      } else {
        current *= scale;
      }
      inRun = true;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(MULTIPLIER_WORDS, token)) {
      flush(token);
      results.push({ value: MULTIPLIER_WORDS[token]!, percent: false });
      continue;
    }
    flush(token);
  }
  flush(undefined);
  return results;
}

function isAllowed(n: number, allowed: ReadonlySet<number>): boolean {
  for (const a of allowed) {
    if (Math.abs(a - n) < EPSILON) return true;
  }
  return false;
}

/**
 * A numeral token is allowed if its literal value is in the input, OR — only
 * when it was actually written as a percentage — its `/100` fraction form
 * is. This makes `"90%"` match an input `confidence: 0.9` without loosening
 * anything for a plain `"90"` that isn't marked as a percentage.
 */
function isAllowedToken(
  token: NumeralToken,
  allowed: ReadonlySet<number>,
): boolean {
  if (isAllowed(token.value, allowed)) return true;
  if (token.percent && isAllowed(token.value / 100, allowed)) return true;
  return false;
}

/**
 * Returns the first numeral in `text` that isn't in `allowed`, or null if
 * every numeral — digit, Unicode-digit, spelled-out, or a multiplier/
 * fraction word — traces back to the input. Percent forms of an allowed
 * fraction are treated as the same number, not a new one.
 */
export function findUnknownNumeral(
  text: string,
  allowed: ReadonlySet<number>,
): number | null {
  for (const token of [
    ...matchDigitNumerals(text),
    ...extractWordNumerals(text),
  ]) {
    if (!isAllowedToken(token, allowed)) return token.value;
  }
  return null;
}
