import Link from "next/link";
import type { MouseEvent } from "react";
import type { Locale } from "@/lib/contracts/locale";
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
  onBackToList,
}: {
  filters: Filters;
  language: Locale;
  scanId: string;
  /** How many cards the filter keeps. */
  count: number;
  /** May take the link over to go back in history instead (V3.2 F11). */
  onBackToList?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const href = mainResultsPath(scanId, serializeFilters(filters));
  const copy = RESULTS_PAGE_COPY[language].filter;
  return (
    <div className="results-filterNote">
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
        href={href}
        className="results-textLink"
        onClick={
          onBackToList ? (event) => onBackToList(event, href) : undefined
        }
      >
        {copy.backToList(count)}
      </Link>
    </div>
  );
}
