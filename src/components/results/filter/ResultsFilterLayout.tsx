"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Locale } from "@/lib/contracts/locale";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import {
  selectedCount,
  type FilterSource,
  type Filters,
} from "@/lib/results/filters";
import { FilterChips } from "./FilterChips";
import { FilterFacets } from "./FilterFacets";
import { FilterFocusContext } from "./FilterFocus";
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
 * 64em (1024 CSS px at the default text size) and wider: a sticky sidebar next
 * to the content, which applies on every change. Narrower (this includes a
 * desktop at 200 % zoom): a 「篩選（n）」 button, the chips, 「清除全部」 and
 * 「找到 N 款」 above the content, and the facets in a bottom sheet
 * (`FilterSheet`) that applies with its footer button.
 *
 * `shells="switch"` (the results page, the default): a script
 * (`useWideLayout`) decides which of the two is mounted. The tree around the
 * content is the same in both layouts (only the filter's own part, keyed
 * `chrome`, is swapped), so crossing the breakpoint does not remount the
 * results: an open Details section or an expanded analysis stays. The server
 * and the first render say "phone", which is fine there because that page only
 * renders once its data has loaded in the browser.
 *
 * `shells="both"` (the all-mice page, which the server renders): both shells
 * are in the markup and CSS (a 64em media query in filter.css) shows one, so
 * the server's first paint already has the right layout, the page width does
 * not jump, and nothing is remounted (the search in `lead` stays where it is,
 * with its focus). The hidden shell is `display: none`, so it is out of the
 * reading order. The script is then only used for focus and for closing a
 * sheet that the window outgrew.
 *
 * The count the sidebar and the bar show, and every option's count, come from
 * `src/lib/results/filters.ts`; this file only places them.
 */
export function ResultsFilterLayout({
  response,
  countSource,
  language,
  filters,
  count,
  onChange,
  lead,
  shells = "switch",
  children,
}: {
  /** What the option counts and the brand list describe. */
  response: FilterSource;
  /**
   * What the sheet's 「查看 N 款」 counts instead of `response` (the all-mice
   * page: the rows its search keeps, so the button matches the list it
   * opens). Defaults to `response`.
   */
  countSource?: FilterSource;
  language: Locale;
  filters: Filters;
  /** How many cards the applied filters keep. */
  count: number;
  onChange: (next: Filters) => void;
  /**
   * Optional content that comes first: above the filter bar on a phone, at the
   * top of the content column beside the sidebar (the all-mice page's search).
   * The results page passes none.
   */
  lead?: ReactNode;
  shells?: "switch" | "both";
  children: ReactNode;
}) {
  const wide = useWideLayout();
  const both = shells === "both";
  const copy = RESULTS_PAGE_COPY[language].filter;
  const [sheetOpen, setSheetOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const sidebarTitle = useRef<HTMLHeadingElement>(null);

  const onClosed = useCallback(() => {
    setSheetOpen(false);
    // Focus goes back to the button that opened the sheet.
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);

  // Focus for a control that has just gone (a removed chip, 「清除全部」, the
  // no-match suggestion): the sidebar's title, or the phone's 篩選 button. With
  // both shells in the page, the one that is on screen.
  const focusFilter = useCallback(() => {
    requestAnimationFrame(() => {
      const target = both
        ? [sidebarTitle.current, trigger.current].find(
            (el) => el && el.getClientRects().length > 0,
          )
        : wide
          ? sidebarTitle.current
          : trigger.current;
      target?.focus();
    });
  }, [wide, both]);

  // A sheet left open when the window grows into the sidebar layout is closed
  // (its draft is discarded), so it does not come back on its own later.
  useEffect(() => {
    if (wide) setSheetOpen(false);
  }, [wide]);

  const chosen = selectedCount(filters);

  const sidebar = (key: string) => (
    <aside
      key={key}
      className="results-sidebar"
      aria-labelledby="results-sidebar-title"
    >
      <div className="results-sidebar-head">
        <h2
          id="results-sidebar-title"
          ref={sidebarTitle}
          tabIndex={-1}
          className="results-sidebar-title"
        >
          {copy.title}
        </h2>
        <p className="results-sidebar-count results-tabularNum">
          {copy.found(count)}
        </p>
      </div>
      <FilterChips filters={filters} language={language} onChange={onChange} />
      <FilterFacets
        response={response}
        language={language}
        filters={filters}
        onChange={onChange}
        startOpen={["brand", "size"]}
      />
      <FilterStatus count={count} language={language} />
    </aside>
  );

  const chrome = (key: string) => (
    <div key={key} className="results-filterChrome">
      <div className="results-filterBar">
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
          countSource={countSource}
          language={language}
          applied={filters}
          onApply={onChange}
          onClosed={onClosed}
        />
      )}
    </div>
  );

  if (both) {
    return (
      <FilterFocusContext.Provider value={focusFilter}>
        <div className="results-body" data-filter="both">
          {lead !== undefined && <div className="results-lead">{lead}</div>}
          {sidebar("sidebar")}
          {chrome("chrome")}
          <div key="main" className="results-main">
            {children}
          </div>
        </div>
      </FilterFocusContext.Provider>
    );
  }

  return (
    <FilterFocusContext.Provider value={focusFilter}>
      <div className="results-body" data-filter={wide ? "sidebar" : "sheet"}>
        {!wide && lead}
        {wide ? sidebar("chrome") : chrome("chrome")}
        <div key="main" className="results-main">
          {wide && lead}
          {children}
        </div>
      </div>
    </FilterFocusContext.Provider>
  );
}
