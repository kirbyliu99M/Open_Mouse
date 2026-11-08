import type { MetadataRoute } from "next";
import { isIndexableDeployment } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

/**
 * Private pages (`/results/**`, `/l/**`, `/account`) are not listed here on
 * purpose: they carry `noindex`, and a crawler blocked by robots.txt never
 * reads that tag (a blocked URL that is linked from elsewhere can still be
 * listed without a description). Only machine endpoints are closed off.
 */
export default function robots(): MetadataRoute.Robots {
  if (!isIndexableDeployment()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/ingest/", "/monitoring"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
