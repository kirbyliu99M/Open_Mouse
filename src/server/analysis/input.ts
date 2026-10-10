/**
 * Builds the compact JSON Gemini sees. Every number in here is engine-made
 * (fit.ts scoring output or browser-measured mm) — the LLM never computes,
 * it only writes prose about numbers that already exist. This is also the
 * source of truth `analyse.ts` checks model output against: any numeral in
 * the model's answer that doesn't trace back to a value in this object is a
 * no-new-numerals violation.
 */
import { isLowConfidence } from "../../components/results/format";
import type { FitBand } from "../../lib/contracts/fit-bands";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import { en as bandCopy } from "../../lib/copy/fit-bands";
import { bandOf } from "../../lib/fit/bands";
import { ENGINE_IS_PROVISIONAL } from "../fit/coefficients";
import type {
  FitEntry,
  FitResponse,
  ReasonCode,
  Subscore,
} from "../../lib/contracts/fit";

export interface AnalysisInputSubscore {
  score: number | null;
  /** Where the score falls; `null` for an unrated sub-score (not a band). */
  band: FitBand | null;
  reasonCode: ReasonCode;
  /**
   * What the reason means for how the mouse feels in use, from the fit-band
   * copy (candidate wording, 未拍板). English, because the prompt is English;
   * carries no digit, so it adds no numeral to what the model may repeat.
   */
  impact: string;
  params: Record<string, number>;
}

export interface AnalysisInputEntry {
  rank: number;
  slug: string;
  brand: string;
  model: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightG: number | null;
  total: number;
  /** The band `total` falls in (`../../lib/fit/bands`; thresholds are candidates). */
  band: FitBand;
  /** What that band means for using the mouse. English, no digit. */
  bandMeaning: string;
  confidencePercent: number;
  /**
   * Decided on the raw 0..1 confidence with the results UI's own threshold,
   * so the prose and the page can never disagree about "provisional" near
   * the boundary (a rounded percent could land either side of it).
   */
  lowConfidence: boolean;
  subscores: Record<Subscore, AnalysisInputSubscore>;
}

export interface AnalysisInput {
  rankingProvisional: boolean;
  /**
   * One caveat that goes with any band: an estimate, method still being tuned.
   * English, no digit.
   */
  estimateNote: string;
  gripStyle: FitResponse["gripStyle"];
  targets: FitResponse["targets"];
  /** Only the hand numbers guaranteed present on every submission. */
  hand: {
    handLengthMm: number;
    palmLengthMm: number;
    palmWidthMm: number;
  };
  /**
   * Who was left out and why. Deliberately without `total`: an excluded
   * wrong_hand entry may carry one in the fit response, but the prompt never
   * sends it, and every number in this object becomes an allowed numeral
   * (`collectNumbers`), so copying it would widen the guard.
   */
  excluded: Pick<
    FitResponse["excluded"][number],
    "slug" | "brand" | "model" | "reason"
  >[];
  /** Up to 3, in rank order — the fit engine's own top picks. */
  topPicks: AnalysisInputEntry[];
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function twoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Under fit-v1 `gripStyle.weights` are raw floats (0.4781...). The model sees
 * them rounded to two decimals, like every other number it may restate: "0.48"
 * and "48%" (the numeral check reads a percent as value / 100) both pass, the
 * raw float is never in the input. The fit response itself is not changed.
 */
function roundedGripStyle(
  gripStyle: FitResponse["gripStyle"],
): FitResponse["gripStyle"] {
  if (!gripStyle.weights) return gripStyle;
  const { palm, claw, fingertip } = gripStyle.weights;
  return {
    ...gripStyle,
    weights: {
      palm: twoDecimals(palm),
      claw: twoDecimals(claw),
      fingertip: twoDecimals(fingertip),
    },
  };
}

/** Every reason param (mm, g, ratios) to one decimal: the engine's
 * subtractions leave float noise such as 1.4000000000000057 g otherwise. */
function roundedParams(params: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, oneDecimal(value)]),
  );
}

/** `total` is always a whole number from 0 to 100 (the contract), so it has a band. */
function bandOfTotal(total: number): FitBand {
  const band = bandOf(total);
  if (band === null) throw new RangeError("A fit total is never null.");
  return band;
}

function toInputEntry(entry: FitEntry): AnalysisInputEntry {
  const subscores = Object.fromEntries(
    Object.entries(entry.subscores).map(([key, sub]) => [
      key,
      {
        score: sub.score,
        band: bandOf(sub.score),
        reasonCode: sub.reason.code,
        impact: bandCopy.impact[sub.reason.code],
        params: roundedParams(sub.reason.params),
      } satisfies AnalysisInputSubscore,
    ]),
  ) as Record<Subscore, AnalysisInputSubscore>;
  const band = bandOfTotal(entry.total);
  return {
    rank: entry.rank,
    slug: entry.mouse.slug,
    brand: entry.mouse.brand,
    model: entry.mouse.model,
    lengthMm: oneDecimal(entry.mouse.lengthMm),
    widthMm: oneDecimal(entry.mouse.widthMm),
    heightMm: oneDecimal(entry.mouse.heightMm),
    weightG: entry.mouse.weightG,
    total: entry.total,
    band,
    bandMeaning: bandCopy.bands[band].meaning,
    confidencePercent: Math.round(entry.confidence * 100),
    lowConfidence: isLowConfidence(entry.confidence),
    subscores,
  };
}

export function buildAnalysisInput(
  fit: FitResponse,
  measurements: HandMeasurements,
): AnalysisInput {
  return {
    rankingProvisional: ENGINE_IS_PROVISIONAL,
    estimateNote: bandCopy.provisional,
    gripStyle: roundedGripStyle(fit.gripStyle),
    targets: {
      lengthMm: oneDecimal(fit.targets.lengthMm),
      gripWidthMm: oneDecimal(fit.targets.gripWidthMm),
      heightMm: oneDecimal(fit.targets.heightMm),
    },
    hand: {
      handLengthMm: oneDecimal(measurements.handLengthMm),
      palmLengthMm: oneDecimal(measurements.palmLengthMm),
      palmWidthMm: oneDecimal(measurements.palmWidthMm),
    },
    excluded: fit.excluded.map(({ slug, brand, model, reason }) => ({
      slug,
      brand,
      model,
      reason,
    })),
    topPicks: fit.results.slice(0, 3).map(toInputEntry),
  };
}
