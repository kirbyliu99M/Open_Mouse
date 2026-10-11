/**
 * Typed hand length and width (manual entry, candidate 2026-10-12): parsing,
 * validation and the submission payload. Pure, no React, no network.
 *
 * The user types centimetres with one decimal; everything inside is whole
 * millimetres (one decimal of a centimetre IS a whole millimetre, so the
 * conversion is exact and never goes through floating point). The limits are
 * the contract's own (`MANUAL_ENTRY`), read, never copied. The words for each
 * problem live in `src/lib/copy/manualEntry.ts`; this module only says WHAT is
 * wrong and the numbers that matter (the allowed range, the width that fits
 * the typed length) so the copy can say it in either language.
 */
import {
  estimatePalmLengthMm,
  MANUAL_ENTRY,
  manualEntryEvidenceSchema,
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
  type ManualEntryEvidence,
  type ScanSubmission,
} from "../contracts/measurement";
import type { ManualEntryCopy } from "../copy/manualEntry";

export type ManualHand = "left" | "right";
export type ManualGrip = "palm" | "claw" | "fingertip";

// ── Parsing ─────────────────────────────────────────────────────────────────

export type CentimetreParse =
  | { readonly ok: true; readonly mm: number }
  | {
      readonly ok: false;
      readonly problem: "empty" | "notNumber" | "tooManyDecimals";
    };

/**
 * A typed centimetre string to whole millimetres. Accepts a point or a comma
 * as the decimal mark, full-width digits and marks (a Chinese input method
 * types "１８．５"; its full stop "。" counts too), and surrounding spaces; at
 * most one decimal (zeros after it are fine: "18.50" is 18.5); a mark needs a
 * digit after it ("18." and "18," are unfinished); at most three integer
 * digits; no sign, no exponent, no unit. "18.55" is refused rather
 * than rounded: the person typed a precision the form does not take.
 */
export function parseCentimetres(raw: string): CentimetreParse {
  // NFKC turns full-width digits and marks into ASCII; the ideographic full
  // stop (the "." key of a Chinese input method) it leaves alone.
  const text = raw
    .normalize("NFKC")
    .replace(/\u3002/g, ".")
    .trim();
  if (text === "") return { ok: false, problem: "empty" };
  // "18." and "18," are not finished numbers: a decimal mark needs a digit.
  const match = /^(\d{1,3})(?:[.,](\d+))?$/.exec(text);
  if (!match) return { ok: false, problem: "notNumber" };
  const decimals = match[2] ?? "";
  // One decimal; zeros after it say nothing more ("18.50" is 18.5, "18.55" is not).
  if (decimals.length > 1 && !/^0+$/.test(decimals.slice(1)))
    return { ok: false, problem: "tooManyDecimals" };
  return {
    ok: true,
    mm: Number(match[1]) * 10 + (decimals === "" ? 0 : Number(decimals[0])),
  };
}

/** Millimetres as the text the form shows: 185 is "18.5". Exact for whole mm. */
export function formatCentimetres(mm: number): string {
  return (mm / 10).toFixed(1);
}

// ── Validation ──────────────────────────────────────────────────────────────

/** Whether a width fits a length, by the same division the contract does. */
function widthFitsLength(lengthMm: number, widthMm: number): boolean {
  const ratio = widthMm / lengthMm;
  return (
    ratio >= MANUAL_ENTRY.widthOverLengthBand.min &&
    ratio <= MANUAL_ENTRY.widthOverLengthBand.max
  );
}

/**
 * The widths (whole mm) the contract accepts for a typed length: inside the
 * width range AND inside the width / length band. Found by walking the range
 * with the contract's own comparison, so the numbers shown in a message are
 * exactly the numbers the schema accepts.
 */
export function widthRangeForLength(lengthMm: number): {
  readonly minMm: number;
  readonly maxMm: number;
} | null {
  let minMm: number | null = null;
  let maxMm: number | null = null;
  for (
    let mm = MANUAL_ENTRY.handWidthRangeMm.min;
    mm <= MANUAL_ENTRY.handWidthRangeMm.max;
    mm += 1
  ) {
    if (!widthFitsLength(lengthMm, mm)) continue;
    minMm ??= mm;
    maxMm = mm;
  }
  return minMm === null || maxMm === null ? null : { minMm, maxMm };
}

export type FieldProblem =
  | { readonly code: "empty" }
  | { readonly code: "notNumber" }
  | { readonly code: "tooManyDecimals" }
  | {
      /** Outside the contract's own range for this field. */
      readonly code: "outOfRange";
      readonly side: "low" | "high";
      readonly minMm: number;
      readonly maxMm: number;
    }
  | {
      /** In range, but not a width that goes with the typed length. */
      readonly code: "widthVsLength";
      readonly side: "narrow" | "wide";
      readonly lengthMm: number;
      readonly minMm: number;
      readonly maxMm: number;
    };

export interface FieldCheck {
  /** The value in whole mm; null while there is a problem. */
  readonly mm: number | null;
  readonly problem: FieldProblem | null;
}

function parsed(raw: string): FieldCheck | number {
  const result = parseCentimetres(raw);
  return result.ok
    ? result.mm
    : { mm: null, problem: { code: result.problem } };
}

export function checkHandLength(raw: string): FieldCheck {
  const value = parsed(raw);
  if (typeof value !== "number") return value;
  const { min, max } = MANUAL_ENTRY.handLengthRangeMm;
  if (value < min || value > max) {
    return {
      mm: null,
      problem: {
        code: "outOfRange",
        side: value < min ? "low" : "high",
        minMm: min,
        maxMm: max,
      },
    };
  }
  return { mm: value, problem: null };
}

