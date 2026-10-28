/**
 * schema.org structured data (JSON-LD) for the public pages (SEO task,
 * 2026-10-28). Search engines read it for rich results and AI answer engines
 * read it to tell what a page is about. Pure builders: each returns a plain
 * object the page serialises with `<JsonLd>`. Every number in them comes from
 * the catalogue or from tested TypeScript, never from a model (hard rule 2).
 */
import { LOCALE_HREFLANG, type Locale } from "./contracts/locale";
import { absoluteUrl, localizedUrl } from "./seo";
import { GITHUB_URL, SITE_NAME, SITE_URL } from "./site";

export type JsonLdObject = { "@context"?: string; "@type": string } & Record<
  string,
  unknown
>;

const CONTEXT = "https://schema.org";
const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;

/** The publisher: the student team that runs the site (privacy notice). */
export function organizationLd(): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl("/icon.png"),
    sameAs: [GITHUB_URL],
  };
}

export function websiteLd(description: string): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    "@id": SITE_ID,
    name: SITE_NAME,
    url: SITE_URL,
    description,
    inLanguage: ["zh-TW", "en"],
    publisher: { "@id": ORG_ID },
  };
}

/** The scanner itself, as a free web application that runs in the browser. */
export function webApplicationLd(input: {
  locale: Locale;
  name: string;
  description: string;
}): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "WebApplication",
    name: input.name,
    description: input.description,
    url: localizedUrl("/scan/easy", input.locale),
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any (web browser)",
    browserRequirements: "Requires a camera and JavaScript",
    isAccessibleForFree: true,
    inLanguage: LOCALE_HREFLANG[input.locale],
    publisher: { "@id": ORG_ID },
  };
}

/** A trail of `[name, unprefixed path]` pairs, home first. */
export function breadcrumbLd(
  locale: Locale,
  trail: readonly (readonly [string, string])[],
): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: trail.map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: localizedUrl(path, locale),
    })),
  };
}

export interface FaqEntry {
  question: string;
  /** Plain text; the page may render it with links, the data carries text. */
  answer: string;
}

export function faqPageLd(
  locale: Locale,
  path: string,
  entries: readonly FaqEntry[],
): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "FAQPage",
    url: localizedUrl(path, locale),
    inLanguage: LOCALE_HREFLANG[locale],
    mainEntity: entries.map((e) => ({
      "@type": "Question",
      name: e.question,
      acceptedAnswer: { "@type": "Answer", text: e.answer },
    })),
  };
}

export function articleLd(input: {
  locale: Locale;
  path: string;
  headline: string;
  description: string;
  /** ISO date (YYYY-MM-DD) the text was written. */
  datePublished: string;
  dateModified?: string;
}): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "Article",
    headline: input.headline,
    description: input.description,
    url: localizedUrl(input.path, input.locale),
    mainEntityOfPage: localizedUrl(input.path, input.locale),
    inLanguage: LOCALE_HREFLANG[input.locale],
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    author: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
    image: absoluteUrl("/opengraph-image.png"),
  };
}

/** Steps of a how-to, each a name and one sentence. */
export function howToLd(input: {
  locale: Locale;
  path: string;
  name: string;
  description: string;
  totalTime: string;
  supplies: readonly string[];
  steps: readonly { name: string; text: string }[];
}): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "HowTo",
    name: input.name,
    description: input.description,
    url: localizedUrl(input.path, input.locale),
    inLanguage: LOCALE_HREFLANG[input.locale],
    totalTime: input.totalTime,
    supply: input.supplies.map((name) => ({ "@type": "HowToSupply", name })),
    step: input.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}

/**
 * The JSON for a `<script type="application/ld+json">`: `<` is escaped so a
 * string in the data can never close the script element.
 */
export function serializeJsonLd(data: JsonLdObject | JsonLdObject[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
