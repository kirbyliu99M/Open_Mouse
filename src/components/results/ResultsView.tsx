import type { FitEntry, FitResponse } from "@/lib/contracts/fit";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { en as enBands, zhTW as zhBands } from "@/lib/copy/fit-bands";
import { bandOf } from "@/lib/fit/bands";
import { handTypeLabel } from "@/lib/results/handTypeLabel";
import {
  entryAtRank,
  otherPicks,
  pathForEntry,
} from "@/lib/results/rankRoutes";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import type { AnalysisState } from "./analysisState";
import { OtherMice } from "./OtherMice";
import { OtherPicks } from "./OtherPicks";
import { MousePhoto } from "./MousePhoto";
import { PurchaseSlot } from "./PurchaseSlot";
import { ResultsDetails } from "./ResultsDetails";
import { ResultsTopBar } from "./ResultsTopBar";
import { PrintOpenDetails } from "./PrintOpenDetails";
import { WhyList } from "./WhyList";
import "./results.css";
import { POOR_FIT_THRESHOLD } from "./fitNotice";

const BAND_COPY = { "zh-TW": zhBands, en: enBands } as const;

/**
 * Renders one page of a `FitResponse` — the only data input this component
 * tree takes. No fetching, no analysis calls: `analysisState` is handed in by
 * the caller. `rank` is the mouse the page is about: 1 for the main results
 * page, 2 to 5 for a detail page, which has the same layout. The written
 * analysis is only shown for rank 1.
 *
 * Order: top bar, hand type (when the response has one), photo, rank and
 * score, why, purchase links (when there are any), details (closed), other
 * picks, other mice (closed).
 */
export function ResultsView({
  response,
  rank = 1,
  language,
  analysisState = { status: "idle" },
  onRetryAnalysis,
  enteredLengthMm = null,
  showViewer = false,
  scanId,
  onSelectRank,
  purchaseSource,
  analytics,
}: {
  response: FitResponse;
  /** Which mouse the page is about. Defaults to the top pick. */
  rank?: number;
  language: UiLanguage;
  analysisState?: AnalysisState;
  onRetryAnalysis?: () => void;
  /** The hand length the user typed in, when the scan used no paper. */
  enteredLengthMm?: number | null;
  /** Mount the 3D size illustration (real scans only). */
  showViewer?: boolean;
  /** A real scan: the other picks link to its routes. Absent in the demo. */
  scanId?: string;
  /** The demo has no routes: the other picks are buttons that call this. */
  onSelectRank?: (rank: number) => void;
  /** Overrides `src/data/purchase-links.json` (tests only). */
  purchaseSource?: unknown;
  /** Analytics callbacks, passed only by the real results page (never the demo). */
  analytics?: {
    onRetake: () => void;
    onListOpened: (list: "ranked" | "excluded") => void;
    onViewerInteracted: () => void;
  };
}) {
  const entry: FitEntry | null =
    entryAtRank(response.results, rank) ?? response.results[0] ?? null;
  const copy = RESULTS_PAGE_COPY[language];
  const lang = uiLangAttribute(language);

  const hand = handTypeLabel(response.handType, language);
  const band = entry ? bandOf(entry.total) : null;
  const picks = entry ? otherPicks(response.results, entry.rank) : [];
  const isMain = entry?.rank === 1;
  const ModelHeading = hand ? "h2" : "h1";

  return (
    <div className="results-view" data-rank={entry?.rank}>
      <PrintOpenDetails />
      <ResultsTopBar language={language} onRetake={analytics?.onRetake} />

      {isMain && entry && entry.total < POOR_FIT_THRESHOLD && (
        <p className="results-fitNotice" lang={lang}>
          {copy.fitNotice}
        </p>
      )}

      {entry && (
        <div className="results-hero">
          {hand && (
            <header className="results-hand" lang={lang}>
              <p className="results-hand-kicker">{hand.kicker}</p>
              <h1 className="results-hand-title">{hand.title}</h1>
              <p className="results-hand-sentence">{hand.sentence}</p>
            </header>
          )}

          <MousePhoto
            imageUrl={entry.mouse.imageUrl}
            alt={`${entry.mouse.brand} ${entry.mouse.model}`}
            className="results-hero-photo"
          />

          <div className="results-score">
            <div className="results-score-name">
              <p className="results-score-rank" lang={lang}>
                {copy.rankLine(entry.rank, entry.mouse.brand)}
              </p>
              <ModelHeading className="results-score-model">
                {entry.mouse.model}
              </ModelHeading>
              {band && (
                <p className="results-band" lang={lang}>
                  <span className="results-band-dot" aria-hidden="true" />
                  {BAND_COPY[language].bands[band].label}
                </p>
              )}
            </div>
            <p className="results-score-total results-tabularNum">
              <span className="results-score-value">{entry.total}</span>
              <span className="results-score-label" lang={lang}>
                {copy.scoreLabel}
              </span>
            </p>
          </div>

          <WhyList entry={entry} language={language} />

          {/* Cautions about how the scan was made come before any link to a shop. */}
          {enteredLengthMm !== null && (
            <p className="results-handNotice" lang={lang}>
              {copy.enteredLengthNotice(enteredLengthMm)}
            </p>
          )}
          {/* The hand comes from the fit response (#62), not from browser
              storage, so the note follows a results link to any device. */}
          {response.hand === "left" && (
            <p className="results-handNotice" lang={lang}>
              {copy.leftHandNotice}
            </p>
          )}

          <PurchaseSlot
            slug={entry.mouse.slug}
            language={language}
            source={purchaseSource}
          />
        </div>
      )}

      {entry && (
        <ResultsDetails
          // A new mouse starts closed, with its own viewer.
          key={entry.mouse.slug}
          response={response}
          entry={entry}
          language={language}
          showViewer={showViewer}
          analysis={
            isMain
              ? { state: analysisState, onRetry: onRetryAnalysis }
              : undefined
          }
          onViewerInteracted={analytics?.onViewerInteracted}
        />
      )}

      <OtherPicks
        entries={picks}
        language={language}
        hrefFor={scanId ? (e) => pathForEntry(scanId, e) : undefined}
        onSelect={onSelectRank}
      />

      <OtherMice
        response={response}
        language={language}
        onOpened={() => analytics?.onListOpened("ranked")}
      />

      <div
        className="results-share-bottom"
        data-testid="share-slot"
        data-share-position="bottom"
      />
    </div>
  );
}
