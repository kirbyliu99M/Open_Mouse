"use client";

import { useId, useMemo, useState } from "react";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import type { FitResponse } from "@/lib/contracts/fit";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import {
  FILTER_GROUPS,
  facetCounts,
  nullCounts,
  suitableSize,
  toggleOption,
  type FacetOption,
  type FilterGroup,
  type Filters,
} from "@/lib/results/filters";
import { groupSummary, optionLabel } from "@/lib/results/filterLabels";
import "./filter.css";

function Chevron() {
  return (
    <svg
      className="results-facet-chevron"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3.5 6l4.5 4.5L12.5 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Check() {
  return (
    <svg
      className="results-facet-check"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3.5 9.5l3.5 3.5 7.5-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The five filter groups with their options and counts, shared by the desktop
 * sidebar (changes apply at once) and the phone sheet (changes go to a draft).
 * It holds no filter state of its own, only which groups are open: on mount,
 * 品牌 and every group with a choice. All numbers come from
 * `src/lib/results/filters.ts`.
 *
 * An option with no card left is `aria-disabled` but stays in the Tab order,
 * so a screen reader says its 「0 款」; it does nothing when pressed. A chosen
 * option is never disabled.
 */
export function FilterFacets({
  response,
  language,
  filters,
  onChange,
}: {
  response: FitResponse;
  language: UiLanguage;
  filters: Filters;
  onChange: (next: Filters) => void;
}) {
  const copy = RESULTS_PAGE_COPY[language].filter;
  const lang = uiLangAttribute(language);
  const prefix = useId();
  const counts = useMemo(
    () => facetCounts(response, filters),
    [response, filters],
  );
  const nulls = useMemo(
    () => nullCounts(response, filters),
    [response, filters],
  );
  const fits = suitableSize(response);

  const [open, setOpen] = useState<Record<FilterGroup, boolean>>(() => ({
    brand: true,
    size: filters.size.length > 0,
    weight: filters.weight.length > 0,
    shape: filters.shape.length > 0,
    connectivity: filters.connectivity.length > 0,
  }));
  const [moreBrands, setMoreBrands] = useState(() =>
    filters.brand.some((b) => counts.brand.rest.some((o) => o.value === b)),
  );

  const optionRow = (group: FilterGroup, option: FacetOption) => {
    const label = optionLabel(copy, group, option.value);
    const isFit = group === "size" && fits === option.value;
    return (
      <li key={option.value}>
        <label
          className="results-facet-option"
          data-selected={option.selected ? "true" : undefined}
          data-disabled={option.disabled ? "true" : undefined}
        >
          <input
            type="checkbox"
            checked={option.selected}
            aria-disabled={option.disabled ? "true" : undefined}
            aria-label={copy.optionName(label, option.count, isFit)}
            onChange={() => {
              if (option.disabled) return;
              onChange(toggleOption(filters, group, option.value));
            }}
          />
          <span className="results-facet-label">{label}</span>
          {isFit && (
            <span className="results-facet-fits" aria-hidden="true">
              <span className="results-facet-fitsDot" />
              {copy.fitsYou}
            </span>
          )}
          <span
            className="results-facet-count results-tabularNum"
            aria-hidden="true"
          >
            {option.count}
          </span>
          <Check />
        </label>
      </li>
    );
  };

  const list = (group: FilterGroup, options: FacetOption[]) => (
    <ul className="results-facet-list">
      {options.map((o) => optionRow(group, o))}
    </ul>
  );

  return (
    <div className="results-facets" lang={lang}>
      {FILTER_GROUPS.map((group) => {
        const bodyId = `${prefix}-${group}`;
        const isOpen = open[group];
        const missing =
          group === "weight" || group === "shape" || group === "connectivity"
            ? nulls[group]
            : 0;
        return (
          <section
            key={group}
            className="results-facet"
            data-group={group}
            data-open={isOpen ? "true" : "false"}
          >
            <h3 className="results-facet-heading">
              <button
                type="button"
                className="results-facet-toggle"
                aria-expanded={isOpen}
                aria-controls={bodyId}
                onClick={() => setOpen((o) => ({ ...o, [group]: !o[group] }))}
              >
                <span className="results-facet-title">{copy.group[group]}</span>
                {!isOpen && (
                  <span
                    className="results-facet-summary"
                    data-chosen={filters[group].length > 0 ? "true" : undefined}
                  >
                    {groupSummary(filters, group, copy)}
                  </span>
                )}
                <Chevron />
              </button>
            </h3>
            <div id={bodyId} hidden={!isOpen} className="results-facet-body">
              {group === "size" && (
                <p className="results-facet-note">{copy.sizeNote}</p>
              )}
              {group === "brand" ? (
                <>
                  {list("brand", counts.brand.featured)}
                  {counts.brand.rest.length > 0 && (
                    <>
                      {moreBrands && list("brand", counts.brand.rest)}
                      <button
                        type="button"
                        className="results-facet-more"
                        aria-expanded={moreBrands}
                        onClick={() => setMoreBrands((v) => !v)}
                      >
                        {moreBrands
                          ? copy.showFewerBrands
                          : copy.showMoreBrands(counts.brand.rest.length)}
                      </button>
                    </>
                  )}
                </>
              ) : (
                list(group, counts[group])
              )}
              {missing > 0 && (
                <p className="results-facet-missing">
                  {copy.missingData(
                    copy.missingNoun[
                      group as "weight" | "shape" | "connectivity"
                    ],
                    missing,
                  )}
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
