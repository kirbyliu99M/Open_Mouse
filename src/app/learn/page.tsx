import type { Metadata } from "next";
import Link from "next/link";
import { AccountNavLink } from "@/components/nav/AccountNavLink";
import { NavMenu } from "@/components/nav/NavMenu";
import { LearnInfo } from "@/components/learn/LearnInfo";
import { learnPageCopy } from "@/lib/copy/learn-page";
import { navCopy } from "@/lib/copy/nav";
import { SITE_NAME } from "@/lib/site";
import { getLocale } from "@/server/i18n/getLocale";
import "../home.css";
import "./learn-info.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: learnPageCopy(await getLocale()).title };
}

/**
 * "How to choose a mouse that fits" (Pencil board "三頁設計", Learn v2; copy
 * candidate, 未拍板). A public information page with no numbers. The learning
 * kit that used to live here is under /learn/kit and answers only on a local
 * `next dev` (src/app/scan/demo-guard.ts).
 */
export default async function LearnPage() {
  const locale = await getLocale();
  return (
    <main className="learn-info">
      <nav className="home-nav" aria-label={navCopy(locale).primaryNavLabel}>
        <Link className="home-wordmark learn-info-wordmark" href="/">
          {SITE_NAME}
        </Link>
        <div className="home-nav-actions">
          <AccountNavLink />
          <NavMenu />
        </div>
      </nav>
      <LearnInfo copy={learnPageCopy(locale)} />
    </main>
  );
}
