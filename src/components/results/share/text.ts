/**
 * Text fitting for the share card, pure: every function takes the measuring
 * function as an argument (a canvas's `measureText` in the browser, a fake in
 * the unit tests), so the wrapping of a long model name or a long zh-TW title
 * is tested without a canvas.
 */

export interface FontSpec {
  /** Pixels. */
  size: number;
  weight: 400 | 600 | 700 | 800;
  /** Set in the wordmark's typeface (Inter 700) instead of the site's stack. */
  brand?: boolean;
}

/** Width in pixels of `text` set in `font`. */
export type MeasureText = (text: string, font: FontSpec) => number;

const ELLIPSIS = "…";

/** CJK ideographs, kana, fullwidth forms and CJK punctuation: a line may break between any two. */
const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/u;
/** Closing marks that must not start a line (kinsoku): they stay on the line before. */
const NO_LINE_START = new Set("，。、；：！？）」』〕】》…・,.;:!?)]}");

/** Words stay whole, every CJK character stands alone, a run of spaces is one token. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let word = "";
  const flush = () => {
    if (word) tokens.push(word);
    word = "";
  };
  for (const ch of text) {
    if (CJK.test(ch)) {
      flush();
      tokens.push(ch);
    } else if (/\s/u.test(ch)) {
      flush();
      if (tokens.length && tokens[tokens.length - 1] !== " ") tokens.push(" ");
    } else {
      word += ch;
    }
  }
  flush();
  return tokens;
}

/** Break a token wider than a whole line into pieces that each fit. */
function hardBreak(
  token: string,
  maxWidth: number,
  font: FontSpec,
  measure: MeasureText,
): string[] {
  const pieces: string[] = [];
  let piece = "";
  for (const ch of token) {
    if (piece && measure(piece + ch, font) > maxWidth) {
      pieces.push(piece);
      piece = ch;
    } else {
      piece += ch;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/**
 * Greedy line breaking. Latin breaks at spaces, CJK between characters (but
 * never before a closing mark), and a single word wider than the line is cut.
 * No line is empty and none starts or ends with a space.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  font: FontSpec,
  measure: MeasureText,
): string[] {
  const lines: string[] = [];
  let line = "";
  const push = () => {
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
    line = "";
  };
  for (const token of tokenize(text)) {
    if (token === " ") {
      if (line) line += " ";
      continue;
    }
    if (
      measure(line + token, font) <= maxWidth ||
      (line && NO_LINE_START.has(token))
    ) {
      line += token;
      continue;
    }
    push();
    if (measure(token, font) <= maxWidth) {
      line = token;
    } else {
      const pieces = hardBreak(token, maxWidth, font, measure);
      for (const p of pieces.slice(0, -1)) lines.push(p);
      line = pieces[pieces.length - 1] ?? "";
    }
  }
  push();
  return lines;
}

/**
 * Break a title made of parts (`中型滑鼠`, `抓握`, `寬身`) only BETWEEN parts, so
 * a part is never split: 「中型滑鼠・抓握・」 then 「寬身」, not a lone 「身」.
 * The separator stays on the line before. A part wider than a line falls back
 * to `wrapText` for that part.
 */
export function wrapParts(
  parts: readonly string[],
  separator: string,
  maxWidth: number,
  font: FontSpec,
  measure: MeasureText,
): string[] {
  const lines: string[] = [];
  let line = "";
  parts.forEach((part, i) => {
    const piece = i < parts.length - 1 ? part + separator : part;
    if (measure((line + piece).trimEnd(), font) <= maxWidth) {
      line += piece;
      return;
    }
    if (line) lines.push(line.trimEnd());
    line = "";
    if (measure(piece.trimEnd(), font) <= maxWidth) {
      line = piece;
    } else {
      const pieces = wrapText(piece, maxWidth, font, measure);
      for (const p of pieces.slice(0, -1)) lines.push(p);
      line = pieces[pieces.length - 1] ?? "";
    }
  });
  if (line) lines.push(line.trimEnd());
  return lines;
}

/** One line that fits: the text as it is, or cut with an ellipsis. */
export function fitLine(
  text: string,
  maxWidth: number,
  font: FontSpec,
  measure: MeasureText,
): string {
  const clean = text.trim();
  if (measure(clean, font) <= maxWidth) return clean;
  const chars = Array.from(clean);
  while (chars.length > 1) {
    chars.pop();
    const candidate = chars.join("").trimEnd() + ELLIPSIS;
    if (measure(candidate, font) <= maxWidth) return candidate;
  }
  return ELLIPSIS;
}

/** At most `max` lines; if there were more, the last one ends with an ellipsis. */
export function clampLines(
  lines: readonly string[],
  max: number,
  maxWidth: number,
  font: FontSpec,
  measure: MeasureText,
): string[] {
  if (lines.length <= max) return [...lines];
  const kept = lines.slice(0, max);
  const last = kept[max - 1] ?? "";
  kept[max - 1] = fitLine(last + ELLIPSIS, maxWidth, font, measure);
  return kept;
}
