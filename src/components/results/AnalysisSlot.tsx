import type { AnalysisSource } from "@/lib/contracts/analysis";
import type { Locale } from "@/lib/contracts/locale";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import type { AnalysisState } from "./analysisState";
import { joinHeadlineAndBody } from "./format";

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
 * words "fallback", "Gemini", "LLM" or "model" in that note.
 *
 * The other half of the same honesty (Kirby, 2026-10-11 and 10-12): when
 * `response.source === "model"` (the only value that means a model wrote the
 * text, cached or not) a small label "Written analysis" with a generic
 * four-point star (not any vendor's own mark) sits above the heading, and a
 * visible line under the text says an AI wrote it and it is for reference
 * only. Both follow the page language. Fallback text, loading, error and
 * idle show neither, and no vendor name appears anywhere in the page text.
 */
export function AnalysisSlot({
  state,
  onRetry,
  headingLevel = 2,
  language,
}: {
  state: AnalysisState;
  onRetry?: () => void;
  /** Picks the label and notice for model text (the only strings here that follow the locale). */
  language: Locale;
  /** 3 when the slot sits under an h2 section's own h3s (inside Details). */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const SubHeading = headingLevel === 2 ? "h3" : "h4";
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
      {showAiMark(source) && (
        <div className="results-analysis-labelRow">
          <p className="results-eyebrow">
            {RESULTS_PAGE_COPY[language].analysisLabel}
          </p>
          <AiStar />
        </div>
      )}
      <Heading className="results-analysis-heading">Why this one</Heading>
      <p>{joinHeadlineAndBody(output.headline, output.whyTopPick)}</p>
      {output.tradeoffs.length > 0 && (
        <div>
          <SubHeading>Tradeoffs</SubHeading>
          <ul>
            {output.tradeoffs.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {output.whatToAvoid.length > 0 && (
        <div>
          <SubHeading>What to avoid</SubHeading>
          <ul>
            {output.whatToAvoid.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {showAiMark(source) && (
        <p className="results-analysis-aiNotice">
          {RESULTS_PAGE_COPY[language].aiWrittenNotice}
        </p>
      )}
      {source === "fallback" && (
        <p className="results-analysis-provenance" role="status">
          <InfoIcon />
          Generated automatically from your scores above.
        </p>
      )}
      {output.caveats.length > 0 && (
        <p className="results-analysis-caveats">{output.caveats.join(" ")}</p>
      )}
    </section>
  );
}

/**
 * True only for text the model wrote. Fallback (template) text must never
 * carry the label, star or notice: the contract says the UI must not present
 * it as if a model wrote it.
 */
export function showAiMark(source: AnalysisSource): boolean {
  return source === "model";
}

/**
 * A generic four-point star, about 14px, in the accent text colour. Purely
 * decorative: hidden from assistive technology and with no hover title, so
 * the visible notice under the text is the only thing read, once.
 */
function AiStar() {
  return (
    <span className="results-analysis-aiStar" aria-hidden="true">
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M8 0.5C8.5 4.6 11.4 7.5 15.5 8C11.4 8.5 8.5 11.4 8 15.5C7.5 11.4 4.6 8.5 0.5 8C4.6 7.5 7.5 4.6 8 0.5Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

/** A plain circled-"i" mark for the provenance note — decorative only, the
 * sentence next to it already says what it means. */
function InfoIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <rect
        x="7.3"
        y="7"
        width="1.4"
        height="4.5"
        rx="0.7"
        fill="currentColor"
      />
      <rect
        x="7.3"
        y="4"
        width="1.4"
        height="1.4"
        rx="0.7"
        fill="currentColor"
      />
    </svg>
  );
}
