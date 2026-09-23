/**
 * Presentation-only formatting helpers for the results UI.
 *
 * These never invent a number the fit engine did not already produce — they
 * only format engine values (mm, grams, 0-1 confidence, 0-100 scores) for
 * display, and compute the trivial "actual minus target" delta shown next to
 * each mouse's real dimensions. That delta is not a fit-engine reason and
 * carries no scoring weight; it is the same subtraction a user could do by
 * reading the two numbers next to each other.
 */

/** Rounds to one decimal for mm display without ever showing "-0.0". */
export function formatMm(valueMm: number): string {
  const rounded = Math.round(valueMm * 10) / 10;
  const safe = rounded === 0 ? 0 : rounded;
  return `${safe.toFixed(1)} mm`;
}

/** Signed mm delta, e.g. "+2.0 mm" or "-1.5 mm", for an actual-vs-target row. */
export function formatSignedMm(deltaMm: number): string {
  const rounded = Math.round(deltaMm * 10) / 10;
  const safe = rounded === 0 ? 0 : rounded;
  const sign = safe > 0 ? "+" : "";
  return `${sign}${safe.toFixed(1)} mm`;
}

/** Actual dimension minus the engine's target, for display next to the target. */
export function dimensionDelta(actualMm: number, targetMm: number): number {
  return actualMm - targetMm;
}

/**
 * Same rounding as `formatMm`, without the "mm" suffix — for a table column
 * whose header already states the unit, so a value like "115.0" never has to
 * wrap onto a second line in a narrow cell.
 */
export function formatMmValue(valueMm: number): string {
  const rounded = Math.round(valueMm * 10) / 10;
  const safe = rounded === 0 ? 0 : rounded;
  return safe.toFixed(1);
}

/** Same rounding as `formatSignedMm`, without the "mm" suffix. */
export function formatSignedMmValue(deltaMm: number): string {
  const rounded = Math.round(deltaMm * 10) / 10;
  const safe = rounded === 0 ? 0 : rounded;
  const sign = safe > 0 ? "+" : "";
  return `${sign}${safe.toFixed(1)}`;
}

export function formatWeight(weightG: number | null): string {
  if (weightG === null) return "Weight not listed";
  return `${Math.round(weightG)} g`;
}

/** 0-1 confidence share as a whole-number percentage. */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/** 0-100 integer score, or the null case spelled out rather than shown as 0. */
export function formatScore(score: number | null): string {
  return score === null ? "Not yet assessed" : `${score}`;
}

export const LOW_CONFIDENCE_THRESHOLD = 0.6;

export function isLowConfidence(confidence: number): boolean {
  return confidence < LOW_CONFIDENCE_THRESHOLD;
}
