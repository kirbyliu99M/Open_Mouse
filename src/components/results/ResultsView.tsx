import { useRef, useState, type MouseEvent } from "react";
import type { FitResponse } from "@/lib/contracts/fit";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { manualEntryCopy } from "@/lib/copy/manualEntry";
import { formatCentimetres } from "@/lib/scan/manualEntry";
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
import {
  fewSegmentNote,
  segmentDirection,
  segmentOf,
  segmentOnly,
  withSegment,
  type ShapeSegment,
} from "@/lib/results/shapeToggle";
import { usePrefersReducedMotion } from "@/client/camera/useReducedMotion";
import { pathForEntry } from "@/lib/results/rankRoutes";
import type { Locale } from "@/lib/contracts/locale";
import { retailerOf } from "@/lib/contracts/analytics";
import {
  createResultsEmit,
  firstTime,
  headerCard,
  linkPositionOf,
  officialKindOf,
  resultsPageFields,
  type ResultsAnalytics,
  type ResultsFilterChange,
} from "@/lib/results/analyticsEvents";
import type { AnalysisState } from "./analysisState";
import { FilteredAnalysisLine } from "./FilteredAnalysisLine";
import { FilterSummary } from "./filter/FilterSummary";
import { FilterNoMatch } from "./filter/FilterNoMatch";
import { ResultsFilterLayout } from "./filter/ResultsFilterLayout";
import { ShapeToggle } from "./filter/ShapeToggle";
import { useSegmentSwap } from "./filter/useSegmentSwap";
import { OtherMice } from "./OtherMice";
import { OtherPicks } from "./OtherPicks";
import { MousePhoto } from "./MousePhoto";
import { PhotoZoom } from "./PhotoZoom";
import { VariantsLine } from "./VariantsLine";
import { OfficialLink } from "./OfficialLink";
import { PurchaseSlot } from "./PurchaseSlot";
import { ResultFeedbackSheet } from "./ResultFeedbackSheet";
import { ResultsDetails } from "./ResultsDetails";
import { ResultsTopBar } from "./ResultsTopBar";
import { ShareCardButton } from "./share/ShareCardButton";
import { SimilarHands } from "./SimilarHands";
import { PrintOpenDetails } from "./PrintOpenDetails";
import { useMouseLinks } from "./useMouseLinks";
import { WhyList } from "./WhyList";
import "./results.css";
import { POOR_FIT_THRESHOLD } from "./fitNotice";
import type { StoredManualEntry } from "./userLengthDisclosure";

/**
 * V3.2 F11: how the real results pages move between each other and back out
 * (`src/lib/results/resultsHistory.ts`). Each handler may take a link's click
 * over (`preventDefault`); without them the links behave as plain links.
 */
