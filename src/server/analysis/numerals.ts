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
 * Bypass classes this file guards against, on top of plain digits:
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
 * 4. Vulgar fraction characters ("½", "¾", "⅓", ...). `String.prototype
 *    .normalize("NFKC")` — which every digit-folding path here runs —
 *    decomposes these into digit + U+2044 FRACTION SLASH + digit (e.g. "½"
 *    -> "1⁄2"), which would otherwise read as the two unrelated numbers 1
 *    and 2. `normalizeVulgarFractions` converts them to their real decimal
 *    value first, and also collapses a literal "a⁄b" fraction-slash form
 *    the model might write directly.
 *
 * Digit runs glued to letters ("G502", "about68mm") are a fifth, separate
 * concern handled by `matchDigitNumerals` and the caller-supplied
 * `exemptTokens` set — see the comment above `matchDigitNumerals`. Callers
 * build that set with `stringTokens` over the *specific* display-name fields
 * their input actually has (see `src/server/analysis/analyse.ts`'s
 * `collectExemptTokens`) — never by walking every string in the input, since
 * an internal identifier like a kebab-case `slug` would then wrongly exempt
 * its lowercase digit run too (e.g. slug "logitech-g502-x" exempting a
 * fabricated "g502" quantity the model never should have been allowed to
 * write).
 *
 * Out of scope, deliberately: Roman numerals ("Ⅲ" NFKC-decomposes to plain
 * "III"). Closing this reliably would require telling a genuine Roman
 * numeral apart from an ordinary English word made entirely of the letters
 * I/V/X/L/C/D/M — and some common words pass the standard strict Roman
 * numeral grammar outright (e.g. "mix" parses as M + IX = 1009). Adding
 * Roman numeral parsing would trade a rare, low-severity gap for a much
 * more common false-positive class that breaks ordinary prose, which is a
 * worse failure mode for a hard-rule gate than the gap itself. Left closed
 * only to digits and spelled-out words.
 */

const NUMERAL_PATTERN = /-?\d+(?:\.\d+)?(?!\d)/g;
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
 * Vulgar fraction code points mapped to `[numerator, denominator]`. Covers
 * the Latin-1 block (¼ ½ ¾) and the Number Forms block (U+2150-U+215E).
 * U+215F (⅟, "fraction numerator one") is deliberately omitted: it's not a
 * complete fraction by itself.
 */
const VULGAR_FRACTIONS: ReadonlyMap<number, readonly [number, number]> =
  new Map([
    [0x00bc, [1, 4]], // ¼
    [0x00bd, [1, 2]], // ½
    [0x00be, [3, 4]], // ¾
    [0x2150, [1, 7]], // ⅐
    [0x2151, [1, 9]], // ⅑
    [0x2152, [1, 10]], // ⅒
    [0x2153, [1, 3]], // ⅓
    [0x2154, [2, 3]], // ⅔
    [0x2155, [1, 5]], // ⅕
    [0x2156, [2, 5]], // ⅖
    [0x2157, [3, 5]], // ⅗
    [0x2158, [4, 5]], // ⅘
    [0x2159, [1, 6]], // ⅙
    [0x215a, [5, 6]], // ⅚
    [0x215b, [1, 8]], // ⅛
    [0x215c, [3, 8]], // ⅜
    [0x215d, [5, 8]], // ⅝
    [0x215e, [7, 8]], // ⅞
  ]);

function fractionDecimalString(numerator: number, denominator: number): string {
  // toFixed(10) then round-trip through Number strips float noise (e.g.
  // 1/3 -> "0.3333333333" not "0.3333333333333333"); EPSILON below still
  // covers the residual rounding error when comparing against the input.
  return String(Number((numerator / denominator).toFixed(10)));
}

/**
 * Converts vulgar fraction characters ("½", "¾", "⅓", ...) to their decimal
 * value as plain ASCII digits, *before* NFKC runs. NFKC's compatibility
 * decomposition turns "½" into three separate characters — "1", U+2044
 * FRACTION SLASH, "2" — which left alone reads as the two unrelated numbers
 * 1 and 2, not 0.5. Also collapses a literal "a⁄b" fraction-slash form,
 * whether the model wrote it directly or NFKC would otherwise produce it.
 */
