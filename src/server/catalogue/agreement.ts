/**
 * Agreement metrics for the M1 rubric gate. Pure: callers supply
 * (predicted, actual) pairs and an ordered scale.
 */

export interface Agreement {
  n: number;
  exact: number;
  withinOne: number;
  coarse: number | null;
  confusion: Record<string, Record<string, number>>;
}

export function agreement<T extends string>(
  pairs: ReadonlyArray<{ predicted: T; actual: T }>,
  scale: readonly T[],
  coarse?: (level: T) => string | boolean,
): Agreement {
  const confusion: Record<string, Record<string, number>> = {};
  let exact = 0;
  let withinOne = 0;
  let coarseHits = 0;
  for (const { predicted, actual } of pairs) {
    const p = scale.indexOf(predicted);
    const a = scale.indexOf(actual);
    if (p < 0 || a < 0) {
      throw new RangeError(`Level not on scale: ${p < 0 ? predicted : actual}`);
    }
    if (p === a) exact++;
    if (Math.abs(p - a) <= 1) withinOne++;
    if (coarse && coarse(predicted) === coarse(actual)) coarseHits++;
    (confusion[actual] ??= {})[predicted] =
      (confusion[actual]?.[predicted] ?? 0) + 1;
  }
  const n = pairs.length;
  const rate = (k: number) => (n === 0 ? 0 : k / n);
  return {
    n,
    exact: rate(exact),
    withinOne: rate(withinOne),
    coarse: coarse ? rate(coarseHits) : null,
    confusion,
  };
}
