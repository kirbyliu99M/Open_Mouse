import type { Metadata } from "next";
import { AccountNavLink } from "@/components/nav/AccountNavLink";
import { BrandLockup } from "@/components/nav/BrandLockup";
import { NavMenu } from "@/components/nav/NavMenu";
import { micePageCopy } from "@/lib/copy/mice-page";
import { navCopy } from "@/lib/copy/nav";
import { getMiceList } from "@/server/catalogue/list-mice";
import { getLocale } from "@/server/i18n/getLocale";
import "../home.css";
import { MiceBrowser } from "./MiceBrowser";

/** The title is the page's name; the root layout's template adds 「 · Palmate」. */
export async function generateMetadata(): Promise<Metadata> {
  return { title: micePageCopy(await getLocale()).title };
}

/**
 * All mice (PAGE-1, candidate / 未拍板; design: Pencil Product v2). A public,
 * crawlable list of every listed catalogue row, with the results page's filter
 * and a search. The page is rendered per request (it reads the visitor's
 * language, which makes every page dynamic: src/lib/contracts/locale.ts), so
 * `next build` needs no database; the catalogue read itself is cached for an
 * hour (`getMiceList`), and a failed read shows an empty list, not an error.
 */
export default async function MicePage() {
  const locale = await getLocale();
  const copy = micePageCopy(locale);
  const list = await getMiceList();

  return (
    <main className="mice-page">
      <nav className="home-nav" aria-label={navCopy(locale).primaryNavLabel}>
        <BrandLockup className="home-wordmark mice-wordmark" href="/" />
        <div className="home-nav-actions">
          <AccountNavLink />
          <NavMenu />
        </div>
      </nav>
      <header className="mice-header">
        <h1>{copy.title}</h1>
        <p className="mice-subtitle">{copy.subtitle}</p>
      </header>
      <MiceBrowser
        rows={list.rows}
        language={locale}
        unavailable={list.status === "unavailable"}
      />
    </main>
  );
}
