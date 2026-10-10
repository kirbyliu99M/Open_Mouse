import Link from "next/link";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { serializeFilters, type Filters } from "@/lib/results/filters";
import { chipsOf } from "@/lib/results/filterLabels";
import { mainResultsPath } from "@/lib/results/rankRoutes";
import "./filter.css";

/**
 * What a detail page shows of the filter it was opened under: the chosen
 * options (read only) and a link back to the filtered list. A detail page has
 * no filter controls of its own, so without this the filter's effects (the
 * 「篩選後第 N 名」 badge, the narrowed other picks) had no visible cause and
 * no way out but the browser's back button.
 */
export function FilterSummary({
  filters,
  language,
  scanId,
  count,
}: {
  filters: Filters;
  language: UiLanguage;
  scanId: string;
  /** How many cards the filter keeps. */
  count: number;
}) {
  const copy = RESULTS_PAGE_COPY[language].filter;
  return (
    <div className="results-filterNote" lang={uiLangAttribute(language)}>
      <ul className="results-chips-list" aria-label={copy.chipsLabel}>
        {chipsOf(filters, copy).map((chip) => (
          <li key={`${chip.group}:${chip.value}`}>
            <span className="results-chip results-chip--static">
              {chip.label}
            </span>
          </li>
        ))}
      </ul>
      <Link
        href={mainResultsPath(scanId, serializeFilters(filters))}
        className="results-textLink"
      >
        {copy.backToList(count)}
      </Link>
    </div>
  );
}
