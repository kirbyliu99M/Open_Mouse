import type { FitEntry } from "../../lib/contracts/fit";
import { parseMouseMedia } from "../../lib/results/mouseMedia";

/**
 * Fills each result's product photo from `src/data/mouse-media.json`
 * (2026-10-11, candidate): `mouse.imageUrl` is the entry's own value when it
 * has one, else the photo in `media`, else `null`. Pure; run it after
 * `withFilterFacts`.
 *
 * It fills **every** entry, not only the top five: the results filter can
 * promote any mouse to the top, and the small cards show a photo too. The
 * official link and the purchase links are NOT here: they would add about
 * 36 to 110 KB to every (uncacheable) fit response, so the page fetches the
 * links of the one mouse in its big header from the static route
 * `GET /api/mice/<slug>/links` instead (`src/app/api/mice/[slug]/links`).
 *
 * Facts only. No score, rank or order changes, and the photo path is not
 * something the analysis may use: `toInputEntry`
 * (src/server/analysis/input.ts) picks its fields one by one and never copies
 * it (hard rule 2; pinned by tests/unit/results-photos-server.test.ts).
 * `media` is the raw file content; a file that does not match its schema means
 * no photos.
 */
export function withPhotos(
  results: readonly FitEntry[],
  media: unknown,
): FitEntry[] {
  // Parse the file once, not once per entry: the catalogue has ~400 mice.
  const parsed = parseMouseMedia(media);
  return results.map((entry) => {
    // Own keys only: a slug like "constructor" must not read the prototype.
    const found = Object.hasOwn(parsed, entry.mouse.slug)
      ? parsed[entry.mouse.slug]
      : null;
    return {
      ...entry,
      mouse: {
        ...entry.mouse,
        imageUrl: entry.mouse.imageUrl ?? found?.image ?? null,
      },
    };
  });
}
