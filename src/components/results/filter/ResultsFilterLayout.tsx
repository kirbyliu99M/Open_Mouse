"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import type { FitResponse } from "@/lib/contracts/fit";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { selectedCount, type Filters } from "@/lib/results/filters";
import { FilterChips } from "./FilterChips";
import { FilterFacets } from "./FilterFacets";
import { FilterSheet } from "./FilterSheet";
import { FilterStatus } from "./FilterStatus";
import { useWideLayout } from "./useWideLayout";
import "./filter.css";

function SlidersIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2.5 5h8M13.5 5h2M2.5 13h2M7.5 13h8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle
        cx="12"
        cy="5"
        r="1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle
        cx="6"
        cy="13"
        r="1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

/**
 * Puts the filter around the results content (FILTER-1, candidate).
 *
 * 1024 CSS px and wider: a sticky sidebar next to the content, which applies
 * on every change. Narrower (this includes a desktop at 200 % zoom): a
 * 「篩選（n）」 button, the chips, 「清除全部」 and 「找到 N 款」 above the
 * content, and the facets in a bottom sheet (`FilterSheet`) that applies with
 * its footer button.
 *
 * The count the sidebar and the bar show, and every option's count, come from
 * `src/lib/results/filters.ts`; this file only places them.
 */
export function ResultsFilterLayout({
  response,
  language,
  filters,
  count,
  onChange,
  children,
}: {
  response: FitResponse;
  language: UiLanguage;
  filters: Filters;
  /** How many cards the applied filters keep. */
  count: number;
  onChange: (next: Filters) => void;
  children: ReactNode;
}) {
  const wide = useWideLayout();
  const copy = RESULTS_PAGE_COPY[language].filter;
  const lang = uiLangAttribute(language);
  const [sheetOpen, setSheetOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  const onClosed = useCallback(() => {
    setSheetOpen(false);
    // Focus goes back to the button that opened the sheet.
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);

  if (wide) {
    return (
      <div className="results-body" data-filter="sidebar">
        <aside
          className="results-sidebar"
          aria-labelledby="results-sidebar-title"
          lang={lang}
        >
          <div className="results-sidebar-head">
            <h2 id="results-sidebar-title" className="results-sidebar-title">
              {copy.title}
            </h2>
            <p className="results-sidebar-count results-tabularNum">
              {copy.found(count)}
            </p>
          </div>
          <FilterChips
            filters={filters}
            language={language}
            onChange={onChange}
          />
          <FilterFacets
            response={response}
            language={language}
            filters={filters}
            onChange={onChange}
          />
          <FilterStatus count={count} language={language} />
        </aside>
        <div className="results-main">{children}</div>
      </div>
    );
  }

  const chosen = selectedCount(filters);
  return (
    <>
      <div className="results-filterBar" data-filter="sheet" lang={lang}>
        <div className="results-filterBar-row">
          <button
            ref={trigger}
            type="button"
            className="results-filterButton"
            aria-haspopup="dialog"
            onClick={() => setSheetOpen(true)}
          >
            <SlidersIcon />
            <span>{copy.openButton(chosen)}</span>
          </button>
          <p className="results-filterBar-count results-tabularNum">
            {copy.found(count)}
          </p>
        </div>
        <FilterChips
          filters={filters}
          language={language}
          onChange={onChange}
        />
      </div>
      {!sheetOpen && <FilterStatus count={count} language={language} />}
      {sheetOpen && (
        <FilterSheet
          response={response}
          language={language}
          applied={filters}
          onApply={onChange}
          onClosed={onClosed}
        />
      )}
      {children}
    </>
  );
}
