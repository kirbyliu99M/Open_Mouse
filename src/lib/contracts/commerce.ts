/**
 * Purchase-link contract (2026-10-08). The results page reserves a slot above
 * the collapsed details for links that another team maintains, keyed by mouse
 * slug. The site never ranks or scores by these links; an empty or missing
 * entry renders nothing.
 */
import { z } from "zod";

/** https only, a real host, and no user name or password in the URL. */
export const httpsUrlSchema = z.string().refine(
  (u) => {
    if (!u.startsWith("https://")) return false;
    try {
      const parsed = new URL(u);
      return (
        parsed.protocol === "https:" &&
        parsed.hostname !== "" &&
        !u.startsWith("https:///") &&
        parsed.username === "" &&
        parsed.password === ""
      );
    } catch {
      return false;
    }
  },
  { message: "https link to a real host, no credentials" },
);

export const purchaseLinkSchema = z.strictObject({
  /** Visible text, e.g. a shop name. Supplied by the link owner. */
  label: z.string().trim().min(1).max(40),
  url: httpsUrlSchema,
});

/**
 * Where an official link points (2026-10-11, candidate): `product` is the
 * maker's page for this very model; `brand` is a lineup, series or support page
 * of the maker (the UI says 「品牌頁」, not 「官網產品頁」).
 */
export const OFFICIAL_URL_KINDS = ["product", "brand"] as const;
export type OfficialUrlKind = (typeof OFFICIAL_URL_KINDS)[number];

/**
 * The links of ONE mouse (2026-10-11, candidate): the maker's own page and up to
 * four partner shops. Served by one function,
 * `GET /api/mice/<slug>/links`, built from `src/data/mouse-media.json` and
 * `src/data/purchase-links.json`, and kept by the CDN for a day per mouse (a
 * route per slug would put 408 function outputs in every deployment: see the
 * route). The results response stays small. The page
 * needs it only for the one mouse its big header shows. Never ranked or scored
 * by, and never part of the analysis input.
 */
export const mouseLinksSchema = z.strictObject({
  officialUrl: httpsUrlSchema.nullable(),
  officialKind: z.enum(OFFICIAL_URL_KINDS).nullable(),
  purchaseLinks: z.array(purchaseLinkSchema).max(4),
});
export type MouseLinks = z.infer<typeof mouseLinksSchema>;

/** slug → links, in display order (at most four per mouse). */
export const purchaseLinksSchema = z.record(
  /** A catalogue slug: lowercase words joined by single hyphens. */
  z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  z.array(purchaseLinkSchema).max(4),
);

export type PurchaseLink = z.infer<typeof purchaseLinkSchema>;
export type PurchaseLinks = z.infer<typeof purchaseLinksSchema>;
