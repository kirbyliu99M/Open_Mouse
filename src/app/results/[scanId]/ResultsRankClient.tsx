"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ResultsView,
  type ResultsNavigation,
} from "@/components/results/ResultsView";
import {
  brandOrder,
  filteredView,
  mergeFilterParams,
  parseFilters,
  resolveViewDetail,
  serializeFilters,
  type Filters,
} from "@/lib/results/filters";
import { poorFitField } from "@/components/results/fitNotice";
import {
  filterAppliedProps,
  headerCard,
  resultsPageFields,
  type ResultsFilterChange,
} from "@/lib/results/analyticsEvents";
import { RESULTS_VIEWER_ENABLED } from "@/lib/results/features";
import { mainResultsPath } from "@/lib/results/rankRoutes";
import {
  customHistoryState,
  notePendingArrival,
  pendingForPick,
  pickNavigation,
  readCurrentStamp,
  stampOnArrival,
  takeArrivalMemory,
  topBarBack,
  writeCurrentStamp,
} from "@/lib/results/resultsHistory";
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
 *
 * History (V3.2 F11, candidate; the rule is in resultsHistory.ts): nothing on
 * a page adds an entry; only a card from the main page opens a detail page in
 * a new entry, and the top bar's back goes back past the results when the scan
 * page is right behind them.
 */

/** A click that opens a new tab or window is the browser's, not the page's. */
function plainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.defaultPrevented
  );
}

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

  const { analytics, response: fit } = scan;
  // The latest applied filters, so a change can be compared with what was there.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const onFiltersChange = useCallback(
    (next: Filters, change: ResultsFilterChange) => {
      const props = filterAppliedProps(filtersRef.current, next, change, fit);
      filtersRef.current = next;
      setFilters(next);
      // Every change, the shape toggle's included (source `shape_toggle`,
      // V3.2), is sent as `filter_applied` with the existing fields; no
      // change (a segment pressed again) sends nothing.
      if (props !== null) analytics.send("filter_applied", props);
      const query = mergeFilterParams(window.location.search, next);
      // The entry's own stamp (V3.2 F11) is kept; Next.js adds its keys back.
      window.history.replaceState(
        customHistoryState(window.history.state),
        "",
        `${pathname}${query === "" ? "" : `?${query}`}${window.location.hash}`,
      );
    },
    [pathname, analytics, fit],
  );

  const view = useMemo(
    () => filteredView(response, filters),
    [response, filters],
  );
  const target = isMain ? null : resolveViewDetail(view, slug);
  const redirect = target?.kind === "main";

  // `results_page_viewed`, once per page: the main page, or one detail page
  // (a different slug is another page). Not while redirecting, and not when
  // the filter leaves no mouse for the header.
  const viewedRef = useRef<string | null>(null);
  const pageKey = slug ?? "main";
  useEffect(() => {
    if (redirect || viewedRef.current === pageKey) return;
    const card = headerCard(
      view,
      target?.kind === "detail" ? target.card.displayRank : 1,
    );
    if (!card) return;
    viewedRef.current = pageKey;
    analytics.send("results_page_viewed", {
      state: "ready",
      ...resultsPageFields(card.displayRank, view.active),
      mouse: card.entry.mouse.slug,
      overallRank: card.overallRank,
      ...poorFitField(response, card.entry.total),
    });
    // Later filter changes on the page are `filter_applied`, not a new view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redirect, pageKey]);

  useEffect(() => {
    if (redirect) router.replace(mainResultsPath(scanId, search));
  }, [redirect, router, scanId, search]);

  // V3.2 F11: stamp this page's history entry once it is shown (kept on back,
  // forward, a reload and a filter change).
  useEffect(() => {
    if (redirect) return;
    if (window.location.pathname !== pathname) return;
    const memory = takeArrivalMemory();
    const stamp = stampOnArrival({
      scanId,
      path: pathname,
      isMain,
      existing: readCurrentStamp(),
      pending: memory.pending,
      scanHandoff: memory.scanHandoff,
    });
    writeCurrentStamp(stamp);
  }, [redirect, pathname, scanId, isMain]);

  const navigation = useMemo<ResultsNavigation>(
    () => ({
      onPick: (event, href, toMain) => {
        if (!plainClick(event)) return;
        const stamp = readCurrentStamp();
        const nav = pickNavigation({ fromMain: isMain, toMain, stamp });
        notePendingArrival(pendingForPick(nav, { scanId, toMain, stamp }));
        if (nav.kind === "push") return; // the link itself
        event.preventDefault();
        if (nav.kind === "back") router.back();
        else router.replace(href);
      },
      onBack: (event) => {
        if (!plainClick(event)) return;
        const back = topBarBack(readCurrentStamp(), scanId);
        if (back.kind === "link") return;
        event.preventDefault();
        window.history.go(-back.steps);
      },
    }),
    [isMain, scanId, router],
  );

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
      enteredManual={scan.enteredManual}
      paperAdjusted={scan.paperAdjusted}
      showViewer={RESULTS_VIEWER_ENABLED}
      analysisState={scan.analysisState}
      onRetryAnalysis={scan.retryAnalysis}
      onResultChanged={scan.refreshFit}
      analytics={analytics}
      filters={filters}
      // The detail page reads the filter it was opened with and has no filter
      // controls of its own.
      onFiltersChange={isMain ? onFiltersChange : undefined}
      navigation={navigation}
    />
  );
}
