import type { FitResponse } from "@/lib/contracts/fit";
import { AnalysisSlot } from "./AnalysisSlot";
import type { AnalysisState } from "./analysisState";
import { ExcludedList } from "./ExcludedList";
import { RankedList } from "./RankedList";
import "./results.css";
import { TopPick } from "./TopPick";
import { TopBar } from "@/components/nav/TopBar";
import { POOR_FIT_THRESHOLD } from "./fitNotice";

/**
 * Renders a `FitResponse` — the only input this component tree takes. No
 * fetching, no analysis calls: `analysisState` is handed in by the caller.
 */
export function ResultsView({
  response,
  analysisState = { status: "idle" },
  onRetryAnalysis,
  enteredLengthMm = null,
}: {
  response: FitResponse;
  analysisState?: AnalysisState;
  onRetryAnalysis?: () => void;
  /** The hand length the user typed in, when the scan used no paper. */
  enteredLengthMm?: number | null;
}) {
  return (
    <div className="results-view">
      <TopBar
        backHref="/scan/easy"
        backLabel="Scan again"
        stepLabel="Your matches"
      />
      <h1>Your best match</h1>
      {response.results[0] &&
        response.results[0].total < POOR_FIT_THRESHOLD && (
          <p className="results-fitNotice">
            None of these fits your hand well. The closest is below.
          </p>
        )}
      <TopPick response={response} />
      {enteredLengthMm !== null && (
        <p className="results-handNotice">
          Based on the hand length you entered ({enteredLengthMm}&nbsp;mm).
          Measured without paper.
        </p>
      )}
      {/* The hand comes from the fit response (#62), not from browser
          storage, so the note follows a results link to any device. */}
      {response.hand === "left" && (
        <p className="results-handNotice">
          Left-hand fit isn&apos;t rated yet — check each mouse&apos;s shape
          before you buy.
        </p>
      )}
      {/* "Why this one" sits directly after the top pick and before "Show
          the other N ranked mice" (item 5) — docs/design/journey-2026-09-23/
          04-results.png. */}
      <AnalysisSlot state={analysisState} onRetry={onRetryAnalysis} />
      <RankedList response={response} />
      <ExcludedList response={response} />
    </div>
  );
}
