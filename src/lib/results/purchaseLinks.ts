/**
 * Purchase links for the results page (2026-10-08 contract, `commerce.ts`).
 * Another team maintains `src/data/purchase-links.json`, keyed by mouse slug.
 * The site never ranks or scores by these links. A file that does not match
 * the contract, or a slug with no links, means nothing is shown: this never
 * throws. Pure.
 */
import {
  purchaseLinksSchema,
  type PurchaseLink,
  type PurchaseLinks,
} from "../contracts/commerce";

/** The links in `raw`, or `{}` when it is not a valid purchase-links file. */
export function parsePurchaseLinks(raw: unknown): PurchaseLinks {
  const parsed = purchaseLinksSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** The links for one mouse, in display order; empty when there are none. */
export function linksForSlug(raw: unknown, slug: string): PurchaseLink[] {
  const links = parsePurchaseLinks(raw);
  // Own keys only: a slug like "constructor" must not read the prototype.
  return Object.hasOwn(links, slug) ? links[slug] : [];
}
