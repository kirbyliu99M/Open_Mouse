import type { FitResponse } from "@/lib/contracts/fit";
import { AnalysisSlot } from "./AnalysisSlot";
import type { AnalysisState } from "./analysisState";
import { ExcludedList } from "./ExcludedList";
import { RankedList } from "./RankedList";
import "./results.css";
import { TopPick } from "./TopPick";

/**
 * Renders a `FitResponse` — the only input this component tree takes. No
 * fetching, no analysis calls: `analysisState` is handed in by the caller.
 */
export function ResultsView({
  response,
  analysisState = { status: "idle" },
  onRetryAnalysis,
}: {
  response: FitResponse;
  analysisState?: AnalysisState;
  onRetryAnalysis?: () => void;
}) {
  return (
    <div className="results-view">
      <TopPick response={response} />
      <RankedList response={response} />
      <ExcludedList response={response} />
      <AnalysisSlot state={analysisState} onRetry={onRetryAnalysis} />
    </div>
  );
}
