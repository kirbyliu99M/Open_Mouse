import type { Locale } from "@/lib/contracts/locale";
import { navCopy } from "@/lib/copy/nav";

/** Gives the return link a destination name for screen readers. */
export function backLinkName(backLabel: string, locale: Locale = "en"): string {
  return navCopy(locale).backTo(backLabel);
}
