import type { MetadataRoute } from "next";
import { isIndexableDeployment } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

/**
 * Private pages (`/results/**`, `/l/**`, `/account`) are not listed here on
 * purpose: they carry `noindex`, and a crawler blocked by robots.txt never
 * reads that tag (a blocked URL that is linked from elsewhere can still be
 * listed without a description). Only machine endpoints are closed off, and
 * the hidden data-tester page (`/scan/tester`, candidate), which no public
 * page links to and whose existence need not be advertised.
 */
export default function robots(): MetadataRoute.Robots {
  if (!isIndexableDeployment()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/ingest/",
        "/monitoring",
        "/scan/tester",
        "/en/scan/tester",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
