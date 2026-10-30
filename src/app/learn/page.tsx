import type { Metadata } from "next";
import Link from "next/link";
import { guidesCopy } from "@/lib/copy/guides";
import { requestPageMetadata } from "@/server/seo/pageMetadata";
import { pageMetaCopy } from "@/lib/copy/page-meta";
import { AccountNavLink } from "@/components/nav/AccountNavLink";
import { BrandLockup } from "@/components/nav/BrandLockup";
import { NavMenu } from "@/components/nav/NavMenu";
import { LearnInfo } from "@/components/learn/LearnInfo";
import { learnPageCopy } from "@/lib/copy/learn-page";
import { navCopy } from "@/lib/copy/nav";
import { getLocale } from "@/server/i18n/getLocale";
import "../home.css";
import "./learn-info.css";
import { localizedPath } from "@/lib/i18n/localePath";
import { JsonLd } from "@/components/seo/JsonLd";
import { articleLd, breadcrumbLd } from "@/lib/structured-data";

export async function generateMetadata(): Promise<Metadata> {
  return requestPageMetadata((locale) => ({
    path: "/learn",
    title: learnPageCopy(locale).title,
    description: pageMetaCopy(locale).learn,
    ogType: "article",
  }));
}

/**
 * "How to choose a mouse that fits" (Pencil board "三頁設計", Learn v2; copy
 * candidate, 未拍板). A public information page with no numbers. The learning
 * kit that used to live here is under /learn/kit and answers only on a local
 * `next dev` (src/app/scan/demo-guard.ts).
 */
export default async function LearnPage() {
  const locale = await getLocale();
  const copy = learnPageCopy(locale);
  const guides = guidesCopy(locale);
  return (
    <main className="learn-info">
      <JsonLd
        data={[
          articleLd({
            locale,
            path: "/learn",
            headline: copy.title,
            description: pageMetaCopy(locale).learn,
            datePublished: "2026-10-12",
            dateModified: "2026-10-28",
          }),
          breadcrumbLd(locale, [
            [navCopy(locale).home, "/"],
            [copy.title, "/learn"],
          ]),
        ]}
      />
      <nav className="home-nav" aria-label={navCopy(locale).primaryNavLabel}>
        <BrandLockup
          className="home-wordmark learn-info-wordmark"
          href={localizedPath("/", locale)}
        />
        <div className="home-nav-actions">
          <AccountNavLink />
          <NavMenu />
        </div>
      </nav>
      <LearnInfo copy={copy} locale={locale} />
      <ul className="learn-more-links">
        <li>
          <Link
            href={localizedPath("/guides/mouse-size-for-hand-size", locale)}
          >
            {guides.size.title}
          </Link>
        </li>
        <li>
          <Link
            href={localizedPath("/guides/symmetrical-vs-ergonomic", locale)}
          >
            {guides.shape.title}
          </Link>
        </li>
        <li>
          <Link href={localizedPath("/faq", locale)}>{guides.faqLink}</Link>
        </li>
      </ul>
    </main>
  );
}
