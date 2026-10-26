/**
 * What search engines may index, in one place. The root layout, `robots.ts`
 * and `sitemap.ts` read it.
 *
 * Only the production deployment is indexable. A Vercel preview has no
 * password, so it stays `noindex` (and `Disallow: /`); an unset `VERCEL_ENV`
 * (local dev, the e2e suite, `next start`) is treated as indexable, which
 * harms nothing and lets the tests see the production metadata.
 */
import type { Metadata } from "next";
import { SITE_URL } from "./site";

export function isIndexableDeployment(
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): boolean {
  return vercelEnv === undefined || vercelEnv === "production";
}

export function siteRobots(
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): NonNullable<Metadata["robots"]> {
  return isIndexableDeployment(vercelEnv)
    ? { index: true, follow: true }
    : { index: false, follow: false };
}

/**
 * The public pages that belong in the sitemap. A page that is private
 * (`/results/**`, `/l/**`, `/account`), closed in production (`/scan`,
 * `/sheet`, the demos, `/learn/kit/**`) or an API route is not listed.
 */
export const SITEMAP_PATHS = [
  "/",
  "/scan/easy",
  "/learn",
  "/mice",
  "/how-it-works",
] as const;

export function absoluteUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}
