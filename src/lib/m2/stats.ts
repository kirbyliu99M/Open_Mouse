/**
 * The M2 evaluator's statistics. Pure numbers in, numbers out.
 *
 * Every definition here is a CANDIDATE (未拍板): the W7 pre-agreement has not
 * fixed which statistic decides the M2 gate, so the evaluator reports several
 * and picks none. See docs/learning/README.md ("Evaluation").
 *
 * Definitions, with e = measured - truth for one photo:
 *  - bias            mean(e)
 *  - MAE             mean(|e|)
 *  - max |e|         the largest absolute error
 *  - SD              sample standard deviation of e, divided by (n - 1)
 *  - 95% LoA         Bland-Altman limits of agreement: bias +/- 1.96 * SD
 *  - repeatability   per group of repeated photos (same participant, hand,
 *                    pose, path): range = max - min, SD (n - 1), and the
 *                    largest deviation from the group mean
 */

/** Bland-Altman: the multiplier of the SD for 95% limits of agreement. */
export const LOA_Z = 1.96;

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("mean of no values");
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Sample standard deviation: divided by (n - 1). `null` for fewer than two values. */
export function sampleSd(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values);
  let squares = 0;
  for (const v of values) squares += (v - m) ** 2;
  return Math.sqrt(squares / (values.length - 1));
}

export interface AccuracyStats {
  /** Number of photos measured against the truth. */
  readonly n: number;
  /** Mean error (measured - truth), mm. */
  readonly bias: number;
  /** Mean absolute error, mm. */
  readonly mae: number;
  /** Largest absolute error, mm. */
  readonly maxAbsError: number;
  /** Sample SD of the errors (n - 1); `null` when n < 2. */
  readonly sd: number | null;
  /** Bland-Altman 95% limits of agreement, bias +/- 1.96 SD; `null` when n < 2. */
  readonly loa: { readonly lower: number; readonly upper: number } | null;
}

/** Accuracy statistics of a list of errors (measured - truth); `null` when there are none. */
export function accuracyStats(errors: readonly number[]): AccuracyStats | null {
  if (errors.length === 0) return null;
  const bias = mean(errors);
  const sd = sampleSd(errors);
  return {
    n: errors.length,
    bias,
    mae: mean(errors.map((e) => Math.abs(e))),
    maxAbsError: Math.max(...errors.map((e) => Math.abs(e))),
    sd,
    loa:
      sd === null
        ? null
        : { lower: bias - LOA_Z * sd, upper: bias + LOA_Z * sd },
  };
}

/** One group of repeated photos of the same thing. */
export interface RepeatabilityRow {
  readonly n: number;
  readonly min: number;
  readonly max: number;
  /** max - min, mm. */
  readonly range: number;
  /** Sample SD (n - 1), mm. */
  readonly sd: number;
  /** Largest |value - group mean|, mm. */
  readonly maxDeviationFromMean: number;
}

/** Repeatability of one group; `null` unless it has at least two photos. */
export function repeatabilityRow(
  values: readonly number[],
): RepeatabilityRow | null {
  if (values.length < 2) return null;
  const m = mean(values);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    n: values.length,
    min,
    max,
    range: max - min,
    sd: sampleSd(values)!,
    maxDeviationFromMean: Math.max(...values.map((v) => Math.abs(v - m))),
  };
}

export interface RepeatabilitySummary {
  /** Groups with at least two photos. */
  readonly groups: number;
  readonly meanRange: number;
  readonly maxRange: number;
  readonly meanSd: number;
  /** Within-group SD pooled over the groups: sqrt(sum((n-1) * SD^2) / sum(n-1)). */
  readonly pooledSd: number;
  readonly maxDeviationFromMean: number;
}

export function summariseRepeatability(
  rows: readonly RepeatabilityRow[],
): RepeatabilitySummary | null {
  if (rows.length === 0) return null;
  let degrees = 0;
  let weighted = 0;
  for (const r of rows) {
    degrees += r.n - 1;
    weighted += (r.n - 1) * r.sd ** 2;
  }
  return {
    groups: rows.length,
    meanRange: mean(rows.map((r) => r.range)),
    maxRange: Math.max(...rows.map((r) => r.range)),
    meanSd: mean(rows.map((r) => r.sd)),
    pooledSd: Math.sqrt(weighted / degrees),
    maxDeviationFromMean: Math.max(...rows.map((r) => r.maxDeviationFromMean)),
  };
}
