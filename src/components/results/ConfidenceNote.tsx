import { isLowConfidence } from "./format";

/**
 * Status note shown when a fit entry's confidence is below the threshold —
 * i.e. a meaningful share of its sub-scores are still unknown. `role="status"`
 * so a screen reader announces it without interrupting.
 */
export function ConfidenceNote({ confidence }: { confidence: number }) {
  if (!isLowConfidence(confidence)) return null;

  return (
    <p className="results-confidenceNote" role="status">
      We haven&apos;t assessed this mouse&apos;s shape yet. This ranking may
      change as we learn more about its shape.
    </p>
  );
}
