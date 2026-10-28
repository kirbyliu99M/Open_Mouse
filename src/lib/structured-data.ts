/**
 * Schema.org data (JSON-LD) for answer engines and search crawlers (AEO,
 * Kirby 2026-10-28: code only, no FAQ). Every text field reuses a string the
 * page already shows or the approved site description (`site-meta.ts`); this
 * file adds no wording of its own. The node ids are stable URLs so the home
 * page's graph and the How it works page's HowTo point at the same site.
 */
import type { Locale } from "./contracts/locale";
import { howItWorksCopy } from "./copy/how-it-works";
import { siteMetaCopy } from "./copy/site-meta";
import { absoluteUrl } from "./seo";
import { GITHUB_URL, SITE_NAME, SITE_URL } from "./site";

type JsonLd = Record<string, unknown>;

const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const APP_ID = `${SITE_URL}/#app`;

/** Home page: who runs the site, the site, and the tool itself. */
export function homeStructuredData(locale: Locale): JsonLd {
  const { description } = siteMetaCopy(locale);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORGANIZATION_ID,
        name: SITE_NAME,
        url: SITE_URL,
        logo: absoluteUrl("/icon.png"),
        sameAs: [GITHUB_URL],
      },
      {
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        name: SITE_NAME,
        url: SITE_URL,
        inLanguage: locale,
        publisher: { "@id": ORGANIZATION_ID },
      },
      {
        "@type": "WebApplication",
        "@id": APP_ID,
        name: SITE_NAME,
        url: SITE_URL,
        description,
        inLanguage: locale,
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Any",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@id": ORGANIZATION_ID },
      },
    ],
  };
}

/**
 * How it works page: its three steps as a HowTo. "About a minute" is the
 * page's own subhead, hence `PT1M`. Google no longer shows HowTo rich results,
 * but the markup still states the steps plainly for any reader.
 */
export function howItWorksStructuredData(
  locale: Locale,
  mouseCount: number | null,
): JsonLd {
  const copy = howItWorksCopy(locale);
  const url = absoluteUrl("/how-it-works");
  const steps = [
    [copy.step1Title, copy.step1Body],
    [copy.step2Title, copy.step2Body],
    [copy.step3Title, copy.step3Body(mouseCount)],
  ];
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "@id": `${url}#howto`,
    name: copy.title,
    description: copy.subhead,
    inLanguage: locale,
    url,
    totalTime: "PT1M",
    step: steps.map(([name, text], i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name,
      text,
    })),
    isPartOf: { "@id": WEBSITE_ID },
  };
}

/**
 * The JSON for a `<script type="application/ld+json">`. `<` is escaped so no
 * string can close the script element early (Next.js's own JSON-LD advice).
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
