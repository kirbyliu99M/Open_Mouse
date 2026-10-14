/**
 * The links of ONE mouse (2026-10-11 contract, `mouseLinksSchema` in
 * `commerce.ts`), put together from the two static files. Used by the route
 * `GET /api/mice/<slug>/links`; the page never reads the files itself. Pure.
 */
import {
  mouseLinksSchema,
  type MouseLinks,
  type PurchaseLinks,
} from "../contracts/commerce";
import type { MouseMedia } from "./mouseMedia";

/**
 * What the route tells the CDN (a route file may not export constants). The
 * data only changes with a deploy and a new deploy has its own cache, so an
 * answer is kept a day. The 404 is kept shorter, so a slug added later is found
 * within the hour.
 */
export const LINKS_CACHE_CONTROL =
  "public, s-maxage=86400, stale-while-revalidate=604800";
export const LINKS_NOT_FOUND_CACHE_CONTROL = "public, s-maxage=3600";

/** Where the page asks for one mouse's links. */
export function mouseLinksPath(slug: string): string {
  return `/api/mice/${encodeURIComponent(slug)}/links`;
}

/**
 * The links of `slug`, or `null` when the mouse is not in `media` (the route
 * only exists for the mice in that file). Purchase links are empty when the
 * slug has none. Own keys only: a slug like "constructor" reads nothing.
 */
export function linksForMouse(
  media: MouseMedia,
  purchase: PurchaseLinks,
  slug: string,
): MouseLinks | null {
  if (!Object.hasOwn(media, slug)) return null;
  const entry = media[slug];
  const shops = Object.hasOwn(purchase, slug) ? purchase[slug] : [];
  // Built through the contract. The inputs were already checked by their own
  // schemas, so this normally cannot fail; if it ever did it would throw in the
  // route (the build, for a static route). A file that does not match its own
  // schema never gets this far: `parseMouseMedia` and `parsePurchaseLinks` turn
  // it into `{}`, silently, so the bundled files are pinned by tests with a
  // parse that throws (tests/unit/results-purchase-links.test.ts, mouse-media).
  return mouseLinksSchema.parse({
    officialUrl: entry.officialUrl,
    officialKind: entry.officialKind,
    purchaseLinks: shops,
  });
}
