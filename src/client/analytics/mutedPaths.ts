/**
 * Pages that send no page view at all (candidate 未拍板): only the hidden
 * data-tester page (`TESTER_PAGE_PATH` in src/lib/contracts/tester.ts, pinned
 * by tests/unit/tester-client.test.ts; spelled out here so every page's
 * bundle does not load the tester contract). Its product events are muted
 * while it is mounted (track.ts); this covers the `$pageview` and the
 * GA4 `page_view` the provider sends on arrival, which can run before the
 * page's own effect.
 */
export const ANALYTICS_MUTED_PATHS: readonly string[] = ["/scan/tester"];

/** Whether `pathname` (with or without the `/en` prefix) is a muted page or below one. */
export function analyticsMutedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  const bare = pathname.replace(/^\/en(?=\/|$)/, "") || "/";
  return ANALYTICS_MUTED_PATHS.some(
    (p) => bare === p || bare.startsWith(`${p}/`),
  );
}
