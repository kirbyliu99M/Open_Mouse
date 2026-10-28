import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ContentPage } from "@/components/content/ContentPage";
import type { Locale } from "@/lib/contracts/locale";
import { mousePagesCopy, type DiffKind } from "@/lib/copy/mouse-pages";
import { localizedPath } from "@/lib/i18n/localePath";
import {
  formatMm,
  idealHandLengthMm,
  isIndexablePair,
  pairDiff,
  parsePairSegment,
} from "@/lib/mice/compare";
import { mouseLabels } from "@/lib/mice/labels";
import type { MiceListRow } from "@/lib/mice/list";
import type { JsonLdObject } from "@/lib/structured-data";
import { localizedUrl } from "@/lib/seo";
import { getLocale, getUrlLocale } from "@/server/i18n/getLocale";
import { findMouse, listedMice, mouseName } from "@/server/seo/catalogue";
import { requestPageMetadata } from "@/server/seo/pageMetadata";

type Params = Promise<{ pair: string }>;

interface Resolved {
  a: MiceListRow;
  b: MiceListRow;
  canonical: string;
  indexable: boolean;
}

/**
 * Both mice of a pair segment, or null. A pair is indexable when it is a
 * featured pair or one mouse is among the other's closest in size
 * (`indexablePairs`, the same list as the sitemap); any other pair of listed
 * mice still renders, as `noindex`, so a link never breaks but tens of
 * thousands of near-empty pairs are not offered to search engines.
 */
async function resolve(segment: string): Promise<Resolved | null> {
  const parsed = parsePairSegment(segment);
  if (!parsed) return null;
  const rows = await listedMice();
  const first = findMouse(rows, parsed.a);
  const second = findMouse(rows, parsed.b);
  if (!first || !second) return null;
  // The canonical order is alphabetical by slug: a is always the first.
  const [a, b] = first.slug < second.slug ? [first, second] : [second, first];
  return {
    a,
    b,
    canonical: parsed.canonical,
    indexable: isIndexablePair(rows, a, b),
  };
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const pair = await resolve((await params).pair);
  if (!pair) return { title: "404", robots: { index: false } };
  const meta = await requestPageMetadata((locale) => {
    const c = mousePagesCopy(locale).compare;
    const [na, nb] = [mouseName(pair.a), mouseName(pair.b)];
    return {
      path: `/compare/${pair.canonical}`,
      title: c.title(na, nb),
      description: c.description(na, nb),
      ogType: "article",
    };
  });
  return pair.indexable
    ? meta
    : { ...meta, robots: { index: false, follow: true } };
}

