"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { reducedMotionNow } from "@/components/motion/Presence";
import { FilterNoMatch } from "@/components/results/filter/FilterNoMatch";
import { ResultsFilterLayout } from "@/components/results/filter/ResultsFilterLayout";
import type { Locale } from "@/lib/contracts/locale";
import { micePageCopy } from "@/lib/copy/mice-page";
import { RESULTS_PAGE_COPY, type FilterCopy } from "@/lib/copy/results-page";
import { firstRendered } from "@/lib/mice/rendered";
import { MOTION } from "@/lib/motion";
import { enteringRowsFrom } from "@/lib/presence";
import {
  MAX_SEARCH_LENGTH,
  MICE_PAGE_SIZE,
  filterMice,
  formatGrams,
  formatMm,
  mergeSearchParam,
  nextShownCount,
  normalizeSearch,
  parseSearchParam,
  searchMice,
  toFilterSource,
  type MiceListRow,
} from "@/lib/mice/list";
import {
  brandOrder,
  isFiltering,
  mergeFilterParams,
  parseFilters,
  serializeFilters,
  type Filters,
} from "@/lib/results/filters";
import { rowDelayMs } from "@/lib/results/shapeToggle";
import "@/components/results/results.css";
import "./mice.css";

/** What a cell shows when the catalogue has no value (never a guess). */
const NONE = "—";

function shapeLabel(
  row: MiceListRow,
  copy: FilterCopy,
  hybrid: string,
): string | null {
  // `hybrid` has a value but no word in the filter's copy (the filter has no
  // hybrid option), so the page's own word shows it. Only a null shape is none.
  if (row.shape === "hybrid") return hybrid;
  return row.shape === "ergonomic" || row.shape === "symmetrical"
    ? copy.shape[row.shape]
    : null;
}

function connectionLabel(row: MiceListRow, copy: FilterCopy): string | null {
  return row.connectivity ? copy.connectivity[row.connectivity] : null;
}

/** 「125 × 63.5 × 40 mm」, with 「 · 80 g」 when the weight is known. */
function cardDimensions(row: MiceListRow): string {
  const dims = [row.lengthMm, row.widthMm, row.heightMm]
    .map((v) => formatMm(v) ?? NONE)
    .join(" × ");
  const grams = formatGrams(row.weightG);
  return `${dims} mm${grams === null ? "" : ` · ${grams} g`}`;
}

/**
 * The all-mice list (PAGE-1, candidate / 未拍板): the search, the results
 * page's filter, and the rows, a table from 80rem and cards below it.
 *
 * The filter is the results page's own (`ResultsFilterLayout` and the pure
 * rules in `src/lib/results/filters.ts`), fed the catalogue rows as the same
 * shape the results filter reads. Its option counts and brand list describe
 * the whole catalogue; the count line, the list and the no-match suggestion
 * follow the search too. The filter and the search live in the query string
 * (`replaceState`, no history entry per change), as on the results page.
 */
