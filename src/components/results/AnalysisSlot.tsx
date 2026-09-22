import type { AnalysisState } from "./analysisState";

/**
 * Optional slot for the written analysis (M5 `analysisResponseSchema`). Its
 * loading, rate-limited and error states never block or hide the numeric
 * results above — every message says so explicitly, per
 * docs/design-guidelines.md's four-kinds-of-feedback rule applied to this
 * screen.
 *
 * Honest provenance (issue #30): when `response.source === "fallback"`, the
 * text was written from the fit scores by a deterministic template, not by a
 * model. The note below says exactly that, in plain words, and — per
 * docs/design-guidelines.md's "no internal vocabulary" rule — never uses the
 * words "fallback", "Gemini", "LLM" or "model" anywhere a user can see it.
 */
export function AnalysisSlot({
  state,
  onRetry,
}: {
  state: AnalysisState;
  onRetry?: () => void;
}) {
  if (state.status === "idle") return null;

  if (state.status === "loading") {
    return (
      <section
        className="results-analysis results-analysis-loading"
        role="status"
      >
        <p className="results-eyebrow">Written analysis</p>
        <p>Preparing your written analysis&hellip;</p>
      </section>
    );
  }

  if (state.status === "rateLimited") {
    return (
      <section className="results-analysis results-analysis-error" role="alert">
        <p className="results-eyebrow">Written analysis</p>
        <p>
          Too many requests right now, so we couldn&apos;t prepare the written
          analysis. Your ranked results and sub-scores above are unaffected —
          try again in a few minutes.
        </p>
        {onRetry && (
          <button
            type="button"
            className="results-analysis-retry"
            onClick={onRetry}
          >
            Try again
          </button>
        )}
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="results-analysis results-analysis-error" role="alert">
        <p className="results-eyebrow">Written analysis</p>
        <p>
          We couldn&apos;t prepare the written analysis right now. Your ranked
          results and sub-scores above are unaffected.
        </p>
        {onRetry && (
          <button
            type="button"
            className="results-analysis-retry"
            onClick={onRetry}
          >
            Try again
          </button>
        )}
      </section>
    );
  }

  const { output, source } = state.response;
  return (
    <section className="results-analysis results-analysis-ready">
      <p className="results-eyebrow">Written analysis</p>
      {source === "fallback" && (
        <p className="results-analysis-provenance" role="status">
          This was generated automatically from your scores above.
        </p>
      )}
      <h3>{output.headline}</h3>
      <p>{output.whyTopPick}</p>
      {output.tradeoffs.length > 0 && (
        <div>
          <h4>Tradeoffs</h4>
          <ul>
            {output.tradeoffs.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {output.whatToAvoid.length > 0 && (
        <div>
          <h4>What to avoid</h4>
          <ul>
            {output.whatToAvoid.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {output.caveats.length > 0 && (
        <p className="results-analysis-caveats">{output.caveats.join(" ")}</p>
      )}
    </section>
  );
}
