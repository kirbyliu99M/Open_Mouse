/**
 * The links of ONE mouse (2026-10-11 contract, `mouseLinksSchema` in
 * `commerce.ts`), put together from the two static files. Used by the static
 * route `GET /api/mice/<slug>/links` at build time; the page never reads the
 * files itself. Pure.
 */
import {
  mouseLinksSchema,
  type MouseLinks,
  type PurchaseLinks,
} from "../contracts/commerce";
import type { MouseMedia } from "./mouseMedia";

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
  // Built through the contract, so a file that drifts fails here, at build
  // time, and never ships a link the page would then refuse.
  return mouseLinksSchema.parse({
    officialUrl: entry.officialUrl,
    officialKind: entry.officialKind,
    purchaseLinks: shops,
  });
}
