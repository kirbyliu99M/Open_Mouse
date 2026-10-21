import Link from "next/link";
import type { MouseEvent } from "react";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import type { Locale } from "@/lib/contracts/locale";
import type { FitResponse } from "@/lib/contracts/fit";
import { SITE_NAME } from "@/lib/site";
import { ShareCardButton } from "./share/ShareCardButton";
import type { ShareOutcome } from "./share/shareDecision";
import { SurveyReminderLink } from "./SurveyReminderLink";

/**
 * Top bar of every results page: the way back to a new scan on the left, the
 * site name in the centre (wide screens only), and on the right the
 * questionnaire reminder (a link to the profile page, candidate) and the small
 * share link. The share card is about the top pick, whichever page this is.
 */
export function ResultsTopBar({
  fit,
  language,
  onRetake,
  onSurveyReminderClick,
  onShareStarted,
  onShareFinished,
  onBack,
}: {
  fit: FitResponse;
  language: Locale;
  /** The four callbacks are analytics only; the bar behaves the same without them. */
  onRetake?: () => void;
  onSurveyReminderClick?: (unanswered: boolean) => void;
  onShareStarted?: () => void;
  onShareFinished?: (outcome: ShareOutcome) => void;
  /**
   * V3.2 F11: may take the back link over (`preventDefault`) to go back in
   * history to the scan page when it is right behind the results, so it does
   * what the browser's back does (`topBarBack` in resultsHistory.ts).
   */
  onBack?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const copy = RESULTS_PAGE_COPY[language];
  return (
    <nav className="results-topBar" aria-label={copy.topBarLabel}>
      <Link
        href="/scan/easy"
        className="results-topBar-back"
        // The accessible name is the destination alone, as the shared TopBar
        // does (`backLinkName`): the chevron stays decorative.
        aria-label={copy.backTo(copy.scanAgain)}
        onClick={
          onRetake || onBack
            ? (event) => {
                onRetake?.();
                onBack?.(event);
              }
            : undefined
        }
      >
        <span aria-hidden="true">‹</span>
        <span>{copy.scanAgain}</span>
      </Link>
      <Link href="/" className="results-topBar-name">
        {SITE_NAME}
      </Link>
      <div className="results-topBar-actions">
        <SurveyReminderLink
          language={language}
          onClick={onSurveyReminderClick}
        />
        <div className="results-topBar-share" data-share-position="top">
          <ShareCardButton
            fit={fit}
            lang={language}
            variant="link"
            onShareStarted={onShareStarted}
            onShareFinished={onShareFinished}
          />
        </div>
      </div>
    </nav>
  );
}
