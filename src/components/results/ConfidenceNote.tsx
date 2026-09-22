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
      This mouse&apos;s shape data is still being assessed, so this ranking may
      change as more of it is classified.
    </p>
  );
}
