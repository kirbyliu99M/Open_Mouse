/**
 * Purchase-link contract (2026-10-08). The results page reserves a slot above
 * the collapsed details for links that another team maintains, keyed by mouse
 * slug. The site never ranks or scores by these links; an empty or missing
 * entry renders nothing.
 */
import { z } from "zod";

export const purchaseLinkSchema = z.strictObject({
  /** Visible text, e.g. a shop name. Supplied by the link owner. */
  label: z.string().trim().min(1).max(40),
  /** https only, a real host, and no user name or password in the URL. */
  url: z.string().refine(
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
  ),
});

/** slug → links, in display order (at most four per mouse). */
export const purchaseLinksSchema = z.record(
  /** A catalogue slug: lowercase words joined by single hyphens. */
  z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  z.array(purchaseLinkSchema).max(4),
);

export type PurchaseLink = z.infer<typeof purchaseLinkSchema>;
export type PurchaseLinks = z.infer<typeof purchaseLinksSchema>;
