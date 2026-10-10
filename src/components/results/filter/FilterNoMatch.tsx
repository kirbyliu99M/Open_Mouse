"use client";

import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import type { FitResponse } from "@/lib/contracts/fit";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import {
  clearGroup,
  emptyFilters,
  suggestRelaxation,
  type Filters,
} from "@/lib/results/filters";
import { useFocusFilter } from "./FilterFocus";
import "./filter.css";

/**
 * Nothing matches: one sentence and one button. The button drops a whole group
 * (`suggestRelaxation`: 「拿掉「尺寸」條件，可看到 4 款」); when no single group
 * helps, the button is 「清除全部」 alone.
 */
export function FilterNoMatch({
  response,
  filters,
  language,
  onChange,
  headingLevel,
}: {
  response: FitResponse;
  filters: Filters;
  language: UiLanguage;
  onChange: (next: Filters) => void;
  /** 1 when the page has no other h1 (no hand type). */
  headingLevel: 1 | 2;
}) {
  const copy = RESULTS_PAGE_COPY[language].filter;
  const focusFilter = useFocusFilter();
  // The button that was pressed goes with this box: focus moves to the filter.
  const change = (next: Filters) => {
    onChange(next);
    focusFilter();
  };
  const relax = suggestRelaxation(response, filters);
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section className="results-noMatch" lang={uiLangAttribute(language)}>
      <Heading className="results-noMatch-title">{copy.noMatch}</Heading>
      {relax ? (
        <button
          type="button"
          className="results-pill results-pill--small"
          onClick={() => change(clearGroup(filters, relax.group))}
        >
          {copy.relaxButton(copy.group[relax.group], relax.count)}
        </button>
      ) : (
        <button
          type="button"
          className="results-textLink"
          onClick={() => change(emptyFilters())}
        >
          {copy.clearAll}
        </button>
      )}
    </section>
  );
}