function signedMm(value: number, unit: string): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${formatMm(Math.abs(value))} ${unit}`;
}

function diffSentence(
  locale: Locale,
  kind: DiffKind,
  value: number,
  a: string,
  b: string,
): string {
  const d = mousePagesCopy(locale).compare.diff[kind];
  if (value === 0) return d.same;
  const amount = formatMm(Math.abs(value));
  return value > 0 ? d.more(b, a, amount) : d.less(b, a, amount);
}

function hand(mouse: MiceListRow, grip: "palm" | "claw" | "fingertip") {
  return (idealHandLengthMm(mouse.lengthMm, grip) / 10).toFixed(1);
}

/**
 * Two mice side by side (SEO task, 2026-10-28, candidate / 未拍板). Every
 * figure is the catalogue's or computed from it (`pairDiff`,
 * `idealHandLengthMm`); the sentences are templates. A segment in the other
 * order redirects to the canonical one.
 */
export default async function ComparePage({ params }: { params: Params }) {
  const { pair: segment } = await params;
  const pair = await resolve(segment);
  if (!pair) notFound();
  const locale = await getLocale();
  if (segment !== pair.canonical) {
    permanentRedirect(
      localizedPath(
        `/compare/${pair.canonical}`,
        (await getUrlLocale()) ?? "zh-TW",
      ),
    );
  }

  const copy = mousePagesCopy(locale);
  const c = copy.compare;
  const labels = mouseLabels(locale);
  const detail = copy.detail;
  const { a, b } = pair;
  const [na, nb] = [mouseName(a), mouseName(b)];
  const diff = pairDiff(a, b);
  const path = `/compare/${pair.canonical}`;

  const mm = (v: number) => `${formatMm(v)} ${copy.mm}`;
  const g = (v: number | null) =>
    v === null ? detail.unknown : `${formatMm(v)} ${copy.g}`;
  const rows: [string, string, string, string][] = [
    [
      detail.length,
      mm(a.lengthMm),
      mm(b.lengthMm),
      signedMm(diff.lengthMm, copy.mm),
    ],
    [
      detail.width,
      mm(a.widthMm),
      mm(b.widthMm),
      signedMm(diff.widthMm, copy.mm),
    ],
    [
      detail.height,
      mm(a.heightMm),
      mm(b.heightMm),
      signedMm(diff.heightMm, copy.mm),
    ],
    [
      detail.weight,
      g(a.weightG),
      g(b.weightG),
      diff.weightG === null ? "—" : signedMm(diff.weightG, copy.g),
    ],
    [detail.size, labels.size(a.size), labels.size(b.size), ""],
    [
      detail.shape,
      labels.shape(a.shape) ?? detail.unknown,
      labels.shape(b.shape) ?? detail.unknown,
      "",
    ],
    [
      detail.connection,
      labels.connectivity(a.connectivity) ?? detail.unknown,
      labels.connectivity(b.connectivity) ?? detail.unknown,
      "",
    ],
  ];

  const summary: string[] = [
    diffSentence(locale, "length", diff.lengthMm, na, nb),
    diffSentence(locale, "width", diff.widthMm, na, nb),
    diffSentence(locale, "height", diff.heightMm, na, nb),
    diff.weightG === null
      ? c.weightUnknown
      : diffSentence(locale, "weight", diff.weightG, na, nb),
    a.size === b.size
      ? c.sameSize(labels.size(a.size))
      : c.differentSize(na, labels.size(a.size), nb, labels.size(b.size)),
  ];
  const sa = labels.shape(a.shape);
  const sb = labels.shape(b.shape);
  if (sa && sb) {
    summary.push(
      sa === sb ? c.sameShape(sa) : c.differentShape(na, sa, nb, sb),
    );
  }

  const article: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: c.title(na, nb),
    description: c.description(na, nb),
    url: localizedUrl(path, locale),
    about: [a, b].map((m) => ({
      "@type": "Product",
      name: mouseName(m),
      brand: { "@type": "Brand", name: m.brand },
      url: localizedUrl(`/mice/${m.slug}`, locale),
    })),
  };

  return (
    <ContentPage
      locale={locale}
      path={path}
      title={c.title(na, nb)}
      lead={c.lead}
      trail={[[copy.index.title, "/compare"]]}
      jsonLd={[article]}
    >
      <h2>{c.summaryHeading}</h2>
      <ul>
        {summary.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>

      <h2>{c.tableHeading}</h2>
      <div className="content-table-wrap">
        <table className="content-table">
          <thead>
            <tr>
              <th scope="col">{c.spec}</th>
              <th scope="col">
                <Link href={localizedPath(`/mice/${a.slug}`, locale)}>
                  {na}
                </Link>
              </th>
              <th scope="col">
                <Link href={localizedPath(`/mice/${b.slug}`, locale)}>
                  {nb}
                </Link>
              </th>
              <th scope="col">{c.difference}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, va, vb, dv]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{va}</td>
                <td>{vb}</td>
                <td>{dv}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>{c.handHeading}</h2>
      <ul>
        {[a, b].map((m) => (
          <li key={m.slug}>
            {c.handBody(
              mouseName(m),
              hand(m, "palm"),
              hand(m, "claw"),
              hand(m, "fingertip"),
            )}
          </li>
        ))}
      </ul>
      <p className="content-note">{detail.provisional}</p>
      <p>{c.scanNote}</p>
      <p className="content-cta">
        <Link className="home-cta" href={localizedPath("/scan/easy", locale)}>
          {detail.scanCta}
        </Link>
      </p>
      <p className="content-note">{detail.disclaimer}</p>
    </ContentPage>
  );
}