export function normalizeVulgarFractions(text: string): string {
  let out = "";
  for (const ch of text) {
    const frac = VULGAR_FRACTIONS.get(ch.codePointAt(0)!);
    out += frac ? fractionDecimalString(frac[0], frac[1]) : ch;
  }
  return out.replace(/(\d+)⁄(\d+)/g, (_all, n: string, d: string) =>
    fractionDecimalString(Number(n), Number(d)),
  );
}

/**
 * Folds any Unicode representation of a decimal digit to ASCII `0`-`9`, and
 * vulgar fractions to their decimal value first (see
 * `normalizeVulgarFractions`). NFKC handles fullwidth and super/subscript
 * digit forms (they have compatibility decompositions); the explicit
 * `Nd`-block table handles scripts that don't decompose to ASCII
 * (Arabic-Indic, Devanagari, ...). Everything else in the string passes
 * through unchanged.
 */
export function normalizeUnicodeDigits(text: string): string {
  const nfkc = normalizeVulgarFractions(text).normalize("NFKC");
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

const STRING_TOKEN_PATTERN = /[A-Za-z0-9]+/g;

/**
 * The alphanumeric tokens in a single string, preserving original casing —
 * e.g. `"G502 X"` -> `{"G502", "X"}`. A building block for callers to
 * explicitly declare which *display* fields of their input feed the
 * no-new-numerals exemption (see `isExemptToken` below); it is deliberately
 * NOT recursive over an arbitrary object, because a field like a kebab-case
 * `slug` (e.g. `"logitech-g502-x"`, from `slugify` in
 * `src/server/catalogue/seed-rows.ts`) is an internal identifier that never
 * appears in prose a model writes — walking every string leaf used to pull
 * its lowercase `"g502"` into the exempt set for free, silently defeating
 * the exact-case check in `isExemptToken` for every model with digits in its
 * name. Callers gather tokens field-by-field instead — see
 * `src/server/analysis/analyse.ts`'s `collectExemptTokens`.
 *
 * FINDING 4: casing is preserved (not lowercased), and matching is
 * exact-case in `isExemptToken`, so only a token that reproduces the input's
 * own casing — the way a model naming a real product actually does ("G502",
 * "MX Master 3S") — is exempt. A lowercased "g502" used as a plain quantity
 * must not ride the product-name exemption just because "G502" appears
 * somewhere in the input.
 */
export function stringTokens(text: string): Set<string> {
  return new Set(text.match(STRING_TOKEN_PATTERN) ?? []);
}

export interface NumeralToken {
  value: number;
  /** True when written as a percentage — `"90%"`, `"90 %"`, or `"ninety percent"`. */
  percent: boolean;
}

const TOKEN_CHAR = /[A-Za-z0-9]/;

/**
 * The full alphanumeric token surrounding `text[start:end)` — e.g. for the
 * digit run "502" inside "G502mm", extending outward over contiguous
 * letters/digits gives "G502mm". Exported for direct testing; used by
 * `matchDigitNumerals` to decide whether a digit run is glued to a verbatim
 * input token rather than free-standing in prose.
 */
export function surroundingToken(
  text: string,
  start: number,
  end: number,
): string {
  let s = start;
  let e = end;
  while (s > 0 && TOKEN_CHAR.test(text[s - 1]!)) s--;
  while (e < text.length && TOKEN_CHAR.test(text[e]!)) e++;
  return text.slice(s, e);
}

/**
 * True when `token` should be exempt from numeral extraction because it —
 * as a *whole* — appears verbatim, exact-case, among the input's string
 * tokens. Requiring a letter rules out exempting a bare number ("125") just
 * because that digit sequence happens to also appear inside some unrelated
 * input string; only a token that mixes letters and digits (a product name,
 * slug fragment, or version string) can be exempt.
 *
 * FINDING 4: case-sensitive on purpose. A model naming a real product
 * reproduces the input's own casing ("G502", "MX Master 3S"); a lowercased
 * "g502" used as a plain quantity ("roughly g502 mm of clearance") is not
 * the same token and must not ride the product-name exemption.
 */
function isExemptToken(
  token: string,
  exemptTokens: ReadonlySet<string>,
): boolean {
  return /[A-Za-z]/.test(token) && exemptTokens.has(token);
}

/**
 * Digit-based numeral tokens, Unicode-digit-normalised, with percent
 * detection.
 *
 * FINDING 1 (formerly a bypass, now fixed): this used to run against
 * `/(?<![\w.])-?\d+(?:\.\d+)?(?!\d)/g` — a negative lookbehind that skipped
 * any digit run glued to a preceding letter. That lookbehind existed to
 * stop product names like "G502" or "MX Master 3S" from being misread as
 * new numbers, but its side effect was worse than the problem: a digit run
 * glued to ordinary prose ("about68mm", "roughly7fingers") was skipped
 * entirely — not normalized, not rejected, just invisible — so a model
 * could invent a number by gluing it to any letter.
 *
 * The fix separates the two cases instead of conflating them via a blanket
 * lookbehind: `exemptTokens` (built with `stringTokens` over specific
 * display-name fields of the *input* — see `analyse.ts`'s
 * `collectExemptTokens` — and passed in by `findUnknownNumeral`/callers)
 * holds every alphanumeric token that appeared verbatim in one of those
 * fields. A digit run is skipped only when its full surrounding token
 * matches one of those verbatim tokens exact-case (`isExemptToken`, Finding
 * 2) — i.e. it's part of a product name we sent the model, not a new claim.
 * Everything else, including a digit glued to unrelated prose, is extracted
 * and checked like any other numeral. Do not reintroduce a bare lookbehind
 * here — it silently reopens this hole.
 */
function matchDigitNumerals(
  text: string,
  exemptTokens: ReadonlySet<string> = new Set(),
): NumeralToken[] {
  const normalized = normalizeUnicodeDigits(text);
  const tokens: NumeralToken[] = [];
  for (const match of normalized.matchAll(NUMERAL_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (exemptTokens.size > 0) {
      // `NUMERAL_PATTERN`'s leading `-?` can make `start` point at a "-"
      // that is a separator (e.g. in a slug), not a minus sign. Surrounding
      // this text is a job for `surroundingToken`, which contract-wise
      // expects [start:end) to already sit within the alphanumeric token —
      // step past a leading "-" first so it never gets absorbed into the
      // returned token.
      const tokenStart = normalized[start] === "-" ? start + 1 : start;
      const token = surroundingToken(normalized, tokenStart, end);
      if (isExemptToken(token, exemptTokens)) continue;
    }
    const value = Number.parseFloat(match[0]);
    const after = normalized.slice(end);
    tokens.push({ value, percent: /^\s*%/.test(after) });
  }
  return tokens;
}

/**
 * Pulls numeric tokens out of free text — "125", "125.0" and "125mm" alike.
 * `exemptTokens` (see `stringTokens`) protects verbatim display-name tokens
 * like product names ("G502") from being misread as new numbers; omit it to
 * check every digit run unconditionally.
 */
export function extractNumerals(
  text: string,
  exemptTokens: ReadonlySet<string> = new Set(),
): number[] {
  return matchDigitNumerals(text, exemptTokens).map((t) => t.value);
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

/** Multiplier words that are themselves a number, not a scale. `third` and
 * `quarter` are handled separately below (`FRACTION_WORDS`) — they carry an
 * ordinal/fraction ambiguity none of these do. */
const MULTIPLIER_WORDS: Record<string, number> = {
  half: 0.5,
  couple: 2,
  double: 2,
  twice: 2,
  triple: 3,
  thrice: 3,
  quadruple: 4,
  dozen: 12,
};

/**
 * FINDING 3 (collapsed to one strict rule — two prior redesigns each leaked
 * a different way). `third` and `quarter` are each both a fraction word ("a
 * third of the width", "two-thirds of users") and an ordinary ordinal/count
 * word ("the third pick", "third place"). Earlier attempts:
 *
 * - treated ordinal as the default, recognising a fraction only directly
 *   after "a"/"an"/"one" — so "roughly third of the palm width" silently
 *   stopped being checked at all;
 * - then defaulted to fraction but exempted on *either* an ordinal
 *   determiner before *or* a result noun after — the determiner-before half
 *   ignored what followed ("the third **of** the palm width" was still
 *   exempted), and the noun-after half tokenizes away punctuation, so a
 *   result noun starting the *next sentence* exempted a bare fraction
 *   ("It covers roughly third. Pick something else.").
 *
 * Hard rule 2 is asymmetric: a false positive here costs one retry, or at
 * worst a fall back to the deterministic answer — the user still gets a
 * correct output. A false negative lets an invented number reach the user.
 * So this defaults `third`/`quarter` (and their plurals) to their fraction
 * value, and exempts ordinal usage under exactly ONE rule, both halves of
 * which must hold: an ordinal determiner (`the`/`your`/`its`/a possessive)
 * is the immediately PRECEDING word, AND the immediately FOLLOWING word is
 * not "of" — see `isOrdinalUsage`. Requiring the determiner rules out bare
 * fractions ("a third", "roughly third"); excluding a following "of" rules
 * out the genitive-fraction phrasing ("the third of the palm width") that a
 * determiner alone would otherwise wrongly wave through. There is no longer
 * a result-noun carve-out, so nothing after the word can exempt it (except
 * ruling out "of") — that closes the cross-sentence leak above outright,
 * since what follows can now only narrow the exemption, never grant it.
 * Anything else, including "roughly third of the palm width" and
 * "two-thirds of users", is treated as a fraction and left to flag if it
 * doesn't trace back to the input, per the fail-toward-flagging rule above.
 * Accepted cost: a determiner-less phrasing like "third mouse" now flags
 * too — a retry, not a wrong answer. ("the third mouse" and a bare "the
 * third" still pass: the determiner is what the rule looks for.)
 *
 * Plural forms ("thirds", "quarters") are *always* fractions — English has
 * no ordinal use of the bare plural ("the thirds pick" isn't a phrase a
 * person writes — see `FRACTION_PLURAL_WORDS`). A plural directly preceded
 * by a spelled-out cardinal combines with it ("two thirds" -> 2 * 1/3),
 * matching the ordinary English reading of the compound; the hyphen in
 * "two-thirds" is not a token character (`WORD_TOKEN_PATTERN` is
 * letters-only), so it already tokenizes as "two", "thirds".
 *
 * `fifth` and `eighth` have the same ordinal/fraction ambiguity in
 * principle, but neither is in `FRACTION_WORDS` today — they're plain words
 * with no numeric meaning here. Deliberately not adding them: doing so
 * would only add new bypass surface (another way to smuggle in 0.2 or
 * 0.125) for no current requirement to check "a fifth"/"an eighth" style
 * phrasing.
 */
const FRACTION_WORDS: Record<string, number> = {
  third: 1 / 3,
  quarter: 1 / 4,
};

const FRACTION_PLURAL_WORDS: Record<string, number> = {
  thirds: 1 / 3,
  quarters: 1 / 4,
};

/** Ordinal determiners that, directly before `third`/`quarter` and not
 * directly followed by "of", mark ordinal usage ("the third pick", "your
 * third option"). Deliberately not including "a"/"an"/"one" — those precede
 * genuine fraction usage too ("a third of the width"), so they carry no
 * disambiguating signal here. */
const ORDINAL_DETERMINERS: ReadonlySet<string> = new Set([
  "the",
  "your",
  "its",
  "my",
  "his",
  "her",
  "their",
  "our",
]);

/**
 * True when `tokens[index]` (a `third`/`quarter` occurrence) reads as an
 * ordinal ("the third pick") rather than a fraction ("the third of the
 * width"). Requires ALL of: an ordinal determiner immediately before, no
 * sentence-boundary punctuation between that determiner and this word (see
 * `boundaryBeforeToken` / the comment above `WORD_TOKEN_PATTERN`), and the
 * immediately following word not being "of". See the comment above
 * `FRACTION_WORDS` for the full rationale.
 */
function isOrdinalUsage(
  tokens: readonly string[],
  index: number,
  boundaryBeforeToken: readonly boolean[],
): boolean {
  const before = tokens[index - 1];
  const after = tokens[index + 1];
  return (
    before !== undefined &&
    !boundaryBeforeToken[index] &&
    ORDINAL_DETERMINERS.has(before) &&
    after !== "of"
  );
}

/**
 * FIXED GAP (was `KNOWN GAP` in earlier revisions of this file): matching
 * only `[a-z]+` discards ALL punctuation, so a naive adjacency check on the
 * resulting word list can't tell "the third" (one clause) from "...the.
 * Third..." (a determiner ending one sentence, immediately followed by an
 * unrelated word starting the next) — both tokenize to the identical
 * ["the","third"] pair. `isOrdinalUsage`'s determiner-before half used to
 * trust that adjacency blindly, so a sentence-ending determiner wrongly
 * exempted a fraction word that only *looked* adjacent to it, e.g. "Bring
 * the. Third mm of clearance is available." read as if "the" immediately
 * preceded "third" and waved the fraction through unchecked.
 *
 * Fix: `extractWordNumerals` keeps this same letters-only token list (still
 * used everywhere else — cardinal-run accumulation, the "after" check, etc.
 * — completely unchanged) but separately walks the ORIGINAL text with
 * `matchAll` to record each match's position, and computes
 * `boundaryBeforeToken[i]`: true when the raw text between the end of token
 * `i-1` and the start of token `i` contains a sentence-boundary character —
 * `.`, `!`, `?`, `;`, `:`, a comma, or a newline (see
 * `SENTENCE_BOUNDARY_PATTERN`). `isOrdinalUsage` now also requires
 * `!boundaryBeforeToken[index]`, so a determiner separated from `third`/
 * `quarter` by any of those can no longer count as "immediately before" it.
 *
 * This only ever turns a previously-true "ordinal, exempt" verdict into
 * false (never the reverse — a fresh boundary can't manufacture a
 * determiner that wasn't already there) so it can only cause MORE text to
 * be flagged, never less, preserving hard rule 2's fail-toward-flagging
 * direction.
 *
 * Comma included deliberately, even though it's a weaker signal than a full
 * sentence-ender: an ordinal determiner is not fluent English with a comma
 * immediately after it ("the, third, ...") the way "the third, ..." reads
 * fine, so treating a comma as a boundary here costs nothing in the
 * legitimate-ordinal case while closing off another way punctuation could
 * be used to fake adjacency. Same one-directional argument as above: it can
 * only remove a false "ordinal" verdict, never add one.
 *
 * FIXED GAP (was ASCII-only): the boundary set above was originally the
 * literal class `[.!?;:,\n]`, which model-generated English prose can still
 * slip past with a Unicode sentence-ender it never produces in ASCII — an
 * ellipsis ("Bring the… Third mm of clearance is available.") or a
 * fullwidth/CJK/Arabic terminator, each of which reads as its own sentence
 * boundary to a person but tokenized as invisible to `[a-z]+`-only matching,
 * exactly like the ASCII case this file already closed. `\p{Terminal_
 * Punctuation}` (Unicode property, `u` flag) already covers every ASCII
 * character the old class listed plus the fullwidth/CJK/Arabic marks this
 * fix targets (verified directly in node, not assumed) — `。！？；：，、` and
 * `؟؛` all match it. It does NOT cover `…` U+2026 HORIZONTAL ELLIPSIS or the
 * `\n` newline case, so both are listed explicitly alongside it. The
 * combined pattern is a strict superset of the old ASCII-only class: every
 * character the old pattern matched, the new one still matches (confirmed:
 * `.!?;:,` ⊂ `\p{Terminal_Punctuation}`, and `\n` is kept literally), so this
 * can only add boundaries, never remove one — by the one-directional
 * argument above, that can only cause MORE flagging, never less.
 *
 * Coverage is wider than the ASCII list suggests: `Terminal_Punctuation`
 * spans CJK, Arabic and Ethiopic marks (U+3002, U+FF01, U+061F, U+1362 and
 * the rest), all verified as boundaries at runtime. A sentence-ending mark
 * outside that Unicode property would still read as adjacent; none is known
 * to be missing, so this is left as-is — revisit if a real case surfaces.
 */
const WORD_TOKEN_PATTERN = /[a-z]+/g;
const SENTENCE_BOUNDARY_PATTERN = /[\n…]|\p{Terminal_Punctuation}/u;

/**
 * Parses spelled-out cardinal numbers ("twenty-five", "one hundred and
 * five") and standalone multiplier/fraction words ("half", "a dozen",
 * "double") out of free text, returning them as numeral tokens exactly like
 * `matchDigitNumerals` — so "five" is checked against the input the same way
 * "5" would be.
 */
export function extractWordNumerals(text: string): NumeralToken[] {
  const lowered = text.toLowerCase();
  const wordMatches = [...lowered.matchAll(WORD_TOKEN_PATTERN)];
  const tokens = wordMatches.map((m) => m[0]);
  // See the "FIXED GAP" comment above WORD_TOKEN_PATTERN: true at index `i`
  // means sentence-boundary punctuation separates token `i-1` from token
  // `i` in the original text, so they must not be treated as adjacent words
  // by `isOrdinalUsage`.
  const boundaryBeforeToken = wordMatches.map((match, i) => {
    if (i === 0) return true;
    const previous = wordMatches[i - 1]!;
    const gap = lowered.slice(previous.index + previous[0].length, match.index);
    return SENTENCE_BOUNDARY_PATTERN.test(gap);
  });
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

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
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
    if (Object.prototype.hasOwnProperty.call(FRACTION_WORDS, token)) {
      if (isOrdinalUsage(tokens, i, boundaryBeforeToken)) {
        // Ordinal usage ("the third pick", "a third-place finish") — not a
        // numeral. Any pending cardinal run is unrelated to it and still
        // flushed as its own token.
        flush(token);
        continue;
      }
      // A cardinal run directly before combines with the fraction ("two
      // thirds" -> 2 * 1/3); bare usage ("a third", "roughly third") is 1 *
      // the unit fraction. Either way the run is consumed here, not
      // flushed separately.
      const multiplier = inRun ? total + current : 1;
      current = 0;
      total = 0;
      inRun = false;
      results.push({
        value: multiplier * FRACTION_WORDS[token]!,
        percent: false,
      });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(FRACTION_PLURAL_WORDS, token)) {
      // Plurals are always fractions — see the comment above FRACTION_WORDS.
      const multiplier = inRun ? total + current : 1;
      current = 0;
      total = 0;
      inRun = false;
      results.push({
        value: multiplier * FRACTION_PLURAL_WORDS[token]!,
        percent: false,
      });
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
 *
 * `exemptTokens` — the verbatim alphanumeric tokens from the input's
 * *display-name* fields (see `stringTokens` and `analyse.ts`'s
 * `collectExemptTokens`) — protects product names ("G502") from being
 * misread as new numbers once a digit run glued to a letter is otherwise
 * extracted (see the comment above `matchDigitNumerals`, Finding 1). Omit it
 * to check every digit run unconditionally.
 */
export function findUnknownNumeral(
  text: string,
  allowed: ReadonlySet<number>,
  exemptTokens: ReadonlySet<string> = new Set(),
): number | null {
  for (const token of [
    ...matchDigitNumerals(text, exemptTokens),
    ...extractWordNumerals(text),
  ]) {
    if (!isAllowedToken(token, allowed)) return token.value;
  }
  return null;
}
