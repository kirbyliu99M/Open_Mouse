import type { FitEntry } from "../../lib/contracts/fit";
import { parseMouseMedia } from "../../lib/results/mouseMedia";
import { parsePurchaseLinks } from "../../lib/results/purchaseLinks";

/**
 * Fills each result's product photo, official link and purchase links from the
 * two static files (2026-10-11, candidate): `mouse.imageUrl` (the entry's own
 * value when it has one, else the photo in `media`), `mouse.officialUrl`,
 * `mouse.officialKind` and `mouse.purchaseLinks`. Pure; run it after
 * `withFilterFacts`.
 *
 * It fills **every** entry, not only the top five: the results filter can
 * promote any mouse to the top, and the page reads these fields from whichever
 * entry is on screen. A slug with no media entry gets `null` for the official
 * fields (and for the photo, when it had none); a slug with no purchase links
 * gets no `purchaseLinks` key at all.
 *
 * Facts only. No score, rank or order changes, and nothing here is a number or
 * text the analysis may use: `toInputEntry` (src/server/analysis/input.ts)
 * picks its fields one by one and never copies these (hard rule 2; pinned by
 * tests/unit/results-media-server.test.ts). `media` and `purchase` are the raw
 * file contents; a file that does not match its schema means no data.
 */
export function withMedia(
  results: readonly FitEntry[],
  files: { media: unknown; purchase: unknown },
): FitEntry[] {
  // Parse each file once, not once per entry: the catalogue has ~400 mice.
  const media = parseMouseMedia(files.media);
  const purchase = parsePurchaseLinks(files.purchase);
  return results.map((entry) => {
    const slug = entry.mouse.slug;
    // Own keys only: a slug like "constructor" must not read the prototype.
    const found = Object.hasOwn(media, slug) ? media[slug] : null;
    const links = Object.hasOwn(purchase, slug) ? purchase[slug] : [];
    return {
      ...entry,
      mouse: {
        ...entry.mouse,
        imageUrl: entry.mouse.imageUrl ?? found?.image ?? null,
        officialUrl: found?.officialUrl ?? null,
        officialKind: found?.officialKind ?? null,
        ...(links.length > 0 ? { purchaseLinks: links } : {}),
      },
    };
  });
}
