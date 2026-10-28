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
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_HREFLANG,
  LOCALE_OG,
  type Locale,
} from "./contracts/locale";
import { localizedPath } from "./i18n/localePath";
import { SITE_NAME, SITE_URL } from "./site";

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
  "/privacy",
  "/terms",
] as const;

export interface SitemapEntry {
  url: string;
  alternates: { languages: Record<string, string> };
}

/**
 * One sitemap entry per page per locale, each naming every language version
 * (`xhtml:link rel="alternate"`), so a crawler finds the `/en` URLs without
 * following a link.
 */
export function sitemapEntries(paths: readonly string[]): SitemapEntry[] {
  return paths.flatMap((path) =>
    LOCALES.map((locale) => ({
      url: localizedUrl(path, locale),
      alternates: { languages: languageAlternates(path) },
    })),
  );
}

export function absoluteUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}

/** The absolute URL of `path` (unprefixed) in `locale`. */
export function localizedUrl(path: string, locale: Locale): string {
  return absoluteUrl(localizedPath(path, locale));
}

/**
 * `hreflang` alternates of a public page: one URL per locale, and the zh-TW
 * (unprefixed) URL as `x-default`, the URL that negotiates for a visitor
 * with no prefix.
 */
export function languageAlternates(path: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of LOCALES) {
    languages[LOCALE_HREFLANG[locale]] = localizedUrl(path, locale);
  }
  languages["x-default"] = localizedUrl(path, DEFAULT_LOCALE);
  return languages;
}

export interface PageMetaInput {
  /** The page's unprefixed path, e.g. `/mice`. */
  path: string;
  /** The locale the page is rendered in. */
  locale: Locale;
  /**
   * The locale the URL names (`/en/...`), or null for an unprefixed URL. The
   * canonical URL follows it: an unprefixed URL is always the zh-TW address.
   */
  urlLocale: Locale | null;
  /** The page title without the site name; omit for the home page's whole title. */
  title?: string;
  /** The whole `<title>`, bypassing the root template (the home page). */
  absoluteTitle?: string;
  description: string;
  /** `og:type`; "website" unless an article. */
  ogType?: "website" | "article";
}

/**
 * Metadata of a public, indexable page: title, description, the canonical
 * URL of the locale the URL names, `hreflang` alternates, and share cards
 * that carry the page's own title, description and URL. The share image is
 * named explicitly: a page that sets `openGraph` replaces the parent's whole
 * object, and the file-convention image in `src/app` only reaches the home
 * page's own segment.
 */
/** `src/app/opengraph-image.png` (the same file as twitter-image.png). */
export const SHARE_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  alt: SITE_NAME,
} as const;

export function pageMetadata(input: PageMetaInput): Metadata {
  const canonical = localizedUrl(input.path, input.urlLocale ?? DEFAULT_LOCALE);
  const shareTitle =
    input.absoluteTitle ??
    (input.title ? `${input.title} · ${SITE_NAME}` : SITE_NAME);
  return {
    title: input.absoluteTitle
      ? { absolute: input.absoluteTitle }
      : input.title,
    description: input.description,
    alternates: { canonical, languages: languageAlternates(input.path) },
    openGraph: {
      title: shareTitle,
      description: input.description,
      url: canonical,
      siteName: SITE_NAME,
      type: input.ogType ?? "website",
      images: [SHARE_IMAGE],
      locale: LOCALE_OG[input.locale],
      alternateLocale: LOCALES.filter((l) => l !== input.locale).map(
        (l) => LOCALE_OG[l],
      ),
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description: input.description,
      images: [SHARE_IMAGE.url],
    },
  };
}