/**
 * `lengthMm` is the typed length when it is valid, else null: the width is then
 * judged on its own range only (there is nothing to compare it with yet).
 */
export function checkHandWidth(
  raw: string,
  lengthMm: number | null,
): FieldCheck {
  const value = parsed(raw);
  if (typeof value !== "number") return value;
  const { min, max } = MANUAL_ENTRY.handWidthRangeMm;
  if (value < min || value > max) {
    return {
      mm: null,
      problem: {
        code: "outOfRange",
        side: value < min ? "low" : "high",
        minMm: min,
        maxMm: max,
      },
    };
  }
  if (lengthMm !== null && !widthFitsLength(lengthMm, value)) {
    const allowed = widthRangeForLength(lengthMm);
    if (allowed) {
      return {
        mm: null,
        problem: {
          code: "widthVsLength",
          side: value < allowed.minMm ? "narrow" : "wide",
          lengthMm,
          minMm: allowed.minMm,
          maxMm: allowed.maxMm,
        },
      };
    }
  }
  return { mm: value, problem: null };
}

export interface ManualEntryCheck {
  readonly length: FieldCheck;
  readonly width: FieldCheck;
  /** Both fields hold a valid value (the hand is chosen separately). */
  readonly valid: boolean;
}

export function checkManualEntry(
  lengthText: string,
  widthText: string,
): ManualEntryCheck {
  const length = checkHandLength(lengthText);
  const width = checkHandWidth(widthText, length.mm);
  return { length, width, valid: length.mm !== null && width.mm !== null };
}

/**
 * What the person has typed so far, kept by a parent so a sheet that closes by
 * accident (a stray tap on the dimmed page, a swipe) does not lose it.
 */
export interface ManualEntryDraft {
  readonly hand: ManualHand | null;
  readonly lengthText: string;
  readonly widthText: string;
}

export const EMPTY_DRAFT: ManualEntryDraft = {
  hand: null,
  lengthText: "",
  widthText: "",
};

/**
 * Where focus goes when 「使用這組數字」 is pressed and the form cannot be
 * sent: the first thing that is wrong, in the order the form shows them (hand,
 * length, width). Null when nothing is wrong.
 */
export function firstProblemTarget(
  draft: ManualEntryDraft,
): "hand" | "length" | "width" | null {
  if (draft.hand === null) return "hand";
  const check = checkManualEntry(draft.lengthText, draft.widthText);
  if (check.length.problem) return "length";
  if (check.width.problem) return "width";
  return null;
}

/** The sentence for a field's problem, in the language of `copy`. */
export function fieldProblemMessage(
  copy: ManualEntryCopy,
  field: "length" | "width",
  problem: FieldProblem,
): string {
  const errors = copy.errors;
  switch (problem.code) {
    case "empty":
      return field === "length" ? errors.lengthEmpty : errors.widthEmpty;
    case "notNumber":
      return errors.notNumber;
    case "tooManyDecimals":
      return errors.tooManyDecimals;
    case "outOfRange": {
      const min = formatCentimetres(problem.minMm);
      const max = formatCentimetres(problem.maxMm);
      return field === "length"
        ? errors.lengthRange(min, max)
        : errors.widthRange(min, max);
    }
    case "widthVsLength": {
      const length = formatCentimetres(problem.lengthMm);
      const min = formatCentimetres(problem.minMm);
      const max = formatCentimetres(problem.maxMm);
      return problem.side === "narrow"
        ? errors.widthNarrowForLength(length, min, max)
        : errors.widthWideForLength(length, min, max);
    }
  }
}

// ── The payload ─────────────────────────────────────────────────────────────

export interface ManualEntryInput {
  readonly hand: ManualHand;
  /** Whole mm, from `parseCentimetres`. */
  readonly handLengthMm: number;
  readonly handWidthMm: number;
  /** Mandatory: the palm-over-hand ratio of an estimated palm tells nothing. */
  readonly grip: ManualGrip;
}

/**
 * The body POSTed to /api/scans for a typed pair. The measurements hold ONLY
 * the three numbers (hand length and width as typed, palm length estimated by
 * the contract's `estimatePalmLengthMm`); no scan-only field is ever added, so
 * a scan taken before the user chose to type never leaks into the record.
 * Throws a Zod error when the pair or the grip breaks the contract (range,
 * width / length band, missing grip), deliberately loud like the other
 * assemblers in `src/client/photo/submission.ts`: the server stays unchanged
 * and trusts only what this schema lets through.
 */
export function buildManualEntrySubmission(
  input: ManualEntryInput,
): ScanSubmission & { calibration: ManualEntryEvidence } {
  const calibration: ManualEntryEvidence = {
    method: "manual-entry",
    handLengthMm: input.handLengthMm,
    handWidthMm: input.handWidthMm,
    palmLengthEstimated: true,
    palmLengthRatio: MANUAL_ENTRY.palmLengthRatio,
    parallaxCorrected: false,
  };
  const parsedSubmission = scanSubmissionSchema.parse({
    hand: input.hand,
    gripStyleStated: input.grip,
    measurements: {
      handLengthMm: input.handLengthMm,
      palmLengthMm: estimatePalmLengthMm(input.handLengthMm),
      palmWidthMm: input.handWidthMm,
    },
    calibration,
    measurementModelVersion: MEASUREMENT_MODEL_VERSION,
  });
  return {
    ...parsedSubmission,
    calibration: manualEntryEvidenceSchema.parse(parsedSubmission.calibration),
  };
}
