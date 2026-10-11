"use client";

import { useLocale } from "@/client/i18n/LocaleProvider";
import { sheetCopy } from "@/lib/copy/sheet";

export function PrintButton() {
  const copy = sheetCopy(useLocale());
  return (
    <button
      type="button"
      className="sheet-primary"
      onClick={() => window.print()}
    >
      {copy.printTheSheet}
    </button>
  );
}
