import Link from "next/link";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";

/**
 * Top bar of every results page: the way back to a new scan on the left, the
 * site name in the centre (wide screens only), and a spot on the right for the
 * share button, which is wired in separately.
 */
export function ResultsTopBar({
  language,
  onRetake,
}: {
  language: UiLanguage;
  onRetake?: () => void;
}) {
  const copy = RESULTS_PAGE_COPY[language];
  const lang = uiLangAttribute(language);
  return (
    <nav className="results-topBar" aria-label={copy.topBarLabel} lang={lang}>
      <Link
        href="/scan/easy"
        className="results-topBar-back"
        onClick={onRetake}
      >
        <span aria-hidden="true">‹</span>
        <span>{copy.scanAgain}</span>
      </Link>
      <Link href="/" className="results-topBar-name">
        Palmate
      </Link>
      <div
        className="results-topBar-share"
        data-testid="share-slot"
        data-share-position="top"
      />
    </nav>
  );
}
