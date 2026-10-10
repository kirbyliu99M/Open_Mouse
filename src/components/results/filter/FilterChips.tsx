"use client";

import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import {
  emptyFilters,
  isFiltering,
  toggleOption,
  type Filters,
} from "@/lib/results/filters";
import { chipsOf } from "@/lib/results/filterLabels";
import "./filter.css";

/**
 * The applied filters as removable chips, with 「清除全部」 (a text link, the
 * secondary button). Renders nothing when no filter is chosen.
 */
export function FilterChips({
  filters,
  language,
  onChange,
}: {
  filters: Filters;
  language: UiLanguage;
  onChange: (next: Filters) => void;
}) {
  if (!isFiltering(filters)) return null;
  const copy = RESULTS_PAGE_COPY[language].filter;
  const chips = chipsOf(filters, copy);
  return (
    <div className="results-chips" lang={uiLangAttribute(language)}>
      <ul className="results-chips-list" aria-label={copy.chipsLabel}>
        {chips.map((chip) => (
          <li key={`${chip.group}:${chip.value}`}>
            <button
              type="button"
              className="results-chip"
              aria-label={copy.removeChip(chip.label)}
              onClick={() =>
                onChange(toggleOption(filters, chip.group, chip.value))
              }
            >
              <span>{chip.label}</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M3 3l8 8M11 3l-8 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="results-textLink"
        onClick={() => onChange(emptyFilters())}
      >
        {copy.clearAll}
      </button>
    </div>
  );
}
