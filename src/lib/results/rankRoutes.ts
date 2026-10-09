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

export function mainResultsPath(scanId: string): string {
  return `/results/${encodeURIComponent(scanId)}`;
}

export function detailResultsPath(scanId: string, slug: string): string {
  return `${mainResultsPath(scanId)}/m/${encodeURIComponent(slug)}`;
}

/** The path of the page that shows `entry`: main for rank 1, a detail page otherwise. */
export function pathForEntry(scanId: string, entry: FitEntry): string {
  return entry.rank === 1
    ? mainResultsPath(scanId)
    : detailResultsPath(scanId, entry.mouse.slug);
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
