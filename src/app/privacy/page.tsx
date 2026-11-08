import type { Metadata } from "next";
import { requestPageMetadata } from "@/server/seo/pageMetadata";
import { pageMetaCopy } from "@/lib/copy/page-meta";
import { LegalPage } from "@/components/legal/LegalPage";
import { DeletePhotoForm } from "@/components/error-photo/DeletePhotoForm";
import { legalCopy } from "@/lib/copy/legal";
import { ERROR_PHOTO_ENABLED } from "@/lib/flags";
import { getLocale } from "@/server/i18n/getLocale";
import "../home.css";

export async function generateMetadata(): Promise<Metadata> {
  return requestPageMetadata((locale) => ({
    path: "/privacy",
    title: legalCopy(locale).privacyTitle,
    description: pageMetaCopy(locale).privacy,
  }));
}

/**
 * The privacy notice (pre-launch audit 2026-10-28, candidate 未拍板). With
 * the error-photo flag on, the "delete a photo I sent" form follows the
 * policy at `#delete-photo` (src/components/error-photo/DeletePhotoForm.tsx).
 */
export default async function PrivacyPage() {
  const locale = await getLocale();
  const copy = legalCopy(locale);
  return (
    <LegalPage
      copy={copy}
      title={copy.privacyTitle}
      intro={copy.privacyIntro}
      sections={copy.privacySections}
      other={{ href: "/terms", label: copy.seeTerms }}
    >
      {ERROR_PHOTO_ENABLED ? <DeletePhotoForm locale={locale} /> : null}
    </LegalPage>
  );
}
