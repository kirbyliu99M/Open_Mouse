import type { Metadata } from "next";
import Link from "next/link";
import { ContentPage } from "@/components/content/ContentPage";
import { mousePagesCopy } from "@/lib/copy/mouse-pages";
import { localizedPath } from "@/lib/i18n/localePath";
import { FEATURED_PAIRS, formatMm, pairSegment } from "@/lib/mice/compare";
import { getLocale } from "@/server/i18n/getLocale";
import { findMouse, listedMice, mouseName } from "@/server/seo/catalogue";
import { requestPageMetadata } from "@/server/seo/pageMetadata";

export async function generateMetadata(): Promise<Metadata> {
  return requestPageMetadata((locale) => {
    const c = mousePagesCopy(locale).index;
    return { path: "/compare", title: c.title, description: c.description };
  });
}

/** The comparison hub (SEO task, 2026-10-28, candidate / 未拍板): the featured pairs that are listed. */
export default async function CompareIndexPage() {
  const locale = await getLocale();
  const copy = mousePagesCopy(locale);
  const rows = await listedMice();
  const pairs = FEATURED_PAIRS.flatMap(([sa, sb]) => {
    const a = findMouse(rows, sa);
    const b = findMouse(rows, sb);
    return a && b ? [{ a, b }] : [];
  });

  return (
    <ContentPage
      locale={locale}
      path="/compare"
      title={copy.index.title}
      lead={copy.index.lead}
    >
      {pairs.length > 0 ? (
        <>
          <h2>{copy.index.featuredHeading}</h2>
          <ul className="content-links">
            {pairs.map(({ a, b }) => (
              <li key={`${a.slug}|${b.slug}`}>
                <Link
                  href={localizedPath(
                    `/compare/${pairSegment(a.slug, b.slug)}`,
                    locale,
                  )}
                >
                  <span>
                    {mouseName(a)} {copy.vs} {mouseName(b)}
                  </span>
                  <span className="content-meta">
                    {formatMm(a.lengthMm)} / {formatMm(b.lengthMm)} {copy.mm}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h2>{copy.index.howHeading}</h2>
      <p>{copy.index.howBody}</p>
      <p>
        <Link href={localizedPath("/mice", locale)}>
          {copy.index.browseMice}
        </Link>
      </p>
    </ContentPage>
  );
}
