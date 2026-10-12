"use client";

import { useLocale } from "@/client/i18n/LocaleProvider";
import { navCopy } from "@/lib/copy/nav";

/**
 * The small blue dot with the text 「尚未填答」 on the menu's profile item: the
 * person has not answered the questionnaire yet. The text is the cue; the dot
 * is decoration and never the only one (WCAG 2.2 AA). `NavMenu` draws it only
 * when its `profileUnanswered` prop is true.
 */
export function UnansweredMarker() {
  const copy = navCopy(useLocale());
  return (
    <span className="navMenuMarker" data-testid="nav-unanswered-marker">
      <span className="navMenuMarkerDot" aria-hidden="true" />
      {copy.unanswered}
    </span>
  );
}
