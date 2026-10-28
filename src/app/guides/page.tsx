import type { Metadata } from "next";
import Link from "next/link";
import { ContentPage } from "@/components/content/ContentPage";
import { faqCopy } from "@/lib/copy/faq";
import { guidesCopy } from "@/lib/copy/guides";
import { learnPageCopy } from "@/lib/copy/learn-page";
import { localizedPath } from "@/lib/i18n/localePath";
import { GUIDES } from "@/lib/guides";
import { getLocale } from "@/server/i18n/getLocale";
import { requestPageMetadata } from "@/server/seo/pageMetadata";

export async function generateMetadata(): Promise<Metadata> {
  return requestPageMetadata((locale) => {
    const c = guidesCopy(locale).index;
    return { path: "/guides", title: c.title, description: c.description };
  });
}

/** The guides hub (SEO/GEO task, 2026-10-28, candidate / 未拍板). */
export default async function GuidesPage() {
  const locale = await getLocale();
  const copy = guidesCopy(locale);
  const links: [string, string, string][] = [
    ...GUIDES.map(
      (g) =>
        [copy[g.key].title, copy[g.key].description, g.path] as [
          string,
          string,
          string,
        ],
    ),
    [learnPageCopy(locale).title, learnPageCopy(locale).lead, "/learn"],
  ];
  return (
    <ContentPage
      locale={locale}
      path="/guides"
      title={copy.index.title}
      lead={copy.index.lead}
    >
      {links.map(([title, description, path]) => (
        <section key={path}>
          <h2>
            <Link href={localizedPath(path, locale)}>{title}</Link>
          </h2>
          <p>{description}</p>
        </section>
      ))}
      <ul className="content-links">
        <li>
          <Link href={localizedPath("/compare", locale)}>
            {copy.compareLink}
          </Link>
        </li>
        <li>
          <Link href={localizedPath("/faq", locale)}>
            {faqCopy(locale).title}
          </Link>
        </li>
      </ul>
    </ContentPage>
  );
}
