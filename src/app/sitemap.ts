import type { MetadataRoute } from "next";
import { SITEMAP_PATHS, absoluteUrl, isIndexableDeployment } from "@/lib/seo";

/** No `lastModified`: nothing here tracks when a page last changed, and a made-up date teaches the crawler to ignore the field. */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isIndexableDeployment()) return [];
  return SITEMAP_PATHS.map((path) => ({ url: absoluteUrl(path) }));
}
