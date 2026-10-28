import Link from "next/link";
import type { MouseEvent } from "react";
import { BrandLockup } from "@/components/nav/BrandLockup";
import { NavMenu } from "@/components/nav/NavMenu";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import type { Locale } from "@/lib/contracts/locale";
import { SurveyReminderLink } from "./SurveyReminderLink";

/**
 * Top bar of every results page, laid out as the landing page's nav (Kirby
 * 2026-10-26, candidate / 未拍板): the mark and "Palmate" on the left, a link
 * home; on the right the questionnaire reminder (a link to the profile page)
 * and the site menu. 重新掃描 moved to the end of the page
 * (`ResultsRescanLink`), and the share link went: the page has its own share
 * button.
 */
export function ResultsTopBar({
  language,
  onSurveyReminderClick,
}: {
  language: Locale;
  /** Analytics only; the bar behaves the same without it. */
  onSurveyReminderClick?: (unanswered: boolean) => void;
}) {
  const copy = RESULTS_PAGE_COPY[language];
  return (
    <nav className="results-topBar" aria-label={copy.topBarLabel}>
      <BrandLockup href="/" className="results-topBar-brand" />
      <div className="results-topBar-actions">
        <SurveyReminderLink
          language={language}
          onClick={onSurveyReminderClick}
        />
        <NavMenu />
      </div>
    </nav>
  );
}

/**
 * 重新掃描 at the end of the results (moved from the top bar, 2026-10-26). It
 * keeps what the top-bar link did: the analytics event, and V3.2 F11's way
 * back in history to the scan page when it is right behind the results
 * (`onBack` may `preventDefault`, `topBarBack` in resultsHistory.ts).
 */
export function ResultsRescanLink({
  language,
  onRetake,
  onBack,
}: {
  language: Locale;
  onRetake?: () => void;
  onBack?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const copy = RESULTS_PAGE_COPY[language];
  return (
    <div className="results-rescan">
      <Link
        href="/scan/easy"
        className="button-secondary results-rescan-link"
        onClick={
          onRetake || onBack
            ? (event) => {
                onRetake?.();
                onBack?.(event);
              }
            : undefined
        }
      >
        {copy.scanAgain}
      </Link>
    </div>
  );
}
