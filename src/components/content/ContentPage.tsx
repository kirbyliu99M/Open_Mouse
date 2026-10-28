import Link from "next/link";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/seo/JsonLd";
import type { Locale } from "@/lib/contracts/locale";
import { navCopy } from "@/lib/copy/nav";
import { localizedPath } from "@/lib/i18n/localePath";
import { breadcrumbLd, type JsonLdObject } from "@/lib/structured-data";
import "../../app/home.css";
import "./content.css";

/**
 * The frame of an article page (SEO task, 2026-10-28, candidate / 未拍板): a
 * visible breadcrumb (also given to search engines as BreadcrumbList), the
 * h1, the lead, the body, and the page's own JSON-LD. `trail` is the pages
 * above this one, home excluded, as `[name, unprefixed path]`.
 */
export function ContentPage({
  locale,
  path,
  title,
  lead,
  trail = [],
  jsonLd = [],
  children,
}: {
  locale: Locale;
  path: string;
  title: string;
  lead?: string;
  trail?: readonly (readonly [string, string])[];
  jsonLd?: JsonLdObject[];
  children: ReactNode;
}) {
  const home = navCopy(locale).home;
  const crumbs: (readonly [string, string])[] = [[home, "/"], ...trail];
  return (
    <main className="home-main home-how-page content-page">
      <JsonLd
        data={[...jsonLd, breadcrumbLd(locale, [...crumbs, [title, path]])]}
      />
      <nav aria-label="Breadcrumb">
        <ol className="content-breadcrumb">
          {crumbs.map(([name, href]) => (
            <li key={href}>
              <Link href={localizedPath(href, locale)}>{name}</Link>
            </li>
          ))}
          <li>
            <span aria-current="page">{title}</span>
          </li>
        </ol>
      </nav>
      <h1>{title}</h1>
      {lead ? <p className="content-lead">{lead}</p> : null}
      {children}
    </main>
  );
}
