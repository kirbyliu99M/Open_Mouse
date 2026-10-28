import type { Metadata } from "next";
import Link from "next/link";
import { ContentPage } from "@/components/content/ContentPage";
import { guidesCopy } from "@/lib/copy/guides";
import { localizedPath } from "@/lib/i18n/localePath";
import {
  GUIDES,
  SHAPES_COMPARED,
  lightestOfShape,
  statsByShape,
} from "@/lib/guides";
import { formatMm } from "@/lib/mice/compare";
import { mouseLabels } from "@/lib/mice/labels";
import { articleLd } from "@/lib/structured-data";
import { getLocale } from "@/server/i18n/getLocale";
import { listedMice, mouseName } from "@/server/seo/catalogue";
import { requestPageMetadata } from "@/server/seo/pageMetadata";

const GUIDE = GUIDES[1];

export async function generateMetadata(): Promise<Metadata> {
  return requestPageMetadata((locale) => {
    const c = guidesCopy(locale).shape;
    return {
      path: GUIDE.path,
      title: c.title,
      description: c.description,
      ogType: "article",
    };
  });
}

/**
 * Symmetrical versus ergonomic (SEO/GEO task, 2026-10-28, candidate /
 * 未拍板). The descriptions follow /learn; the counts, medians and lightest
 * lists are computed from the listed catalogue (`statsByShape`,
 * `lightestOfShape`).
 */
export default async function ShapeGuidePage() {
  const locale = await getLocale();
  const all = guidesCopy(locale);
  const c = all.shape;
  const labels = mouseLabels(locale);
  const rows = await listedMice();
  const stats = statsByShape(rows);

  return (
    <ContentPage
      locale={locale}
      path={GUIDE.path}
      title={c.title}
      lead={c.lead}
      trail={[[all.index.title, "/guides"]]}
      jsonLd={[
        articleLd({
          locale,
          path: GUIDE.path,
          headline: c.title,
          description: c.description,
          datePublished: GUIDE.published,
        }),
      ]}
    >
      <h2>{c.symmetricalHeading}</h2>
      <p>{c.symmetricalBody}</p>
      <h2>{c.ergonomicHeading}</h2>
      <p>{c.ergonomicBody}</p>
      <h2>{c.gripHeading}</h2>
      <p>{c.gripBody}</p>

      {rows.length > 0 ? (
        <>
          <h2>{c.numbersHeading}</h2>
          <ul>
            {SHAPES_COMPARED.map((shape) => {
              const s = stats[shape];
              const label = labels.shape(shape) ?? shape;
              if (
                s.count === 0 ||
                s.medianLengthMm === null ||
                s.medianWidthMm === null ||
                s.medianHeightMm === null
              ) {
                return null;
              }
              return (
                <li key={shape}>
                  {c.numbersLine(
                    label,
                    String(s.count),
                    formatMm(s.medianLengthMm),
                    formatMm(s.medianWidthMm),
                    formatMm(s.medianHeightMm),
                  )}
                  {s.medianWeightG === null
                    ? null
                    : ` ${c.numbersWeight(label, formatMm(s.medianWeightG))}`}
                </li>
              );
            })}
          </ul>
          {SHAPES_COMPARED.map((shape) => {
            const label = labels.shape(shape) ?? shape;
            const lightest = lightestOfShape(rows, shape, 5);
            return lightest.length === 0 ? null : (
              <section key={shape}>
                <h3>{c.lightestHeading(label)}</h3>
                <ul className="content-links">
                  {lightest.map((m) => (
                    <li key={m.slug}>
                      <Link href={localizedPath(`/mice/${m.slug}`, locale)}>
                        <span>{mouseName(m)}</span>
                        <span className="content-meta">
                          {formatMm(m.weightG as number)} g
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      ) : null}

      <p>{c.nextBody}</p>
      <p className="content-cta">
        <Link className="home-cta" href={localizedPath("/scan/easy", locale)}>
          {all.scanButton}
        </Link>
      </p>
      <ul className="content-links">
        <li>
          <Link
            href={localizedPath("/guides/mouse-size-for-hand-size", locale)}
          >
            {all.size.title}
          </Link>
        </li>
        <li>
          <Link href={localizedPath("/compare", locale)}>
            {all.compareLink}
          </Link>
        </li>
      </ul>
    </ContentPage>
  );
}
