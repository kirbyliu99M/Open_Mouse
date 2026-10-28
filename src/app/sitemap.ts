import type { MetadataRoute } from "next";
import { indexablePairs } from "@/lib/mice/compare";
import {
  SITEMAP_PATHS,
  isIndexableDeployment,
  sitemapEntries,
} from "@/lib/seo";
import { listedMice } from "@/server/seo/catalogue";

/**
 * Read per request (the catalogue lives in the database, which `next build`
 * does not have); the catalogue read itself is cached for an hour.
 */
export const dynamic = "force-dynamic";

/**
 * Every public page in every locale, each with its `hreflang` alternates: the
 * fixed pages, one page per listed mouse, and the comparisons that are
 * indexable (`indexablePairs`). No `lastModified`: nothing here tracks when a
 * page last changed, and a made-up date teaches the crawler to ignore the
 * field.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!isIndexableDeployment()) return [];
  const rows = await listedMice();
  return sitemapEntries([
    ...SITEMAP_PATHS,
    ...rows.map((r) => `/mice/${r.slug}`),
    ...indexablePairs(rows).map((p) => `/compare/${p}`),
  ]);
}
