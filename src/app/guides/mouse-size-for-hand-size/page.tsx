import type { Metadata } from "next";
import Link from "next/link";
import { ContentPage } from "@/components/content/ContentPage";
import { guidesCopy } from "@/lib/copy/guides";
import { localizedPath } from "@/lib/i18n/localePath";
import { GUIDES, SIZE_ORDER, statsBySize } from "@/lib/guides";
import { formatMm, handSizeChart } from "@/lib/mice/compare";
import { mouseLabels } from "@/lib/mice/labels";
import { percent } from "@/lib/faq";
import { articleLd } from "@/lib/structured-data";
import { SIZE_RULE } from "@/server/catalogue/size";
import { GRIP_WIDTH_FACTOR, LENGTH_FACTOR } from "@/server/fit/coefficients";
import { getLocale } from "@/server/i18n/getLocale";
import { listedMice } from "@/server/seo/catalogue";
import { requestPageMetadata } from "@/server/seo/pageMetadata";

const GUIDE = GUIDES[0];

export async function generateMetadata(): Promise<Metadata> {
  return requestPageMetadata((locale) => {
    const c = guidesCopy(locale).size;
    return {
      path: GUIDE.path,
      title: c.title,
      description: c.description,
      ogType: "article",
    };
  });
}

/**
 * Hand size to mouse size (SEO/GEO task, 2026-10-28, candidate / 未拍板). The
 * chart is `handSizeChart()` (the engine's `LENGTH_FACTOR`), the classes are
 * `SIZE_RULE`, the counts and medians are the listed catalogue's: nothing is
 * typed by hand, so the page follows the code.
 */
export default async function SizeGuidePage() {
  const locale = await getLocale();
  const all = guidesCopy(locale);
  const c = all.size;
  const labels = mouseLabels(locale);
  const chart = handSizeChart();
  const rows = await listedMice();
  const bySize = statsBySize(rows);
  const cm = (mm: number) => (mm / 10).toFixed(1);

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
      <h2>{c.measureHeading}</h2>
      <ul>
        <li>{c.measureLength}</li>
        <li>{c.measureWidth}</li>
      </ul>

      <h2>{c.chartHeading}</h2>
      <p>
        {c.chartIntro(
          percent(LENGTH_FACTOR.palm),
          percent(LENGTH_FACTOR.claw),
          percent(LENGTH_FACTOR.fingertip),
        )}
      </p>
      <div className="content-table-wrap">
        <table className="content-table">
          <caption>{c.chartCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{c.handLength}</th>
              <th scope="col">{c.palm}</th>
              <th scope="col">{c.claw}</th>
              <th scope="col">{c.fingertip}</th>
            </tr>
          </thead>
          <tbody>
            {chart.map((row) => (
              <tr key={row.handLengthMm}>
                <th scope="row">{cm(row.handLengthMm)} cm</th>
                <td>{row.target.palm} mm</td>
                <td>{row.target.claw} mm</td>
                <td>{row.target.fingertip} mm</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="content-note">{c.provisional}</p>

      <h2>{c.widthHeading}</h2>
      <p>{c.widthBody(percent(GRIP_WIDTH_FACTOR))}</p>

      <h2>{c.classesHeading}</h2>
      <p>
        {c.classesBody(
          String(SIZE_RULE.widthWeight),
          String(SIZE_RULE.widthPivotMm),
          String(SIZE_RULE.smallBelow),
          String(SIZE_RULE.mediumUpTo),
        )}
      </p>
      {rows.length > 0 ? (
        <ul>
          {SIZE_ORDER.map((size) => {
            const s = bySize[size];
            return s.count > 0 && s.medianLengthMm !== null ? (
              <li key={size}>
                {c.classLine(
                  labels.size(size),
                  String(s.count),
                  formatMm(s.medianLengthMm),
                )}
              </li>
            ) : null;
          })}
        </ul>
      ) : null}

      <h2>{c.nextHeading}</h2>
      <p>{c.nextBody}</p>
      <p className="content-cta">
        <Link className="home-cta" href={localizedPath("/scan/easy", locale)}>
          {all.scanButton}
        </Link>
      </p>
      <ul className="content-links">
        <li>
          <Link
            href={localizedPath("/guides/symmetrical-vs-ergonomic", locale)}
          >
            {all.shape.title}
          </Link>
        </li>
        <li>
          <Link href={localizedPath("/faq", locale)}>{all.faqLink}</Link>
        </li>
      </ul>
    </ContentPage>
  );
}
