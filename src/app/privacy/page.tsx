import type { Metadata } from "next";
import { requestPageMetadata } from "@/server/seo/pageMetadata";
import { pageMetaCopy } from "@/lib/copy/page-meta";
import { LegalPage } from "@/components/legal/LegalPage";
import { legalCopy } from "@/lib/copy/legal";
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
 * It is imported only in the flag's branch, which an off build removes
 * (next.config.ts defines the variable; review F1).
 */
export default async function PrivacyPage() {
  const locale = await getLocale();
  const copy = legalCopy(locale);
  let deleteForm = null;
  if (process.env.NEXT_PUBLIC_ERROR_PHOTO_ENABLED === "1") {
    const { DeletePhotoForm } =
      await import("@/components/error-photo/DeletePhotoForm");
    deleteForm = <DeletePhotoForm locale={locale} />;
  }
  return (
    <LegalPage
      copy={copy}
      title={copy.privacyTitle}
      intro={copy.privacyIntro}
      sections={copy.privacySections}
      other={{ href: "/terms", label: copy.seeTerms }}
    >
      {deleteForm}
    </LegalPage>
  );
}