export function MiceBrowser({
  rows,
  language,
  unavailable,
}: {
  rows: readonly MiceListRow[];
  language: Locale;
  /** The catalogue could not be read: show the page's empty state. */
  unavailable: boolean;
}) {
  const copy = micePageCopy(language);
  const filterCopy = RESULTS_PAGE_COPY[language].filter;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchId = useId();

  const source = useMemo(() => toFilterSource(rows), [rows]);
  const knownBrands = useMemo(() => {
    const { featured, rest } = brandOrder(source);
    return [...featured, ...rest];
  }, [source]);

  // The URL is read once; after that the state is the source and the URL
  // follows it.
  const [filters, setFilters] = useState<Filters>(() =>
    parseFilters(searchParams, { knownBrands }),
  );
  const [query, setQuery] = useState(() => parseSearchParam(searchParams));

  const writeUrl = useCallback(
    (make: (search: string) => string) => {
      const next = make(window.location.search);
      window.history.replaceState(
        null,
        "",
        `${pathname}${next === "" ? "" : `?${next}`}${window.location.hash}`,
      );
    },
    [pathname],
  );
  const onFiltersChange = useCallback(
    (next: Filters) => {
      setFilters(next);
      writeUrl((search) => mergeFilterParams(search, next));
    },
    [writeUrl],
  );
  const onQueryChange = useCallback(
    (next: string) => {
      setQuery(next);
      writeUrl((search) => mergeSearchParam(search, next));
    },
    [writeUrl],
  );

  const searched = useMemo(() => searchMice(rows, query), [rows, query]);
  const searchedSource = useMemo(() => toFilterSource(searched), [searched]);
  const visible = useMemo(
    () => filterMice(searched, filters),
    [searched, filters],
  );
  const count = visible.length;

  // How many rows are shown. A change of search or filter starts again at the
  // first batch (the batch size is remembered with the search and the filter
  // it was for, so no effect has to reset it).
  const pagingKey = `${serializeFilters(filters)}|${normalizeSearch(query)}`;
  const [paging, setPaging] = useState({
    key: pagingKey,
    shown: MICE_PAGE_SIZE,
  });
  const shown = paging.key === pagingKey ? paging.shown : MICE_PAGE_SIZE;
  const shownRows = visible.slice(0, shown);
  const remaining = count - shownRows.length;

  // 「Show more」 moves focus to the first row it added, so the keyboard and a
  // screen reader land where the new rows begin (the button itself moves down,
  // and is gone after the last batch). Only one of the table and the cards is
  // visible, so the first visible match gets it.
  const root = useRef<HTMLDivElement>(null);
  const focusFrom = useRef<number | null>(null);
  useEffect(() => {
    const from = focusFrom.current;
    if (from === null) return;
    focusFrom.current = null;
    const candidates =
      root.current?.querySelectorAll<HTMLElement>(
        `[data-row-index="${from}"]`,
      ) ?? [];
    firstRendered(candidates)?.focus();
  }, [shown]);
  // New rows fade in, one after another (V3.2 motion pass #29): every row
  // from the top after a filter change, the added ones after 「顯示更多」;
  // 30 ms apart, the first five only (the shape toggle's rhythm). The rows the
  // server sent, and a search keystroke, do not fade.
  const filterKey = serializeFilters(filters);
  const seenRows = useRef<{ key: string; shown: number } | null>(null);
  useLayoutEffect(() => {
    const before = seenRows.current;
    seenRows.current = { key: filterKey, shown };
    if (before === null) return;
    const from = enteringRowsFrom({
      previousKey: before.key,
      key: filterKey,
      previousShown: before.shown,
      shown,
    });
    if (from === null) return;
    const reduced = reducedMotionNow();
    root.current
      ?.querySelectorAll<HTMLElement>("[data-row-index]")
      .forEach((row) => {
        const delay = rowDelayMs(Number(row.dataset.rowIndex) - from, reduced);
        if (delay === null || typeof row.animate !== "function") return;
        row.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: reduced ? MOTION.REDUCED_MS : MOTION.BASE_MS,
          delay,
          easing: MOTION.EASE_OUT,
          // Hidden until its turn.
          fill: "backwards",
        });
      });
  }, [filterKey, shown]);
  const showMore = () => {
    focusFrom.current = shownRows.length;
    setPaging({ key: pagingKey, shown: nextShownCount(shown, count) });
  };

  const search = (
    <div className="mice-search">
      <input
        id={searchId}
        type="search"
        name="q"
        className="mice-searchInput"
        value={query}
        placeholder={copy.searchPlaceholder}
        aria-label={copy.searchPlaceholder}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={MAX_SEARCH_LENGTH}
        onChange={(e) => onQueryChange(e.target.value)}
      />
    </div>
  );

  let content;
  if (unavailable) {
    content = (
      <p className="mice-empty" role="status">
        {copy.unavailable}
      </p>
    );
  } else if (count === 0) {
    content = isFiltering(filters) ? (
      <FilterNoMatch
        response={searchedSource}
        filters={filters}
        language={language}
        onChange={onFiltersChange}
        headingLevel={2}
      />
    ) : (
      <p className="mice-empty">{copy.noSearchMatch}</p>
    );
  } else {
    content = (
      <div ref={root} className="mice-results">
        <div
          className="mice-tableWrap"
          role="region"
          aria-label={copy.title}
          tabIndex={0}
        >
          <table className="mice-table">
            <caption className="results-visuallyHidden">{copy.title}</caption>
            <thead>
              <tr>
                <th scope="col">{copy.columns.mouse}</th>
                <th scope="col">{filterCopy.group.size}</th>
                <th scope="col">{copy.columns.shape}</th>
                <th scope="col">{copy.columns.connection}</th>
                <th scope="col" className="mice-num">
                  {copy.columns.length}
                </th>
                <th scope="col" className="mice-num">
                  {copy.columns.width}
                </th>
                <th scope="col" className="mice-num">
                  {copy.columns.height}
                </th>
                <th scope="col" className="mice-num">
                  {copy.columns.weight}
                </th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map((row, i) => (
                <tr key={row.slug} data-row-index={i} tabIndex={-1}>
                  <th scope="row" className="mice-name">
                    <span className="mice-brand">{row.brand}</span>{" "}
                    <span className="mice-model">{row.model}</span>
                  </th>
                  <td>{filterCopy.size[row.size]}</td>
                  <td>
                    {shapeLabel(row, filterCopy, copy.shapeHybrid) ?? NONE}
                  </td>
                  <td>{connectionLabel(row, filterCopy) ?? NONE}</td>
                  <td className="mice-num">{formatMm(row.lengthMm) ?? NONE}</td>
                  <td className="mice-num">{formatMm(row.widthMm) ?? NONE}</td>
                  <td className="mice-num">{formatMm(row.heightMm) ?? NONE}</td>
                  <td className="mice-num">
                    {formatGrams(row.weightG) ?? NONE}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mice-cards" aria-label={copy.title}>
          {shownRows.map((row, i) => {
            const tags = [
              filterCopy.size[row.size],
              shapeLabel(row, filterCopy, copy.shapeHybrid),
              connectionLabel(row, filterCopy),
            ].filter((t): t is string => t !== null);
            return (
              <li
                key={row.slug}
                className="mice-card"
                data-row-index={i}
                tabIndex={-1}
              >
                <p className="mice-brand">{row.brand}</p>
                <p className="mice-model">{row.model}</p>
                <ul className="mice-tags">
                  {tags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
                <p className="mice-dims results-tabularNum">
                  {cardDimensions(row)}
                </p>
              </li>
            );
          })}
        </ul>
        {remaining > 0 && (
          <button
            type="button"
            className="results-pill mice-more"
            onClick={showMore}
          >
            {copy.showMore}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mice-view">
      <ResultsFilterLayout
        response={source}
        countSource={searchedSource}
        shells="both"
        language={language}
        filters={filters}
        count={count}
        onChange={onFiltersChange}
        lead={search}
      >
        {content}
      </ResultsFilterLayout>
    </div>
  );
}
