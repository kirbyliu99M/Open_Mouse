"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ResultsView } from "@/components/results/ResultsView";
import {
  brandOrder,
  filteredView,
  mergeFilterParams,
  parseFilters,
  resolveViewDetail,
  serializeFilters,
  type Filters,
} from "@/lib/results/filters";
import { mainResultsPath } from "@/lib/results/rankRoutes";
import { useResultsScan } from "./ResultsScanProvider";

/**
 * One results page. With no `slug` it is the main page (the first place of the
 * list shown) and it asks for the written analysis; with a `slug` it is that
 * mouse's detail page, which shows only the deterministic reasons.
 *
 * The filter (FILTER-1, candidate) lives in the query string, written with
 * `history.replaceState` so a change adds no history entry. Every link to a
 * results page keeps it. A URL with no filter parameters is the plain page,
 * and values it does not know are ignored. A detail page is the filtered #2 to
 * #5 (whatever its overall rank); the filtered #1, a mouse the filter leaves
 * out and a slug that is not ranked send the person back to the main page,
 * filter kept. The detail page has no filter of its own: it reads the
 * parameters it was opened with.
 */
export function ResultsRankClient({ slug }: { slug?: string }) {
  const scan = useResultsScan();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { response, scanId } = scan;
  const isMain = slug === undefined;

  const knownBrands = useMemo(() => {
    const { featured, rest } = brandOrder(response);
    return [...featured, ...rest];
  }, [response]);

  // The URL is read once, here: after that the state is the source and the URL
  // follows it (`replaceState` does not need to be read back).
  const [filters, setFilters] = useState<Filters>(() =>
    parseFilters(searchParams, { knownBrands }),
  );
  const search = serializeFilters(filters);

  const onFiltersChange = useCallback(
    (next: Filters) => {
      setFilters(next);
      const query = mergeFilterParams(window.location.search, next);
      window.history.replaceState(
        null,
        "",
        `${pathname}${query === "" ? "" : `?${query}`}${window.location.hash}`,
      );
    },
    [pathname],
  );

  const view = useMemo(
    () => filteredView(response, filters),
    [response, filters],
  );
  const target = isMain ? null : resolveViewDetail(view, slug);
  const redirect = target?.kind === "main";

  useEffect(() => {
    if (redirect) router.replace(mainResultsPath(scanId, search));
  }, [redirect, router, scanId, search]);

  const { requestAnalysis } = scan;
  // The rule (main page only, once per scan) is `shouldRequestAnalysis`.
  useEffect(() => {
    requestAnalysis(isMain);
  }, [isMain, requestAnalysis]);

  if (redirect) return null;

  return (
    <ResultsView
      key={target?.kind === "detail" ? target.card.entry.mouse.slug : "main"}
      response={response}
      rank={target?.kind === "detail" ? target.card.displayRank : 1}
      language={scan.language}
      scanId={scanId}
      enteredLengthMm={scan.enteredLength}
      showViewer
      analysisState={scan.analysisState}
      onRetryAnalysis={scan.retryAnalysis}
      analytics={scan.analytics}
      filters={filters}
      // The detail page reads the filter it was opened with and has no filter
      // controls of its own.
      onFiltersChange={isMain ? onFiltersChange : undefined}
    />
  );
}
