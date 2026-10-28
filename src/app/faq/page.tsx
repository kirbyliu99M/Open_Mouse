import type { Metadata } from "next";
import Link from "next/link";
import { ContentPage } from "@/components/content/ContentPage";
import { faqCopy } from "@/lib/copy/faq";
import { faqGroups, type FaqFacts } from "@/lib/faq";
import { localizedPath } from "@/lib/i18n/localePath";
import { faqPageLd } from "@/lib/structured-data";
import { BASE_WEIGHTS, LENGTH_FACTOR } from "@/server/fit/coefficients";
import { getLocale } from "@/server/i18n/getLocale";
import { listedMice } from "@/server/seo/catalogue";
import { requestPageMetadata } from "@/server/seo/pageMetadata";

export async function generateMetadata(): Promise<Metadata> {
  return requestPageMetadata((locale) => {
    const copy = faqCopy(locale);
    return { path: "/faq", title: copy.title, description: copy.description };
  });
}

/**
 * Frequently asked questions (SEO/GEO task, 2026-10-28, candidate / 未拍板).
 * The visible answers and the FAQPage JSON-LD come from one list
 * (`faqGroups`), so they can never disagree.
 */
export default async function FaqPage() {
  const locale = await getLocale();
  const copy = faqCopy(locale);
  const rows = await listedMice();
  const facts: FaqFacts = {
    lengthFactor: LENGTH_FACTOR,
    weights: BASE_WEIGHTS,
    catalogue:
      rows.length === 0
        ? null
        : { mice: rows.length, brands: new Set(rows.map((r) => r.brand)).size },
  };
  const groups = faqGroups(copy, facts);

  return (
    <ContentPage
      locale={locale}
      path="/faq"
      title={copy.title}
      lead={copy.lead}
      jsonLd={[
        faqPageLd(
          locale,
          "/faq",
          groups.flatMap((g) => g.entries),
        ),
      ]}
    >
      {groups.map((group) => (
        <section key={group.heading}>
          <h2>{group.heading}</h2>
          <ul className="content-faq">
            {group.entries.map((e) => (
              <li key={e.question}>
                <h3>{e.question}</h3>
                <p>{e.answer}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <ul className="content-links">
        <li>
          <Link
            href={localizedPath("/guides/mouse-size-for-hand-size", locale)}
          >
            {copy.sizeGuideLink}
          </Link>
        </li>
        <li>
          <Link href={localizedPath("/learn", locale)}>{copy.learnLink}</Link>
        </li>
      </ul>
      <p className="content-cta">
        <Link className="home-cta" href={localizedPath("/scan/easy", locale)}>
          {copy.scanButton}
        </Link>
      </p>
    </ContentPage>
  );
}
