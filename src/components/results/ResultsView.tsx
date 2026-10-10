import type { FitResponse } from "@/lib/contracts/fit";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { en as enBands, zhTW as zhBands } from "@/lib/copy/fit-bands";
import { bandOf } from "@/lib/fit/bands";
import {
  emptyFilters,
  filteredView,
  serializeFilters,
  viewOtherPicks,
  type Filters,
} from "@/lib/results/filters";
import { handTypeLabel } from "@/lib/results/handTypeLabel";
import { pathForEntry } from "@/lib/results/rankRoutes";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import type { AnalysisState } from "./analysisState";
import { FilteredAnalysisLine } from "./FilteredAnalysisLine";
import { FilterSummary } from "./filter/FilterSummary";
import { FilterNoMatch } from "./filter/FilterNoMatch";
import { ResultsFilterLayout } from "./filter/ResultsFilterLayout";
import { OtherMice } from "./OtherMice";
import { OtherPicks } from "./OtherPicks";
import { MousePhoto } from "./MousePhoto";
import { VariantsLine } from "./VariantsLine";
import { PurchaseSlot } from "./PurchaseSlot";
import { ResultsDetails } from "./ResultsDetails";
import { ResultsTopBar } from "./ResultsTopBar";
import { ShareCardButton } from "./share/ShareCardButton";
import { PrintOpenDetails } from "./PrintOpenDetails";
import { WhyList } from "./WhyList";
import "./results.css";
import { POOR_FIT_THRESHOLD } from "./fitNotice";

const BAND_COPY = { "zh-TW": zhBands, en: enBands } as const;

