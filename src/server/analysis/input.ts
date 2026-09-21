/**
 * Builds the compact JSON Gemini sees. Every number in here is engine-made
 * (fit.ts scoring output or browser-measured mm) — the LLM never computes,
 * it only writes prose about numbers that already exist. This is also the
 * source of truth `analyse.ts` checks model output against: any numeral in
 * the model's answer that doesn't trace back to a value in this object is a
 * no-new-numerals violation.
 */
import type { HandMeasurements } from "../../lib/contracts/measurement";
import type {
  FitEntry,
  FitResponse,
  ReasonCode,
  Subscore,
} from "../../lib/contracts/fit";

export interface AnalysisInputSubscore {
  score: number | null;
  reasonCode: ReasonCode;
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
  confidence: number;
  subscores: Record<Subscore, AnalysisInputSubscore>;
}

export interface AnalysisInput {
  engineVersion: string;
  gripStyle: FitResponse["gripStyle"];
  targets: FitResponse["targets"];
  /** Only the hand numbers guaranteed present on every submission. */
  hand: {
    handLengthMm: number;
    palmLengthMm: number;
    palmWidthMm: number;
  };
  excluded: FitResponse["excluded"];
  /** Up to 3, in rank order — the fit engine's own top picks. */
  topPicks: AnalysisInputEntry[];
}

function toInputEntry(entry: FitEntry): AnalysisInputEntry {
  const subscores = Object.fromEntries(
    Object.entries(entry.subscores).map(([key, sub]) => [
      key,
      {
        score: sub.score,
        reasonCode: sub.reason.code,
        params: sub.reason.params,
      } satisfies AnalysisInputSubscore,
    ]),
  ) as Record<Subscore, AnalysisInputSubscore>;
  return {
    rank: entry.rank,
    slug: entry.mouse.slug,
    brand: entry.mouse.brand,
    model: entry.mouse.model,
    lengthMm: entry.mouse.lengthMm,
    widthMm: entry.mouse.widthMm,
    heightMm: entry.mouse.heightMm,
    weightG: entry.mouse.weightG,
    total: entry.total,
    confidence: entry.confidence,
    subscores,
  };
}

export function buildAnalysisInput(
  fit: FitResponse,
  measurements: HandMeasurements,
): AnalysisInput {
  return {
    engineVersion: fit.engineVersion,
    gripStyle: fit.gripStyle,
    targets: fit.targets,
    hand: {
      handLengthMm: measurements.handLengthMm,
      palmLengthMm: measurements.palmLengthMm,
      palmWidthMm: measurements.palmWidthMm,
    },
    excluded: fit.excluded,
    topPicks: fit.results.slice(0, 3).map(toInputEntry),
  };
}
