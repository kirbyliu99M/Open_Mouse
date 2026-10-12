"use client";

import Link from "next/link";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { accountCopy } from "@/lib/copy/account";

/**
 * 「不登入，直接回答問卷」 on the signed-out view. For a person who has a scan in
 * this browser session it opens the questionnaire form through `onOpen`; with
 * no scan, or no `onOpen`, it goes to `/scan/easy` (a scan comes first).
 * `page.tsx` reads the scan from the scan-session cookie on the server and
 * passes its id (the scan session is an httpOnly cookie, so the browser itself
 * cannot read it); `SignedOutAnswer` in `AccountClient.tsx` supplies `onOpen`.
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
