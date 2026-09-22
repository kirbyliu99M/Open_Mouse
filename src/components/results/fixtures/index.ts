/**
 * Fixture loader for the /results/demo route. Each raw JSON file is parsed
 * through `fitResponseSchema`, the same schema the real fit engine's output
 * must satisfy — so a fixture that drifts from the contract fails fast here
 * (and in tests/unit/results-fixtures.test.ts) rather than silently
 * rendering something the real API could never produce.
 */
import { fitResponseSchema, type FitResponse } from "@/lib/contracts/fit";
import highConfidenceRaw from "./high-confidence.json";
import lowConfidenceRaw from "./low-confidence.json";
import withExclusionsRaw from "./with-exclusions.json";

export type FixtureKey =
  "high-confidence" | "low-confidence" | "with-exclusions";

export const FIXTURES: Record<FixtureKey, FitResponse> = {
  "high-confidence": fitResponseSchema.parse(highConfidenceRaw),
  "low-confidence": fitResponseSchema.parse(lowConfidenceRaw),
  "with-exclusions": fitResponseSchema.parse(withExclusionsRaw),
};

export const FIXTURE_LABELS: Record<FixtureKey, string> = {
  "high-confidence": "High confidence",
  "low-confidence": "Low confidence (nulls)",
  "with-exclusions": "With exclusions",
};

export const FIXTURE_KEYS: FixtureKey[] = [
  "high-confidence",
  "low-confidence",
  "with-exclusions",
];
