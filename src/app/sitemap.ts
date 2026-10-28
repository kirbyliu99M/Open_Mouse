import type { MetadataRoute } from "next";
import {
  SITEMAP_PATHS,
  isIndexableDeployment,
  sitemapEntries,
} from "@/lib/seo";

/**
 * Every public page in every locale, each with its `hreflang` alternates. No
 * `lastModified`: nothing here tracks when a page last changed, and a made-up
 * date teaches the crawler to ignore the field.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isIndexableDeployment()) return [];
  return sitemapEntries(SITEMAP_PATHS);
}
