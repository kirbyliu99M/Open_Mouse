"use client";

import { useId, useState } from "react";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { AnalysisSlot } from "./AnalysisSlot";
import type { AnalysisState } from "./analysisState";

function Sparkle() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M7 2.5l1.4 3.6 3.6 1.4-3.6 1.4L7 12.5 5.6 8.9 2 7.5l3.6-1.4L7 2.5zM13.5 10.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * While the results are filtered and the large card is not the overall #1, the
 * written analysis (which is about the overall #1 and never uses the filter)
 * collapses to this one line, with 「看分析」 expanding it in place (FILTER-1,
 * candidate). `name` is the overall #1's brand and model.
 */
export function FilteredAnalysisLine({
  name,
  language,
  state,
  onRetry,
}: {
  name: string;
  language: UiLanguage;
  state: AnalysisState;
  onRetry?: () => void;
}) {
  const copy = RESULTS_PAGE_COPY[language].filter;
  const [open, setOpen] = useState(false);
  const regionId = useId();
  return (
    <div className="results-analysisLine" lang={uiLangAttribute(language)}>
      <p className="results-analysisLine-row">
        <Sparkle />
        <span className="results-analysisLine-text">
          {copy.analysisLine(name)}
        </span>
        <button
          type="button"
          className="results-textLink"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? copy.analysisHide : copy.analysisShow}
        </button>
      </p>
      <div id={regionId} hidden={!open}>
        {open && (
          <AnalysisSlot state={state} onRetry={onRetry} headingLevel={3} />
        )}
      </div>
    </div>
  );
}
