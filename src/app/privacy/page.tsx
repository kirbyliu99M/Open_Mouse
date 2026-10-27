import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { legalCopy } from "@/lib/copy/legal";
import { getLocale } from "@/server/i18n/getLocale";
import "../home.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: legalCopy(await getLocale()).privacyTitle };
}

/** The privacy notice (pre-launch audit 2026-10-28, candidate 未拍板). */
export default async function PrivacyPage() {
  const copy = legalCopy(await getLocale());
  return (
    <LegalPage
      copy={copy}
      title={copy.privacyTitle}
      intro={copy.privacyIntro}
      sections={copy.privacySections}
      other={{ href: "/terms", label: copy.seeTerms }}
    />
  );
}
