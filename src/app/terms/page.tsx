import type { Metadata } from "next";
import { requestPageMetadata } from "@/server/seo/pageMetadata";
import { pageMetaCopy } from "@/lib/copy/page-meta";
import { LegalPage } from "@/components/legal/LegalPage";
import { legalCopy } from "@/lib/copy/legal";
import { getLocale } from "@/server/i18n/getLocale";
import "../home.css";

export async function generateMetadata(): Promise<Metadata> {
  return requestPageMetadata((locale) => ({
    path: "/terms",
    title: legalCopy(locale).termsTitle,
    description: pageMetaCopy(locale).terms,
  }));
}

/** The terms of use (pre-launch audit 2026-10-28, candidate 未拍板). */
export default async function TermsPage() {
  const copy = legalCopy(await getLocale());
  return (
    <LegalPage
      copy={copy}
      title={copy.termsTitle}
      sections={copy.termsSections}
      other={{ href: "/privacy", label: copy.seePrivacy }}
    />
  );
}
