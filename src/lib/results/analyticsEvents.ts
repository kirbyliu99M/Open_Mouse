/**
 * Pure helpers for the results-page analytics events (contract:
 * `src/lib/contracts/analytics.ts`). Nothing here sends anything: the callers
 * pass in the sender. No scan ID, no URL, no hand value ever goes into the
 * props these build.
 */
import {
  ANALYTICS_COUNT_CAP,
  analyticsBrandKey,
  FILTER_SOURCES,
  type AnalyticsEventName,
  type AnalyticsEventProps,
} from "@/lib/contracts/analytics";
import type { OfficialUrlKind } from "@/lib/contracts/commerce";
import type { FitResponse } from "@/lib/contracts/fit";
import { clampCount } from "@/client/analytics/props";
import {
  FILTER_GROUPS,
  filteredView,
  selectionOf,
  type FilteredCard,
  type FilteredView,
  type Filters,
} from "./filters";

/** Where a filter change was made (the contract's `FILTER_SOURCES`). */
export type FilterChangeSource = (typeof FILTER_SOURCES)[number];

/**
 * Where a change of the results page's filters came from. Since V3.2 the
 * contract's sources include the shape toggle above the filter button
 * (`"shape_toggle"`), so every change maps to a `filter_applied` source.
 */
export type ResultsFilterChange = FilterChangeSource;

/** The `filter_applied` source of a change: the contract's source itself, or
 * `null` for a value outside `FILTER_SOURCES` (none today; a guard only). */
export function filterAppliedSource(
  change: ResultsFilterChange,
): FilterChangeSource | null {
  return (FILTER_SOURCES as readonly string[]).includes(change) ? change : null;
}

/** The fields every results-page event carries. */
export interface ResultsPageFields {
  page: "main" | "detail";
  rank: number;
  filtered: boolean;
}

/** `displayRank` is the place of the mouse in the big header (1 is the main page). */
export function resultsPageFields(
  displayRank: number,
  filtered: boolean,
): ResultsPageFields {
  const rank = Math.min(5, Math.max(1, Math.floor(displayRank) || 1));
  return { page: rank === 1 ? "main" : "detail", rank, filtered };
}

/** The names of the events that carry the page fields. */
export type ResultsPageEventName = {
  [K in AnalyticsEventName]: AnalyticsEventProps<K> extends ResultsPageFields
    ? K
    : never;
}[AnalyticsEventName];

/** The props an event needs besides the page fields. */
export type ExtraProps<E extends ResultsPageEventName> = Omit<
  AnalyticsEventProps<E>,
  keyof ResultsPageFields
>;

/** What the results page hands down: the sender, shaped like `track`. */
export interface ResultsAnalytics {
  send: <E extends AnalyticsEventName>(
    name: E,
    props: AnalyticsEventProps<E>,
  ) => void;
}

export type ResultsEmit = <E extends ResultsPageEventName>(
  name: E,
  extra: ExtraProps<E>,
) => void;

/** An emitter that adds the page fields to every event it sends. */
export function createResultsEmit(
  analytics: ResultsAnalytics | undefined,
  fields: ResultsPageFields,
): ResultsEmit {
  return (name, extra) => {
    if (!analytics) return;
    analytics.send(name, { ...fields, ...extra } as never);
  };
}

/** The card in the big header: the one at `rank`, else the filtered #1. */
export function headerCard(
  view: FilteredView,
  rank: number,
): FilteredCard | null {
  return view.cards.find((c) => c.displayRank === rank) ?? view.large ?? null;
}

/** A purchase link's 1-based row, capped to the contract's four. */
export function linkPositionOf(index: number): number {
  return Math.min(4, Math.max(1, index + 1));
}

/** The official link's kind as the event says it; no kind reads as the brand's page. */
export function officialKindOf(
  kind: OfficialUrlKind | null | undefined,
): "product" | "brand" {
  return kind === "product" ? "product" : "brand";
}

export interface FilterSelectionProps {
  brand: string[];
  size: Filters["size"];
  weight: Filters["weight"];
  shape: Filters["shape"];
  connectivity: Filters["connectivity"];
}

/** The whole selection as event values: brands as keys (deduped, capped), the rest as is. */
export function filterSelectionProps(filters: Filters): FilterSelectionProps {
  const brand: string[] = [];
  for (const b of filters.brand) {
    const key = analyticsBrandKey(b);
    if (key !== null && !brand.includes(key)) brand.push(key);
    if (brand.length === ANALYTICS_COUNT_CAP) break;
  }
  return {
    brand,
    size: [...filters.size],
    weight: [...filters.weight],
    shape: [...filters.shape],
    connectivity: [...filters.connectivity],
  };
}

/** Whether the two selections differ (the order a choice was made in does not count). */
export function filtersChanged(prev: Filters, next: Filters): boolean {
  return FILTER_GROUPS.some((group) => {
    const a = selectionOf(prev, group);
    const b = selectionOf(next, group);
    return a.length !== b.length || a.some((v) => !b.includes(v));
  });
}

/**
 * The `filter_applied` props for one change of the results page's filters, or
 * `null` when nothing is to be sent: the selection did not change (a segment
 * pressed again, an unchanged apply) or the change has no contract source.
 * The page after a change is the main page, whose big header is always the
 * filtered list's first place (a filter is only changed there).
 */
export function filterAppliedProps(
  prev: Filters,
  next: Filters,
  change: ResultsFilterChange,
  fit: FitResponse,
): AnalyticsEventProps<"filter_applied"> | null {
  const source = filterAppliedSource(change);
  if (source === null || !filtersChanged(prev, next)) return null;
  const after = filteredView(fit, next);
  return {
    ...resultsPageFields(1, after.active),
    source,
    ...filterSelectionProps(next),
    count: clampCount(after.count),
  };
}

/** True the first time `key` is seen in `seen`, and remembers it. */
export function firstTime(seen: Set<string>, key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
