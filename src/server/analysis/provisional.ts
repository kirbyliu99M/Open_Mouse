/**
 * Does a piece of model prose say the ranking is provisional?
 *
 * At low confidence `analyse()` requires the `caveats` to say so (a ranking
 * that leans on unclassified shape descriptors must not read as final). The
 * check used to be the English `/provisional/i`, which a Chinese answer can
 * never pass: when the model is allowed to answer in Chinese (i18n PR3) every
 * low-confidence answer would have been retried and then replaced by the
 * fallback. This recognises the note in either language.
 *
 * Markers:
 * - English: "provisional" (and "provisionally").
 * - Chinese: 暫定 / 暂定 (provisional) and 初步 (preliminary). Deliberately
 *   NOT 暫時 / 暂时 ("for now"), 臨時 ("temporary") or 尚未驗證 / 尚未验证
 *   ("not yet validated"): they are common in ordinary sentences, and the
 *   last one is what the prompt's `rankingStatus` sentence says — copying that
 *   sentence must not satisfy the check without saying "provisional".
 *
 * A mention that is negated right before the marker ("not provisional",
 * "non-provisional", 並非暫定, 不再暫定) does not count: the caveat exists to
 * say the opposite. "not only provisional" / 不只是暫定 still count.
 *
 * For whoever writes the Chinese prompt: ask for 暫定 (or 暂定) by name, and
 * keep the Chinese `rankingStatus` sentence free of every marker above.
 */
const ENGLISH_MARKER = /provisional/giu;
const CHINESE_MARKER = /暫定|暂定|初步/gu;

/** Text just before a marker that flips its meaning. Tested on a short window. */
const ENGLISH_NEGATION =
  /(?:\bnot(?!\s+only\b)\s+|\bnever\s+|\bno longer\s+|\b(?:is|are|was|were|does|do|did)n['’]t\s+|\bnon-)(?:\w+\s+)?$/iu;
const CHINESE_NEGATION =
  /(?:不是|不再|不算|不屬於|不属于|並非|并非|沒有|没有|不|非|無|无)$/u;

const NEGATION_WINDOW = 16;

function hasUnnegatedMatch(
  text: string,
  marker: RegExp,
  negation: RegExp,
): boolean {
  for (const match of text.matchAll(marker)) {
    const before = text.slice(
      Math.max(0, match.index - NEGATION_WINDOW),
      match.index,
    );
    if (!negation.test(before)) return true;
  }
  return false;
}

export function mentionsProvisional(text: string): boolean {
  // NFKC folds fullwidth letters ("ＰＲＯＶＩＳＩＯＮＡＬ") to ASCII.
  const normalized = text.normalize("NFKC");
  return (
    hasUnnegatedMatch(normalized, ENGLISH_MARKER, ENGLISH_NEGATION) ||
    hasUnnegatedMatch(normalized, CHINESE_MARKER, CHINESE_NEGATION)
  );
}
