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
 */

const NUMERAL_PATTERN = /(?<![\w.])-?\d+(?:\.\d+)?(?!\d)/g;
const EPSILON = 1e-9;

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

/** Pulls numeric tokens out of free text — "125", "125.0" and "125mm" alike. */
export function extractNumerals(text: string): number[] {
  const matches = text.match(NUMERAL_PATTERN);
  if (!matches) return [];
  return matches.map((m) => Number.parseFloat(m));
}

function isAllowed(n: number, allowed: ReadonlySet<number>): boolean {
  for (const a of allowed) {
    if (Math.abs(a - n) < EPSILON) return true;
  }
  return false;
}

/**
 * Returns the first numeral in `text` that isn't in `allowed`, or null if
 * every numeral traces back to the input.
 */
export function findUnknownNumeral(
  text: string,
  allowed: ReadonlySet<number>,
): number | null {
  for (const n of extractNumerals(text)) {
    if (!isAllowed(n, allowed)) return n;
  }
  return null;
}
