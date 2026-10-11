"use client";

import Link from "next/link";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { accountCopy } from "@/lib/copy/account";

/**
 * 「不登入，直接回答問卷」 on the signed-out view. For a person who has a scan in
 * this browser session it opens the questionnaire form (built elsewhere, by
 * Builder Q) through `onOpen`; with no scan, or no `onOpen`, it goes to
 * `/scan/easy` (a scan comes first). The signed-out page cannot yet tell
 * whether this browser holds a scan (no client-readable scan id exists, the
 * scan session is an httpOnly cookie), so `page.tsx` passes `scanId` null and
 * the link always scans first until that is decided.
 */
export function AnonymousAnswerLink({
  scanId,
  onOpen,
}: {
  scanId: string | null;
  onOpen?: (scanId: string) => void;
}) {
  const copy = accountCopy(useLocale());
  if (scanId !== null && onOpen) {
    return (
      <button
        type="button"
        className="account-skip-link"
        onClick={() => onOpen(scanId)}
      >
        {copy.answerWithoutAccount}
      </button>
    );
  }
  return (
    <Link className="account-skip-link" href="/scan/easy">
      {copy.answerWithoutAccount}
    </Link>
  );
}
