/**
 * The M2 gate's limits, read from configuration and labelled CANDIDATE
 * (未拍板). docs/PLAN.md §M2 states them as "repeatability <= +/-1.5 mm across
 * 5 photos; accuracy <= +/-2 mm on hand length vs. ruler", but not which
 * statistic decides them (MAE? the worst photo? the 95% limits of
 * agreement? range or half-range?). That waits for the W7 pre-agreement, so
 * the evaluator reports every reading and chooses none.
 */
import { EvaluationInputError } from "./inputs";
import type { AccuracyStats, RepeatabilitySummary } from "./stats";

export const THRESHOLD_STATUS =
  "candidate (未拍板): limits from docs/PLAN.md, statistic not agreed yet; awaiting the W7 pre-agreement";

export interface Thresholds {
  readonly status: string;
  /** Accuracy limit per measurement, mm (a field without one gets no reading). */
  readonly accuracyMm: Readonly<Record<string, number>>;
  /** Repeatability limit per measurement, mm. */
  readonly repeatabilityMm: Readonly<Record<string, number>>;
}

/** docs/PLAN.md §M2: hand length +/-2 mm against the ruler; +/-1.5 mm across 5 photos. */
export const CANDIDATE_THRESHOLDS: Thresholds = {
  status: THRESHOLD_STATUS,
  accuracyMm: { handLengthMm: 2 },
  repeatabilityMm: { handLengthMm: 1.5 },
};

function limits(value: unknown, what: string): Record<string, number> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new EvaluationInputError(
      `${what} must be an object of millimetre limits.`,
    );
  }
  const out: Record<string, number> = {};
  for (const [field, limit] of Object.entries(value)) {
    if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
      throw new EvaluationInputError(
        `${what}.${field} must be a positive number of mm.`,
      );
    }
    out[field] = limit;
  }
  return out;
}

/** Thresholds from a JSON config file; anything the file leaves out is not limited. */
export function parseThresholds(json: unknown): Thresholds {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new EvaluationInputError(
      "The thresholds file must hold a JSON object.",
    );
  }
  const o = json as Record<string, unknown>;
  const known = new Set(["status", "accuracyMm", "repeatabilityMm"]);
  for (const key of Object.keys(o)) {
    if (!known.has(key))
      throw new EvaluationInputError(`Unknown key "${key}" in thresholds.`);
  }
  if (o.status !== undefined && typeof o.status !== "string") {
    throw new EvaluationInputError("thresholds.status must be text.");
  }
  return {
    status: typeof o.status === "string" ? o.status : THRESHOLD_STATUS,
    accuracyMm: limits(o.accuracyMm, "accuracyMm"),
    repeatabilityMm: limits(o.repeatabilityMm, "repeatabilityMm"),
  };
}

/** One way of reading a statistic against a limit. */
export interface Reading {
  readonly name: string;
  readonly limitMm: number;
  /** The statistic's value in mm; `null` when there are too few photos to have one. */
  readonly valueMm: number | null;
  /** `valueMm <= limitMm`; `null` when there is no value. */
  readonly withinLimit: boolean | null;
}

const reading = (
  name: string,
  limitMm: number,
  valueMm: number | null,
): Reading => ({
  name,
  limitMm,
  valueMm,
  withinLimit: valueMm === null ? null : valueMm <= limitMm,
});

/** The three readings of accuracy: mean error, worst photo, 95% limits of agreement. */
export function accuracyReadings(
  stats: AccuracyStats,
  limitMm: number,
): Reading[] {
  return [
    reading("MAE within the limit", limitMm, stats.mae),
    reading("largest |error| within the limit", limitMm, stats.maxAbsError),
    reading(
      "95% limits of agreement (bias +/- 1.96 SD) within +/- the limit",
      limitMm,
      stats.loa === null
        ? null
        : Math.max(Math.abs(stats.loa.lower), Math.abs(stats.loa.upper)),
    ),
  ];
}

/** Three readings of "+/- limit across the repeats", for the worst group. */
export function repeatabilityReadings(
  summary: RepeatabilitySummary,
  limitMm: number,
): Reading[] {
  return [
    reading(
      "worst range (max - min) within the limit",
      limitMm,
      summary.maxRange,
    ),
    reading(
      "worst half-range (range / 2) within the limit, i.e. +/- the limit",
      limitMm,
      summary.maxRange / 2,
    ),
    reading(
      "worst deviation from the group mean within the limit",
      limitMm,
      summary.maxDeviationFromMean,
    ),
  ];
}
