import type { AnalysisState } from "./gemini";

/**
 * Optional slot for the Gemini-written analysis (M5, not built). Its loading
 * and error states never block or hide the numeric results above — the
 * error message says so explicitly, per docs/design-guidelines.md's
 * four-kinds-of-feedback rule applied to this screen.
 */
export function GeminiSlot({
  state,
  onRetry,
}: {
  state: AnalysisState;
  onRetry?: () => void;
}) {
  if (state.status === "idle") return null;

  if (state.status === "loading") {
    return (
      <section className="results-gemini results-gemini-loading" role="status">
        <p className="results-eyebrow">Written analysis</p>
        <p>Preparing your personalized analysis&hellip;</p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="results-gemini results-gemini-error" role="alert">
        <p className="results-eyebrow">Written analysis</p>
        <p>
          We couldn&apos;t generate the written analysis right now. Your ranked
          results and sub-scores above are unaffected.
        </p>
        {onRetry && (
          <button type="button" className="results-gemini-retry" onClick={onRetry}>
            Try again
          </button>
        )}
      </section>
    );
  }

  const { analysis } = state;
  return (
    <section className="results-gemini results-gemini-ready">
      <p className="results-eyebrow">Written analysis</p>
      <h3>{analysis.headline}</h3>
      <p>{analysis.whyTopPick}</p>
      {analysis.tradeoffs.length > 0 && (
        <div>
          <h4>Tradeoffs</h4>
          <ul>
            {analysis.tradeoffs.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {analysis.whatToAvoid.length > 0 && (
        <div>
          <h4>What to avoid</h4>
          <ul>
            {analysis.whatToAvoid.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {analysis.caveats.length > 0 && (
        <p className="results-gemini-caveats">{analysis.caveats.join(" ")}</p>
      )}
    </section>
  );
}
