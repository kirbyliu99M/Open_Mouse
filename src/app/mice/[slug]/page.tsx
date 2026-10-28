import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentPage } from "@/components/content/ContentPage";
import { micePageCopy } from "@/lib/copy/mice-page";
import { mousePagesCopy } from "@/lib/copy/mouse-pages";
import { localizedPath } from "@/lib/i18n/localePath";
import {
  formatMm,
  idealHandLengthMm,
  pairSegment,
  similarMice,
} from "@/lib/mice/compare";
import type { MiceListRow } from "@/lib/mice/list";
import { mouseLabels } from "@/lib/mice/labels";
import { absoluteUrl, localizedUrl } from "@/lib/seo";
import type { JsonLdObject } from "@/lib/structured-data";
import {
  findMouse,
  listedMice,
  mouseMediaFor,
  mouseName,
} from "@/server/seo/catalogue";
import { getLocale } from "@/server/i18n/getLocale";
import { requestPageMetadata } from "@/server/seo/pageMetadata";

type Params = Promise<{ slug: string }>;

/** Hand length in cm, one decimal, from the engine's inverse length target. */
function handCm(mouse: MiceListRow, grip: "palm" | "claw" | "fingertip") {
  return (idealHandLengthMm(mouse.lengthMm, grip) / 10).toFixed(1);
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug } = await params;
  const mouse = findMouse(await listedMice(), slug);
  if (!mouse) return { title: "404", robots: { index: false } };
  const name = mouseName(mouse);
  return requestPageMetadata((locale) => {
    const copy = mousePagesCopy(locale).detail;
    const [l, w, h] = [mouse.lengthMm, mouse.widthMm, mouse.heightMm].map(
      formatMm,
    );
    return {
      path: `/mice/${mouse.slug}`,
      title: copy.title(name),
      description:
        mouse.weightG === null
          ? copy.descriptionNoWeight(name, l, w, h)
          : copy.description(name, l, w, h, formatMm(mouse.weightG)),
    };
  });
}

/**
 * One mouse (SEO task, 2026-10-28, candidate / 未拍板): its listed
 * specifications, the hand length each grip's length target points to, its
 * closest rivals in size with links to the comparison, and Product JSON-LD.
 * Only listed mice have a page; any other slug is a 404.
 */
export default async function MousePage({ params }: { params: Params }) {
  const { slug } = await params;
  const rows = await listedMice();
  const mouse = findMouse(rows, slug);
  if (!mouse) notFound();

  const locale = await getLocale();
  const copy = mousePagesCopy(locale);
  const d = copy.detail;
  const labels = mouseLabels(locale);
  const name = mouseName(mouse);
  const media = mouseMediaFor(mouse.slug);
  const similar = similarMice(rows, mouse, 6);
  const palm = handCm(mouse, "palm");
  const claw = handCm(mouse, "claw");
  const fingertip = handCm(mouse, "fingertip");
  const path = `/mice/${mouse.slug}`;

  const specs: [string, string][] = [
    [d.length, `${formatMm(mouse.lengthMm)} ${copy.mm}`],
    [d.width, `${formatMm(mouse.widthMm)} ${copy.mm}`],
    [d.height, `${formatMm(mouse.heightMm)} ${copy.mm}`],
    [
      d.weight,
      mouse.weightG === null
        ? d.unknown
        : `${formatMm(mouse.weightG)} ${copy.g}`,
    ],
    [d.size, labels.size(mouse.size)],
    [d.shape, labels.shape(mouse.shape) ?? d.unknown],
    [d.connection, labels.connectivity(mouse.connectivity) ?? d.unknown],
  ];

  const product: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    brand: { "@type": "Brand", name: mouse.brand },
    category: "Computer mouse",
    url: localizedUrl(path, locale),
    ...(media?.image ? { image: absoluteUrl(media.image) } : {}),
    ...(media?.officialUrl ? { sameAs: media.officialUrl } : {}),
    depth: {
      "@type": "QuantitativeValue",
      value: mouse.lengthMm,
      unitCode: "MMT",
    },
    width: {
      "@type": "QuantitativeValue",
      value: mouse.widthMm,
      unitCode: "MMT",
    },
    height: {
      "@type": "QuantitativeValue",
      value: mouse.heightMm,
      unitCode: "MMT",
    },
    ...(mouse.weightG === null
      ? {}
      : {
          weight: {
            "@type": "QuantitativeValue",
            value: mouse.weightG,
            unitCode: "GRM",
          },
        }),
    additionalProperty: specs
      .slice(4)
      .map(([n, value]) => ({ "@type": "PropertyValue", name: n, value })),
  };

  return (
    <ContentPage
      locale={locale}
      path={path}
      title={d.title(name)}
      trail={[[micePageCopy(locale).title, "/mice"]]}
      jsonLd={[product]}
    >
      {media?.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local webp of known size, as on the results page
        <img
          className="content-photo"
          src={media.image}
          alt={d.photoAlt(name)}
          width={640}
          height={400}
        />
      ) : null}

      <h2>{d.specsHeading}</h2>
      <div className="content-table-wrap">
        <table className="content-table">
          <tbody>
            {specs.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>{d.handFitHeading}</h2>
      <p>{d.handFitBody(name, palm, claw, fingertip)}</p>
      <p className="content-note">{d.provisional}</p>
      <p className="content-cta">
        <Link className="home-cta" href={localizedPath("/scan/easy", locale)}>
          {d.scanCta}
        </Link>
      </p>

      {similar.length > 0 ? (
        <>
          <h2>{d.similarHeading}</h2>
          <p>{d.similarLead}</p>
          <ul className="content-links">
            {similar.map((other) => (
              <li key={other.slug}>
                <Link
                  href={localizedPath(
                    `/compare/${pairSegment(mouse.slug, other.slug)}`,
                    locale,
                  )}
                >
                  <span>{d.compareWith(mouseName(other))}</span>
                  <span className="content-meta">
                    {formatMm(other.lengthMm)} × {formatMm(other.widthMm)} ×{" "}
                    {formatMm(other.heightMm)} {copy.mm}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {media?.officialUrl ? (
        <p>
          <a href={media.officialUrl} rel="noopener noreferrer nofollow">
            {d.officialLink}
          </a>
        </p>
      ) : null}
      <p className="content-note">{d.disclaimer}</p>
    </ContentPage>
  );
}