export interface ResultsNavigation {
  /** A card or the 「back to list」 link: `toMain` when it opens the main page. */
  onPick: (
    event: MouseEvent<HTMLAnchorElement>,
    href: string,
    toMain: boolean,
  ) => void;
  /** The top bar's 「‹ 重新掃描」. */
  onBack: (event: MouseEvent<HTMLAnchorElement>) => void;
}

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
 * Shape toggle (V3.2 U1, candidate): with the filter, 「綜合｜左右對稱｜人體工學」
 * sits above the filter button. It sets the filter's 滑鼠握感 group and
 * nothing else (`withSegment`), so the panel and the toggle always agree and
 * the page reads the same `filteredView`: renumbered cards, the place line,
 * `FilteredAnalysisLine` and the share button's filter rule, `FilterNoMatch`
 * when nothing is left. A shape with only a few mice lists exactly those,
 * with a note that they are all there. The cards change over with
 * `useSegmentSwap`.
 *
 * Order: top bar, hand type (when the response has one), photo, rank and
 * score (the official link sits on the fit-band chip's row), why, purchase
 * links (when there are any), details (closed), other picks, the similar-hand
 * block (the main page of a real scan only; candidate, 2026-10-12), other mice
 * (closed). The photo comes from the entry (`mouse.imageUrl`, filled by the
 * server for every entry). The official link and the purchase links come from
 * `useMouseLinks` for the mouse on screen only.
 */
export function ResultsView({
  response,
  rank = 1,
  language,
  analysisState = { status: "idle" },
  onRetryAnalysis,
  onResultChanged,
  enteredLengthMm = null,
  enteredManual = null,
  paperAdjusted = false,
  showViewer = false,
  scanId,
  onSelectRank,
  analytics,
  filters = emptyFilters(),
  onFiltersChange,
  navigation,
}: {
  response: FitResponse;
  /**
   * Which mouse the page is about: its place in the list the person sees (the
   * filtered list's while a filter is on; with no filter, its rank). Defaults
   * to the first place.
   */
  rank?: number;
  language: Locale;
  analysisState?: AnalysisState;
  onRetryAnalysis?: () => void;
  /**
   * V3.2 F1 (candidate): the feedback sheet heard that the ranking changed on
   * the server (412); the page fetches the fit again. Real scans only.
   */
  onResultChanged?: () => void;
  /** The hand length the user typed in, when the scan used no paper. */
  enteredLengthMm?: number | null;
  /**
   * The hand length and width the user typed instead of scanning (manual
   * entry, candidate). Only a manual-entry scan has them; with a typed
   * length-as-scale note (above) the page shows that note alone, so the two
   * never stack.
   */
  enteredManual?: StoredManualEntry | null;
  /**
   * V3.2 F2 (candidate): the scan's paper frame was placed or moved by hand.
   * One line in the cautions about how the scan was made.
   */
  paperAdjusted?: boolean;
  /** Mount the 3D size illustration (real scans only). */
  showViewer?: boolean;
  /** A real scan: the other picks link to its routes. Absent in the demo. */
  scanId?: string;
  /** The demo has no routes: the other picks are buttons that call this. */
  onSelectRank?: (rank: number) => void;
  /** The analytics sender, passed only by the real results pages (never the demo). */
  analytics?: ResultsAnalytics;
  /** The applied filters. */
  filters?: Filters;
  /** Passed only by the real results page; without it there is no filter UI. */
  onFiltersChange?: (next: Filters, source: ResultsFilterChange) => void;
  /** The real results pages only (V3.2 F11). */
  navigation?: ResultsNavigation;
}) {
  const view = filteredView(response, filters);
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const swap = useSegmentSwap(rootRef, reducedMotion);
  // The segment just pressed, until the change it starts reaches `filters`
  // (the cards fade out first): the toggle shows it at once.
  const [pressed, setPressed] = useState<{
    segment: ShapeSegment;
    on: Filters;
  } | null>(null);
  const [detailsOpened, setDetailsOpened] = useState(false);
  const shownSegment =
    pressed && pressed.on === filters ? pressed.segment : segmentOf(filters);
  const selectSegment = (segment: ShapeSegment, refocus = false) => {
    if (!onFiltersChange) return;
    const next = withSegment(filters, segment);
    setPressed({ segment, on: filters });
    swap(segmentDirection(shownSegment, segment), () =>
      onFiltersChange(next, "shape_toggle"),
    );
    // The note's button goes away with the change: focus moves to the
    // segment that is now checked.
    if (refocus)
      requestAnimationFrame(() =>
        rootRef.current
          ?.querySelector<HTMLElement>(
            '.results-shapeToggle [role="radio"][aria-checked="true"]',
          )
          ?.focus(),
      );
  };
  const card = headerCard(view, rank);
  const entry = card?.entry ?? null;
  // The official link and the purchase links of the one mouse in the big
  // header: one small cached response per mouse, asked for once (never on the fit
  // response, never for the small cards). `null` until it arrives, and for
  // good when there is none.
  const links = useMouseLinks(entry?.mouse.slug);
  const copy = RESULTS_PAGE_COPY[language];
  const search = serializeFilters(filters);

  const hand = handTypeLabel(response.handType, language);
  // The hand is longer (or shorter) than every ranked mouse: `total` is then
  // the value the engine sorted by against the catalogue's edge, not a
  // distance to this hand (contract, `fitCoverageSchema`). The order stays;
  // no number and no band is drawn anywhere on the page.
  const scoresHidden = response.coverage?.lengthOutOfRange === true;
  const band = entry && !scoresHidden ? bandOf(entry.total) : null;
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
  // The place line names the shape when it is the only filter (「人體工學第 1 名」).
  const onlyShape = segmentOnly(filters);
  const few =
    isMain && onFiltersChange ? fewSegmentNote(filters, view.count) : null;

  // Analytics (real pages only): every event carries the page fields of the
  // mouse in the big header, built here once. The refs hold what is sent once
  // per page: the viewer's first use, and the purchase block per mouse.
  const emit = createResultsEmit(
    analytics,
    resultsPageFields(card?.displayRank ?? 1, filtering),
  );
  const viewerReported = useRef(false);
  const purchaseShown = useRef(new Set<string>());
  const shareHandlers = (
    position: "top" | "hero" | "bottom",
    overall: boolean,
  ) =>
    analytics
      ? {
          onShareStarted: () => emit("share_started", { position, overall }),
          onShareFinished: (
            outcome: "shared" | "downloaded" | "cancelled" | "failed",
          ) => emit("share_finished", { position, outcome }),
        }
      : {};

  const content = (
    <>
      {/* Out of the catalogue's range the notice is about coverage and shows
          on every page of the list; it never depends on `total`. */}
      {scoresHidden && entry && (
        <p
          className="results-coverageNotice"
          data-direction={response.coverage?.direction ?? "partial"}
        >
          {copy.coverageNotice[response.coverage?.direction ?? "partial"]}
        </p>
      )}
      {isMain && entry && !scoresHidden && entry.total < POOR_FIT_THRESHOLD && (
        <p className="results-fitNotice">{copy.fitNotice}</p>
      )}

      {(entry || empty) && (
        <div className="results-hero" data-empty={empty ? "true" : undefined}>
          {hand && (
            <header className="results-hand">
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
              onChange={(next) => onFiltersChange(next, "no_match")}
              headingLevel={hand ? 2 : 1}
            />
          )}

          {entry && card && (
            <>
              <MousePhoto
                imageUrl={entry.mouse.imageUrl}
                alt={`${entry.mouse.brand} ${entry.mouse.model}`}
                className="results-hero-photo"
                priority
              >
                {entry.mouse.imageUrl && (
                  <PhotoZoom
                    imageUrl={entry.mouse.imageUrl}
                    name={`${entry.mouse.brand} ${entry.mouse.model}`}
                    copy={copy.photoZoom}
                    onOpened={
                      analytics
                        ? () =>
                            emit("photo_zoomed", { mouse: entry.mouse.slug })
                        : undefined
                    }
                  />
                )}
              </MousePhoto>

              <div className="results-score">
                <div className="results-score-name">
                  {showPlace ? (
                    <>
                      <p className="results-score-rank results-score-places">
                        <span className="results-badge">
                          {onlyShape
                            ? copy.shapeToggle.segmentRank(
                                card.displayRank,
                                copy.shapeToggle.segment[onlyShape],
                              )
                            : copy.filter.filteredRank(card.displayRank)}
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
                    <p className="results-score-rank">
                      {copy.rankLine(card.displayRank, entry.mouse.brand)}
                    </p>
                  )}
                  <ModelHeading className="results-score-model">
                    {entry.mouse.model}
                  </ModelHeading>
                  <VariantsLine variants={card.variants} language={language} />
                  {isMain && filtering && view.count === 1 && (
                    <p className="results-oneLeft">{copy.filter.oneLeft}</p>
                  )}
                </div>
                {!scoresHidden && (
                  <p className="results-score-total results-tabularNum">
                    <span className="results-score-value">{entry.total}</span>
                    <span className="results-score-label">
                      {copy.scoreLabel}
                    </span>
                  </p>
                )}
              </div>

              {/* A full-width row under the score: the fit-band chip on the left,
                  the maker's page on the right. It does not depend on the chip:
                  with no band the link stands alone. Its height is fixed, so
                  the link arriving later moves nothing. */}
              {(band || links?.officialUrl) && (
                <div className="results-bandRow">
                  {band && (
                    <p className="results-band">
                      <span className="results-band-dot" aria-hidden="true" />
                      {BAND_COPY[language].bands[band].label}
                    </p>
                  )}
                  <OfficialLink
                    url={links?.officialUrl}
                    kind={links?.officialKind}
                    brand={entry.mouse.brand}
                    language={language}
                    onClick={
                      analytics
                        ? () =>
                            emit("official_link_clicked", {
                              mouse: entry.mouse.slug,
                              kind: officialKindOf(links?.officialKind),
                            })
                        : undefined
                    }
                  />
                </div>
              )}

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
                <p className="results-handNotice">
                  {copy.enteredLengthNotice(enteredLengthMm)}
                </p>
              )}
              {enteredManual !== null && enteredLengthMm === null && (
                <p className="results-handNotice">
                  {manualEntryCopy(language).resultsNotice(
                    formatCentimetres(enteredManual.handLengthMm),
                    formatCentimetres(enteredManual.handWidthMm),
                  )}
                </p>
              )}
              {paperAdjusted && (
                <p
                  className="results-handNotice"
                  data-testid="results-paper-adjusted"
                >
                  {copy.paperAdjustedNotice}
                </p>
              )}
              {/* The hand comes from the fit response (#62), not from browser
                  storage, so the note follows a results link to any device. */}
              {response.hand === "left" && (
                <p className="results-handNotice">{copy.leftHandNotice}</p>
              )}
              {/* Only when the survey ratings really moved a target. */}
              {response.calibration !== undefined &&
                Object.values(response.calibration.dims).some(
                  (dim) => dim.shiftMm !== 0,
                ) && (
                  <p className="results-handNotice">{copy.calibrationNotice}</p>
                )}

              {/* Wide screens: the primary share button sits beside the purchase
                  links (design lPz7x). Phones show it under Other mice instead.
                  The card it makes is always the overall #1 (`response` is never
                  filtered), so while filtering it turns secondary and says so. */}
              <div className="results-hero-actions">
                <PurchaseSlot
                  // A new mouse is a new block: its impression counts again.
                  key={entry.mouse.slug}
                  links={links?.purchaseLinks}
                  language={language}
                  onShown={
                    analytics
                      ? (count) => {
                          if (
                            !firstTime(purchaseShown.current, entry.mouse.slug)
                          )
                            return;
                          emit("purchase_links_shown", {
                            mouse: entry.mouse.slug,
                            count,
                          });
                        }
                      : undefined
                  }
                  onLinkClick={
                    analytics
                      ? (link, index) =>
                          // The shop's key, never the URL.
                          emit("purchase_link_clicked", {
                            mouse: entry.mouse.slug,
                            overallRank: card.overallRank,
                            retailer: retailerOf(link.url),
                            position: linkPositionOf(index),
                          })
                      : undefined
                  }
                />
                <div className="results-share-hero" data-share-position="hero">
                  <ShareCardButton
                    fit={response}
                    lang={language}
                    variant="primary"
                    filtering={shareOverall}
                    {...shareHandlers("hero", shareOverall)}
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
          onViewerInteracted={
            analytics
              ? () => {
                  if (viewerReported.current) return;
                  viewerReported.current = true;
                  emit("viewer_used", {});
                }
              : undefined
          }
          onOpened={() => {
            // V3.2 F11: opening Details counts as having looked at the result
            // (the feedback sheet's timing rule).
            setDetailsOpened(true);
            if (analytics) emit("details_opened", {});
          }}
        />
      )}

      <OtherPicks
        cards={picks}
        language={language}
        filtering={filtering}
        showScores={!scoresHidden}
        hrefFor={
          scanId
            ? (c) => pathForEntry(scanId, c.entry, search, c.displayRank)
            : undefined
        }
        onSelect={onSelectRank}
        onLinkClick={
          scanId && navigation
            ? (c, event) =>
                navigation.onPick(
                  event,
                  pathForEntry(scanId, c.entry, search, c.displayRank),
                  c.displayRank === 1,
                )
            : undefined
        }
        onPick={
          analytics && scanId
            ? (c) =>
                emit("pick_opened", {
                  toRank: c.displayRank,
                  mouse: c.entry.mouse.slug,
                })
            : undefined
        }
      />

      {few && (
        <section className="results-fewNote">
          <p className="results-fewNote-text">
            {copy.shapeToggle.fewNote(
              few.count,
              copy.shapeToggle.segment[few.shape],
            )}
          </p>
          <button
            type="button"
            className="results-textLink"
            onClick={() => selectSegment("overall", true)}
          >
            {copy.shapeToggle.seeOverall}
          </button>
        </section>
      )}

      {/* How people with a similar hand size rated the mice: about the
          person, not about one mouse, so only the main page of a real scan
          asks for it. It draws nothing until it has an answer. */}
      {isMain && scanId && (
        <SimilarHands
          scanId={scanId}
          language={language}
          onShown={
            analytics
              ? (status) => analytics.send("similar_hands_shown", { status })
              : undefined
          }
        />
      )}

      <OtherMice
        ranked={view.rest}
        excluded={view.excluded}
        hand={response.hand}
        language={language}
        filtering={filtering}
        showScores={!scoresHidden}
        onOpened={analytics ? () => emit("other_mice_opened", {}) : undefined}
      />

      {view.hiddenExcludedCount > 0 && (
        <p className="results-excludedNote">
          {copy.filter.excludedHidden(view.hiddenExcludedCount)}
        </p>
      )}

      <div className="results-share-bottom" data-share-position="bottom">
        <ShareCardButton
          fit={response}
          lang={language}
          variant="primary"
          filtering={shareOverall}
          {...shareHandlers("bottom", shareOverall)}
        />
      </div>

      {/* The feedback sheet: the main page of a real scan only (the demo has
          no scan id). It waits 20 s of the tab being visible and the end of
          the list or Details, or 45 s after a real scroll, and comes at most
          once per device in 30 days (see resultFeedback.ts, V3.2 F11). */}
      {isMain && scanId && (
        <ResultFeedbackSheet
          key={scanId}
          scanId={scanId}
          language={language}
          emit={analytics ? emit : undefined}
          resultFingerprint={response.resultFingerprint}
          onResultChanged={onResultChanged}
          openedDetails={detailsOpened}
        />
      )}
    </>
  );

  return (
    <div className="results-view" data-rank={card?.displayRank} ref={rootRef}>
      <PrintOpenDetails />
      {/* Decorative haze behind the hero: see .results-glow in results.css. */}
      <div className="results-glow" aria-hidden="true" />
      <ResultsTopBar
        fit={response}
        language={language}
        onRetake={analytics ? () => emit("rescan_clicked", {}) : undefined}
        onSurveyReminderClick={
          analytics
            ? (unanswered) => emit("survey_reminder_clicked", { unanswered })
            : undefined
        }
        {...shareHandlers("top", false)}
        onBack={navigation?.onBack}
      />
      {/* A detail page has no filter controls: it says which filter it is
          under and how to get back to the list. */}
      {!onFiltersChange && filtering && scanId && (
        <FilterSummary
          filters={filters}
          language={language}
          scanId={scanId}
          count={view.count}
          onBackToList={
            navigation
              ? (event, href) => navigation.onPick(event, href, true)
              : undefined
          }
        />
      )}
      {onFiltersChange ? (
        <ResultsFilterLayout
          response={response}
          language={language}
          filters={filters}
          count={view.count}
          onChange={onFiltersChange}
          onSheetOpened={
            analytics ? () => emit("filter_sheet_opened", {}) : undefined
          }
          besideToggle
          lead={
            <ShapeToggle
              language={language}
              selected={shownSegment}
              reducedMotion={reducedMotion}
              onSelect={(segment) => selectSegment(segment)}
            />
          }
        >
          {content}
        </ResultsFilterLayout>
      ) : (
        content
      )}
    </div>
  );
}
