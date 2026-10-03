/**
 * The limits the M2 evaluator can compare readings with, read from
 * configuration and labelled CANDIDATE (未拍板). The numbers are those of the
 * old M2 gate: "repeatability <= +/-1.5 mm across 5 photos; accuracy <= +/-2 mm
 * on hand length vs. ruler". docs/PLAN.md §M2 no longer states them: Kirby
 * changed M2 on 2026-10-02 (prereg v2, docs/STATUS.md R2) to no pass/fail
 * threshold, a target of judgement correctness >= 95 % against his blind
 * good/bad labels, repeatability reported and not a threshold, and no accuracy
 * claim, because there is no ruler truth. So these limits are not the gate and
 * no document sets them now. They also never said which statistic decides them
 * (MAE? the worst photo? the 95% limits of agreement? range or half-range?),
 * so the evaluator reports every reading and chooses none. The values and the
 * code's behaviour are unchanged; only what they point to was out of date.
 */
import { z } from "zod";
import { emptyTruth } from "../learning/truth";
import { EvaluationInputError } from "./inputs";
import type { AccuracyStats, RepeatabilitySummary } from "./stats";

/**
 * The status text printed with the limits. Its words "limits from
 * docs/PLAN.md" and "awaiting the W7 pre-agreement" date from before prereg v2
 * (see the header): PLAN.md no longer states these limits. The string is left
 * as it is, because tests/unit/m2-stats.test.ts pins its wording and reports
 * print it; changing it is a behaviour change, not a comment.
 */
export const THRESHOLD_STATUS =
  "candidate (未拍板): limits from docs/PLAN.md, statistic not agreed yet; awaiting the W7 pre-agreement";

export interface Thresholds {
  readonly status: string;
  /** Accuracy limit per measurement, mm (a field without one gets no reading). */
  readonly accuracyMm: Readonly<Record<string, number>>;
  /** Repeatability limit per measurement, mm. */
  readonly repeatabilityMm: Readonly<Record<string, number>>;
}

/**
 * The old M2 gate's numbers: hand length +/-2 mm against the ruler; +/-1.5 mm
 * across 5 photos. They were in docs/PLAN.md §M2 until 2026-10-02 and are
 * superseded by prereg v2 (docs/STATUS.md R2; see the header).
 */
export const CANDIDATE_THRESHOLDS: Thresholds = {
  status: THRESHOLD_STATUS,
  accuracyMm: { handLengthMm: 2 },
  repeatabilityMm: { handLengthMm: 1.5 },
};

/** The measurements a limit can be set for: exactly those a truth file holds. */
const LIMIT_FIELDS = Object.keys(emptyTruth("P000").right);

const positiveMm = z
  .number({ error: "must be a positive number of mm" })
  .finite({ error: "must be a positive number of mm" })
  .positive({ error: "must be a positive number of mm" });
// Strict: a field name with a typo ("handLenghtMm") is an error, not a limit
// that silently applies to nothing.
const fieldLimits = z.strictObject(
  Object.fromEntries(LIMIT_FIELDS.map((f) => [f, positiveMm.optional()])),
);
const thresholdsFile = z.strictObject({
  status: z.string({ error: "must be text" }).optional(),
  accuracyMm: fieldLimits.optional(),
  repeatabilityMm: fieldLimits.optional(),
});

/** Thresholds from a JSON config file; anything the file leaves out is not limited. */
export function parseThresholds(json: unknown): Thresholds {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new EvaluationInputError(
      "The thresholds file must hold a JSON object.",
    );
  }
  const parsed = thresholdsFile.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((i) => {
      const where = i.path.length > 0 ? i.path.join(".") : "(top level)";
      if (i.code === "unrecognized_keys") {
        return `${where}: unknown key ${i.keys.map((k) => JSON.stringify(k)).join(", ")} (known: ${
          i.path.length === 0
            ? "status, accuracyMm, repeatabilityMm"
            : LIMIT_FIELDS.join(", ")
        })`;
      }
      return `${where} ${i.message}`;
    });
    throw new EvaluationInputError(
      `The thresholds file does not fit: ${issues.join("; ")}.`,
    );
  }
  const clean = (limits: Record<string, number | undefined> | undefined) =>
    Object.fromEntries(
      Object.entries(limits ?? {}).filter(
        (e): e is [string, number] => e[1] !== undefined,
      ),
    );
  return {
    status: parsed.data.status ?? THRESHOLD_STATUS,
    accuracyMm: clean(parsed.data.accuracyMm),
    repeatabilityMm: clean(parsed.data.repeatabilityMm),
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