/**
 * Renders one page of a `FitResponse` — the only data input this component
 * tree takes. No fetching, no analysis calls: `analysisState` is handed in by
 * the caller. `rank` is the place of the mouse the page is about in the list
 * the person sees: 1 for the main results page, 2 to 5 for a detail page,
 * which has the same layout. The written analysis is shown in full only for
 * the overall #1.
 *
 * Filter (FILTER-1, candidate): with `onFiltersChange` the page has the filter
 * (a sidebar or a sheet) and shows `filteredView(response, filters)`: the
 * kept cards renumbered 1..n, the large card being the filtered #1. `rank` is
 * then the place in that list. Only what is on screen follows the filter: the
 * written analysis and the share card stay on the overall #1 (`response` is
 * never filtered). Without `onFiltersChange` (the demo) nothing changes.
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
  filters = emptyFilters(),
  onFiltersChange,
}: {
  response: FitResponse;
  /**
   * Which mouse the page is about: its place in the list the person sees (the
   * filtered list's while a filter is on; with no filter, its rank). Defaults
   * to the first place.
   */
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
  /** The applied filters. */
  filters?: Filters;
  /** Passed only by the real results page; without it there is no filter UI. */
  onFiltersChange?: (next: Filters) => void;
}) {
  const view = filteredView(response, filters);
  const card =
    view.cards.find((c) => c.displayRank === rank) ?? view.large ?? null;
  const entry = card?.entry ?? null;
  const copy = RESULTS_PAGE_COPY[language];
  const lang = uiLangAttribute(language);
  const search = serializeFilters(filters);

  const hand = handTypeLabel(response.handType, language);
  const band = entry ? bandOf(entry.total) : null;
  const picks = card ? viewOtherPicks(view, card.displayRank) : [];
  // The page about the first place of the list the person sees.
  const isMain = card?.displayRank === 1;
  const ModelHeading = hand ? "h2" : "h1";
  const filtering = view.active;
  // The large card is not the overall #1: it gets the badge, and the written
  // analysis (about the overall #1) shrinks to one line.
  const swappedMain = isMain && view.swapped;
  const overallTop = view.overallTop;
  const showPlace = filtering && card !== null && (swappedMain || !isMain);
  const showOverall =
    showPlace && card !== null && card.overallRank !== card.displayRank;
  const empty = filtering && view.count === 0;
  // The share card is always the overall #1. Only when that mouse is not the
  // filtered #1 (a swapped view, or nothing matches) does the button say so;
  // when the overall #1 still leads it is exactly the button of an unfiltered
  // page (Kirby, 2026-10-11).
  const shareOverall = filtering && (view.count === 0 || view.swapped);

  const content = (
    <>
      {isMain && entry && entry.total < POOR_FIT_THRESHOLD && (
        <p className="results-fitNotice" lang={lang}>
          {copy.fitNotice}
        </p>
      )}

      {(entry || empty) && (
        <div className="results-hero" data-empty={empty ? "true" : undefined}>
          {hand && (
            <header className="results-hand" lang={lang}>
              <p className="results-hand-kicker">{hand.kicker}</p>
              <h1 className="results-hand-title">{hand.title}</h1>
              <p className="results-hand-sentence">{hand.sentence}</p>
            </header>
          )}

          {empty && onFiltersChange && (
            <FilterNoMatch
              response={response}
              filters={filters}
              language={language}
              onChange={onFiltersChange}
              headingLevel={hand ? 2 : 1}
            />
          )}

          {entry && card && (
            <>
              <MousePhoto
                imageUrl={entry.mouse.imageUrl}
                alt={`${entry.mouse.brand} ${entry.mouse.model}`}
                className="results-hero-photo"
              />

              <div className="results-score">
                <div className="results-score-name">
                  {showPlace ? (
                    <>
                      <p
                        className="results-score-rank results-score-places"
                        lang={lang}
                      >
                        <span className="results-badge">
                          {copy.filter.filteredRank(card.displayRank)}
                        </span>
                        {showOverall && (
                          <span className="results-score-overall">
                            {copy.filter.overallRank(card.overallRank)}
                          </span>
                        )}
                      </p>
                      <p className="results-score-brand">{entry.mouse.brand}</p>
                    </>
                  ) : (
                    <p className="results-score-rank" lang={lang}>
                      {copy.rankLine(card.displayRank, entry.mouse.brand)}
                    </p>
                  )}
                  <ModelHeading className="results-score-model">
                    {entry.mouse.model}
                  </ModelHeading>
                  {band && (
                    <p className="results-band" lang={lang}>
                      <span className="results-band-dot" aria-hidden="true" />
                      {BAND_COPY[language].bands[band].label}
                    </p>
                  )}
                  <VariantsLine variants={card.variants} language={language} />
                  {isMain && filtering && view.count === 1 && (
                    <p className="results-oneLeft" lang={lang}>
                      {copy.filter.oneLeft}
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

              {swappedMain && overallTop && (
                <FilteredAnalysisLine
                  name={`${overallTop.mouse.brand} ${overallTop.mouse.model}`}
                  language={language}
                  state={analysisState}
                  onRetry={onRetryAnalysis}
                />
              )}

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

              {/* Wide screens: the primary share button sits beside the purchase
                  links (design lPz7x). Phones show it under Other mice instead.
                  The card it makes is always the overall #1 (`response` is never
                  filtered), so while filtering it turns secondary and says so. */}
              <div className="results-hero-actions">
                <PurchaseSlot
                  slug={entry.mouse.slug}
                  language={language}
                  source={purchaseSource}
                />
                <div className="results-share-hero" data-share-position="hero">
                  <ShareCardButton
                    fit={response}
                    lang={language}
                    variant="primary"
                    filtering={shareOverall}
                  />
                </div>
              </div>
            </>
          )}
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
            isMain && !swappedMain
              ? { state: analysisState, onRetry: onRetryAnalysis }
              : undefined
          }
          onViewerInteracted={analytics?.onViewerInteracted}
        />
      )}

      <OtherPicks
        cards={picks}
        language={language}
        filtering={filtering}
        hrefFor={
          scanId
            ? (c) => pathForEntry(scanId, c.entry, search, c.displayRank)
            : undefined
        }
        onSelect={onSelectRank}
      />

      <OtherMice
        ranked={view.rest}
        excluded={view.excluded}
        hand={response.hand}
        language={language}
        filtering={filtering}
        onOpened={() => analytics?.onListOpened("ranked")}
      />

      {view.hiddenExcludedCount > 0 && (
        <p className="results-excludedNote" lang={lang}>
          {copy.filter.excludedHidden(view.hiddenExcludedCount)}
        </p>
      )}

      <div className="results-share-bottom" data-share-position="bottom">
        <ShareCardButton
          fit={response}
          lang={language}
          variant="primary"
          filtering={shareOverall}
        />
      </div>
    </>
  );

  return (
    <div className="results-view" data-rank={card?.displayRank}>
      <PrintOpenDetails />
      {/* Decorative haze behind the hero: see .results-glow in results.css. */}
      <div className="results-glow" aria-hidden="true" />
      <ResultsTopBar
        fit={response}
        language={language}
        onRetake={analytics?.onRetake}
      />
      {/* A detail page has no filter controls: it says which filter it is
          under and how to get back to the list. */}
      {!onFiltersChange && filtering && scanId && (
        <FilterSummary
          filters={filters}
          language={language}
          scanId={scanId}
          count={view.count}
        />
      )}
      {onFiltersChange ? (
        <ResultsFilterLayout
          response={response}
          language={language}
          filters={filters}
          count={view.count}
          onChange={onFiltersChange}
        >
          {content}
        </ResultsFilterLayout>
      ) : (
        content
      )}
    </div>
  );
}
