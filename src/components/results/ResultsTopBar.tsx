import Link from "next/link";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import type { FitResponse } from "@/lib/contracts/fit";
import { ShareCardButton } from "./share/ShareCardButton";

/**
 * Top bar of every results page: the way back to a new scan on the left, the
 * site name in the centre (wide screens only), and the small share link on
 * the right. The share card is about the top pick, whichever page this is.
 */
export function ResultsTopBar({
  fit,
  language,
  onRetake,
}: {
  fit: FitResponse;
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
        // The accessible name is the destination alone, as the shared TopBar
        // does (`backLinkName`): the chevron stays decorative.
        aria-label={copy.backTo(copy.scanAgain)}
        onClick={onRetake}
      >
        <span aria-hidden="true">‹</span>
        <span>{copy.scanAgain}</span>
      </Link>
      <Link href="/" className="results-topBar-name">
        Palmate
      </Link>
      <div className="results-topBar-share" data-share-position="top">
        <ShareCardButton fit={fit} lang={language} variant="link" />
      </div>
    </nav>
  );
}
