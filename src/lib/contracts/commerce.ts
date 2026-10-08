/**
 * Purchase-link contract (2026-10-08). The results page reserves a slot above
 * the collapsed details for links that another team maintains, keyed by mouse
 * slug. The site never ranks or scores by these links; an empty or missing
 * entry renders nothing.
 */
import { z } from "zod";

export const purchaseLinkSchema = z.strictObject({
  /** Visible text, e.g. a shop name. Supplied by the link owner. */
  label: z.string().min(1).max(40),
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), { message: "https only" }),
});

/** slug → links, in display order (at most four per mouse). */
export const purchaseLinksSchema = z.record(
  z.string(),
  z.array(purchaseLinkSchema).max(4),
);

export type PurchaseLink = z.infer<typeof purchaseLinkSchema>;
export type PurchaseLinks = z.infer<typeof purchaseLinksSchema>;
