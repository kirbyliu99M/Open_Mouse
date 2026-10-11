import type { Locale } from "@/lib/contracts/locale";
import { resultsScreensCopy } from "@/lib/copy/results-screens";
import { isLowConfidence } from "./format";

/**
 * Status note shown when a fit entry's confidence is below the threshold —
 * i.e. a meaningful share of its sub-scores are still unknown. `role="status"`
 * so a screen reader announces it without interrupting.
 */
export function ConfidenceNote({
  confidence,
  language,
}: {
  confidence: number;
  language: Locale;
}) {
  if (!isLowConfidence(confidence)) return null;

  return (
    <p className="results-confidenceNote" role="status">
      {resultsScreensCopy(language).confidenceNote}
    </p>
  );
}
