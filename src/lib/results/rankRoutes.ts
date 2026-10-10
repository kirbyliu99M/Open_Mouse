/**
 * Which results page shows which mouse, and what the lists on a page hold.
 *
 * `/results/[scanId]` is rank 1. `/results/[scanId]/m/[slug]` is a detail page
 * for ranks 2 to 5 only; any other slug (rank 1, rank 6 or later, or one that
 * is not in the response) goes back to the main page. Pure.
 */
import type { FitEntry, FitResponse } from "../contracts/fit";

/** The detail pages cover the top five. */
export const TOP_PICK_COUNT = 5;

/**
 * `search` is a query string without the `?` (the filter's parameters, see
 * `serializeFilters`): every path keeps it, so a filtered list stays filtered
 * when a page is opened from it, reloaded, or redirected to the main page.
 */
function withSearch(path: string, search: string): string {
  return search === "" ? path : `${path}?${search}`;
}

export function mainResultsPath(scanId: string, search = ""): string {
  return withSearch(`/results/${encodeURIComponent(scanId)}`, search);
}

export function detailResultsPath(
  scanId: string,
  slug: string,
  search = "",
): string {
  return withSearch(
    `/results/${encodeURIComponent(scanId)}/m/${encodeURIComponent(slug)}`,
    search,
  );
}

/**
 * The path of the page that shows `entry`: main for the first place, a detail
 * page otherwise. `displayRank` is the place in the list the person sees (the
 * filtered list's, which can differ from `entry.rank`); it defaults to the
 * overall rank.
 */
export function pathForEntry(
  scanId: string,
  entry: FitEntry,
  search = "",
  displayRank: number = entry.rank,
): string {
  return displayRank === 1
    ? mainResultsPath(scanId, search)
    : detailResultsPath(scanId, entry.mouse.slug, search);
}

export type DetailTarget =
  { kind: "detail"; entry: FitEntry } | { kind: "main" };

/** What `/results/[scanId]/m/[slug]` shows: a rank 2 to 5 entry, or a redirect to the main page. */
export function resolveDetailTarget(
  results: readonly FitEntry[],
  slug: string,
): DetailTarget {
  const entry = results.find((r) => r.mouse.slug === slug);
  return entry && entry.rank >= 2 && entry.rank <= TOP_PICK_COUNT
    ? { kind: "detail", entry }
    : { kind: "main" };
}

/** The entry a page shows for `rank`, or `null` when the response has none. */
export function entryAtRank(
  results: readonly FitEntry[],
  rank: number,
): FitEntry | null {
  return results.find((r) => r.rank === rank) ?? null;
}

/** The other picks on a page: the top five without the mouse the page shows, best first. */
export function otherPicks(
  results: readonly FitEntry[],
  currentRank: number,
): FitEntry[] {
  return results
    .filter((r) => r.rank <= TOP_PICK_COUNT && r.rank !== currentRank)
    .sort((a, b) => a.rank - b.rank);
}

export interface OtherMice {
  /** Rank 6 onward, best first. */
  ranked: FitEntry[];
  /** Mice left out of the ranking, last. */
  excluded: FitResponse["excluded"];
  /** Rows the section lists: ranked plus excluded. */
  count: number;
}

/** The "other mice" section: everything past the top five, then the excluded. */
export function otherMice(response: FitResponse): OtherMice {
  const ranked = response.results
    .filter((r) => r.rank > TOP_PICK_COUNT)
    .sort((a, b) => a.rank - b.rank);
  return {
    ranked,
    excluded: response.excluded,
    count: ranked.length + response.excluded.length,
  };
}
